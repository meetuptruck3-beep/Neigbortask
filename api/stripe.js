import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Server-only client. Never expose STRIPE_SECRET_KEY through a VITE_ variable.
function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !key.startsWith("sk_")) {
    const e = new Error("Stripe is not configured. Add STRIPE_SECRET_KEY in Vercel Environment Variables using a NEW rotated/test key; do not reuse a key pasted into chat.");
    e.statusCode = 503; throw e;
  }
  return new Stripe(key); // Let the SDK select its default API version.
}
function db() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const e = new Error("Server Supabase config missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel and apply the Stripe SQL migration.");
    e.statusCode = 503; throw e;
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function out(res, code, data) { return res.status(code).json(data); }
function root(req) {
  return (process.env.APP_URL || ((req.headers["x-forwarded-proto"] || "https") + "://" + req.headers.host)).replace(/\/$/, "");
}
async function signedIn(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    const e = new Error("Sign in to HandyNeighbor first; this request has no Supabase session token."); e.statusCode = 401; throw e;
  }
  const supabase = db();
  const { data, error } = await supabase.auth.getUser(auth.slice(7));
  if (error || !data.user) { const e = new Error("Your session expired. Sign in again and retry."); e.statusCode = 401; throw e; }
  return { user: data.user, supabase };
}
async function mapped(supabase, userId) {
  const { data, error } = await supabase.from("stripe_connected_accounts").select("stripe_account_id").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Could not read Stripe account mapping. Apply the included Supabase migration.");
  return data?.stripe_account_id || null;
}
async function liveStatus(client, accountId) {
  // Fetch status from Stripe on every request; never trust a database status cache.
  const a = await client.v2.core.accounts.retrieve(accountId, { include: ["configuration.merchant", "configuration.customer", "requirements"] });
  const deadlineStatus = a.requirements?.summary?.minimum_deadline?.status;
  return {
    accountId, displayName: a.display_name || "",
    readyToProcessPayments: a.configuration?.merchant?.capabilities?.card_payments?.status === "active",
    onboardingComplete: deadlineStatus !== "currently_due" && deadlineStatus !== "past_due",
    requirementsStatus: deadlineStatus || "unknown",
    currentlyDue: (a.requirements?.entries || []).filter(x => x.status === "currently_due").map(x => x.requirement),
    pastDue: (a.requirements?.entries || []).filter(x => x.status === "past_due").map(x => x.requirement)
  };
}
export default async function handler(req, res) {
  try {
    const client = stripe();
    const action = String(req.query?.action || req.body?.action || "");
    if (req.method === "GET" && action === "products") {
      // Public storefront listing. Raw acct_ IDs are demo-only; use a public slug in production.
      const accountId = String(req.query?.accountId || "");
      if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) return out(res, 400, { error: "A valid connected account ID is required." });
      const result = await client.products.list({ limit: 20, active: true, expand: ["data.default_price"] }, { stripeAccount: accountId });
      return out(res, 200, { products: result.data });
    }
    // Public storefront checkout does not require a buyer account; product/price are validated with Stripe.
    if (req.method === "POST" && action === "checkout") {
      const accountId = String(req.body?.accountId || "");
      const productId = String(req.body?.productId || "");
      if (!/^acct_[A-Za-z0-9]+$/.test(accountId) || !/^prod_[A-Za-z0-9]+$/.test(productId)) return out(res, 400, { error: "Valid connected account and product IDs are required." });
      const accountState = await client.v2.core.accounts.retrieve(accountId, { include: ["configuration.merchant"] });
      if (accountState.configuration?.merchant?.capabilities?.card_payments?.status !== "active") return out(res, 409, { error: "This seller is not yet enabled to accept card payments. Ask the seller to finish Stripe onboarding." });
      const product = await client.products.retrieve(productId, { expand: ["default_price"] }, { stripeAccount: accountId });
      const price = product.default_price;
      if (!product.active || !price || typeof price !== "object" || !price.active || !Number.isInteger(price.unit_amount)) return out(res, 400, { error: "This product is not available for purchase." });
      const pct = Number(process.env.STRIPE_APPLICATION_FEE_PERCENT || "10");
      if (!Number.isFinite(pct) || pct < 0 || pct > 25) return out(res, 503, { error: "STRIPE_APPLICATION_FEE_PERCENT must be between 0 and 25." });
      const fee = Math.floor(price.unit_amount * pct / 100);
      const base = root(req);
      const session = await client.checkout.sessions.create({
        line_items: [{ price: price.id, quantity: 1 }], payment_intent_data: { application_fee_amount: fee },
        mode: "payment",
        success_url: base + "/?stripe-demo=1&checkout=success&session_id={CHECKOUT_SESSION_ID}",
        cancel_url: base + "/?stripe-demo=1&checkout=cancelled"
      }, { stripeAccount: accountId });
      return out(res, 200, { url: session.url });
    }
    const { user, supabase } = await signedIn(req);
    if (req.method === "GET" && action === "status") {
      const accountId = await mapped(supabase, user.id);
      return out(res, 200, accountId ? await liveStatus(client, accountId) : { accountId: null, onboardingComplete: false, readyToProcessPayments: false });
    }
    if (req.method !== "POST") return out(res, 405, { error: "Method not allowed." });
    if (action === "onboard") {
      let accountId = await mapped(supabase, user.id);
      if (!accountId) {
        const email = user.email;
        const displayName = String(user.user_metadata?.display_name || user.user_metadata?.full_name || email || "").trim();
        if (!email || !displayName) return out(res, 400, { error: "Your profile needs an email and display name before onboarding can start." });
        // V2 account creation: only the requested fields, and deliberately no top-level type.
        const account = await client.v2.core.accounts.create({
          display_name: displayName, contact_email: email, identity: { country: "us" }, dashboard: "full",
          defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
          configuration: { customer: {}, merchant: { capabilities: { card_payments: { requested: true } } } }
        });
        accountId = account.id;
        // Store only the user/account mapping. Onboarding status remains live Stripe data.
        const { error } = await supabase.from("stripe_connected_accounts").upsert({ user_id: user.id, stripe_account_id: accountId }, { onConflict: "user_id" });
        if (error) throw new Error("Stripe created the account but saving its mapping failed. Apply the migration, then contact support with account ID " + accountId);
      }
      const base = root(req);
      const link = await client.v2.core.accountLinks.create({
        account: accountId,
        use_case: { type: "account_onboarding", account_onboarding: {
          configurations: ["merchant", "customer"],
          refresh_url: base + "/?stripe-demo=1&onboarding=refresh",
          return_url: base + "/?stripe-demo=1&onboarding=return&accountId=" + encodeURIComponent(accountId)
        } }
      });
      return out(res, 200, { url: link.url, accountId });
    }
    if (action === "create-product") {
      const accountId = await mapped(supabase, user.id);
      if (!accountId) return out(res, 409, { error: "Start Stripe onboarding before creating products." });
      const name = String(req.body?.name || "").trim();
      const description = String(req.body?.description || "").trim();
      const priceInCents = Number(req.body?.priceInCents);
      const currency = String(req.body?.currency || "usd").toLowerCase();
      if (name.length < 2 || name.length > 120) return out(res, 400, { error: "Product name must be 2–120 characters." });
      if (!Number.isSafeInteger(priceInCents) || priceInCents < 50 || priceInCents > 100000000) return out(res, 400, { error: "Price must be between $0.50 and $1,000,000.00." });
      if (!/^[a-z]{3}$/.test(currency)) return out(res, 400, { error: "Currency must be a 3-letter code such as usd." });
      const product = await client.products.create({ name, ...(description ? { description } : {}), default_price_data: { unit_amount: priceInCents, currency } }, { stripeAccount: accountId });
      return out(res, 201, { product });
    }
    if (action === "subscription-checkout") {
      const accountId = await mapped(supabase, user.id);
      if (!accountId) return out(res, 409, { error: "Complete Stripe Connect onboarding first." });
      const priceId = process.env.STRIPE_CONNECT_SUBSCRIPTION_PRICE_ID;
      if (!priceId || !priceId.startsWith("price_")) return out(res, 503, { error: "Set STRIPE_CONNECT_SUBSCRIPTION_PRICE_ID to a recurring Price ID on the platform Stripe account." });
      const base = root(req);
      const session = await client.checkout.sessions.create({
        customer_account: accountId, mode: "subscription", line_items: [{ price: priceId, quantity: 1 }],
        success_url: base + "/?stripe-demo=1&subscription=success&session_id={CHECKOUT_SESSION_ID}",
        cancel_url: base + "/?stripe-demo=1&subscription=cancelled"
      });
      return out(res, 200, { url: session.url });
    }
    if (action === "billing-portal") {
      const accountId = await mapped(supabase, user.id);
      if (!accountId) return out(res, 409, { error: "Complete Stripe Connect onboarding first." });
      const session = await client.billingPortal.sessions.create({ customer_account: accountId, return_url: root(req) + "/?stripe-demo=1" });
      return out(res, 200, { url: session.url });
    }
    return out(res, 400, { error: "Unknown action. Use status, onboard, products, create-product, checkout, subscription-checkout, or billing-portal." });
  } catch (error) {
    console.error("Stripe API error:", error.message);
    return out(res, error.statusCode || 500, { error: error.statusCode ? error.message : "Stripe request failed. Check server-side configuration and Stripe Dashboard logs." });
  }
}