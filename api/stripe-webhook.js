import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Raw body is required for Stripe signature verification; disable Vercel's JSON body parser.
export const config = { api: { bodyParser: false } };
function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
function reply(res, code, data) { return res.status(code).json(data); }
function adminDb() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel before enabling webhooks.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export default async function handler(req, res) {
  if (req.method !== "POST") return reply(res, 405, { error: "POST only" });
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return reply(res, 503, { error: "STRIPE_SECRET_KEY is not configured." });
  const signature = req.headers["stripe-signature"];
  if (!signature) return reply(res, 400, { error: "Missing Stripe-Signature header." });
  const client = new Stripe(key);
  try {
    const body = await rawBody(req);
    // Thin events and snapshot events use different verification methods. Try the configured thin
    // secret first, then the standard webhook secret; use separate Dashboard destinations/secrets.
    let thinEvent = null;
    if (process.env.STRIPE_THIN_WEBHOOK_SECRET) {
      try { thinEvent = client.parseThinEvent(body, signature, process.env.STRIPE_THIN_WEBHOOK_SECRET); } catch (_) { /* This may be a standard snapshot event. */ }
    }
    if (thinEvent) {
      const event = await client.v2.core.events.retrieve(thinEvent.id);
      const type = event.type;
      const watched = new Set([
        "v2.core.account[requirements].updated",
        "v2.core.account[.recipient].capability_status_updated",
        "v2.core.account[configuration.merchant].capability_status_updated",
        "v2.core.account[configuration.customer].capability_status_updated"
      ]);
      if (!watched.has(type)) return reply(res, 200, { received: true, ignored: true });
      const accountId = event.related_object?.id || event.data?.object?.id || event.context?.account;
      if (!accountId || !String(accountId).startsWith("acct_")) {
        console.warn("Stripe thin event did not include an account ID", type);
        return reply(res, 200, { received: true, warning: "No account ID in event." });
      }
      // Fetch the current account requirements directly. This also handles requirements changing
      // after onboarding because of regulators, card networks, or Stripe risk reviews.
      const account = await client.v2.core.accounts.retrieve(accountId, {
        include: ["configuration.merchant", "configuration.customer", "requirements"]
      });
      const requirements = (account.requirements?.entries || []).map(entry => ({
        requirement: entry.requirement, status: entry.status, deadline: entry.deadline || null
      }));
      // TODO: send this list to the provider's notification center/email. Status itself is not cached;
      // the dashboard reads live status from Stripe each time it opens.
      console.info("Collected Stripe V2 requirements update", { accountId, type, requirements });
      return reply(res, 200, { received: true, accountId, eventType: type, requirementsCollected: requirements.length });
    }

    const standardSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!standardSecret) return reply(res, 503, { error: "Set STRIPE_WEBHOOK_SECRET for standard snapshot events." });
    let event;
    try { event = client.webhooks.constructEvent(body, signature, standardSecret); }
    catch (_) { return reply(res, 400, { error: "Invalid Stripe webhook signature. Confirm the destination uses the matching signing secret." }); }

    const db = adminDb();
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const metadata = session.metadata || {};
        if (metadata.handyneighbor_task_payment === "true" && session.payment_status === "paid") {
          const taskId = metadata.task_id;
          const customerId = metadata.customer_id;
          const applicationId = metadata.application_id;
          if (!taskId || !customerId || !applicationId) {
            console.warn("Task checkout completed without required metadata", session.id);
            break;
          }
          const { data: application, error: applicationError } = await db
            .from("job_applications")
            .select("id,job_id,provider_id,status")
            .eq("id", applicationId)
            .eq("job_id", taskId)
            .eq("provider_id", metadata.provider_id)
            .maybeSingle();
          if (applicationError) throw new Error("Could not verify the task application for completed checkout.");
          if (!application || application.status !== "accepted") {
            console.warn("Ignoring completed task checkout for an offer that is no longer accepted", session.id);
            break;
          }
          const { error: paidError } = await db
            .from("jobs")
            .update({ paid_at: new Date().toISOString() })
            .eq("id", taskId)
            .eq("customer_id", customerId)
            .is("paid_at", null);
          if (paidError) throw new Error("Could not record completed task checkout.");
          console.info("HandyNeighbor task payment recorded", { sessionId: session.id, taskId });
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const s = event.data.object;
        // For V2 accounts, prefer customer_account; do not assume customer is always the account ID.
        const accountId = s.customer_account || (typeof s.customer === "string" ? s.customer : s.customer?.id) || null;
        const { error } = await db.from("stripe_subscriptions").upsert({
          stripe_subscription_id: s.id,
          customer_account_id: accountId,
          status: s.status || (event.type.endsWith(".deleted") ? "canceled" : "unknown"),
          price_id: s.items?.data?.[0]?.price?.id || null,
          quantity: s.items?.data?.[0]?.quantity || 1,
          cancel_at_period_end: Boolean(s.cancel_at_period_end),
          current_period_end: s.current_period_end ? new Date(s.current_period_end * 1000).toISOString() : null,
          updated_at: new Date().toISOString()
        }, { onConflict: "stripe_subscription_id" });
        if (error) throw new Error("Could not persist subscription status; apply the included Supabase migration.");
        break;
      }
      case "invoice.paid":
        // TODO: verify the related subscription is active and grant/renew the associated paid feature.
        console.info("Stripe invoice paid", event.data.object.id);
        break;
      case "payment_method.attached":
      case "payment_method.detached":
      case "customer.updated":
      case "customer.tax_id.created":
      case "customer.tax_id.deleted":
      case "customer.tax_id.updated":
      case "billing_portal.configuration.created":
      case "billing_portal.configuration.updated":
      case "billing_portal.session.created":
        // TODO: update any future billing-preference records. Never use billing email as a login credential.
        console.info("Stripe billing event received", event.type);
        break;
      default:
        console.info("Stripe event received but not otherwise handled", event.type);
    }
    return reply(res, 200, { received: true });
  } catch (error) {
    console.error("Stripe webhook processing error:", error.message);
    return reply(res, 500, { error: "Webhook processing failed. Review server logs and retry delivery in Stripe Dashboard." });
  }
}