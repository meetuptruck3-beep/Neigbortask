import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase.js";

const page = { maxWidth: 960, margin: "0 auto", padding: "28px 18px 60px", color: "#233747", fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" };
const panel = { background: "#fff", border: "1px solid #dce8ee", borderRadius: 16, padding: 20, boxShadow: "0 8px 28px rgba(35,55,71,.06)" };
const field = { width: "100%", boxSizing: "border-box", padding: "11px 12px", border: "1px solid #cbd9e2", borderRadius: 9, marginTop: 6, font: "inherit" };
const button = { border: 0, borderRadius: 9, padding: "11px 15px", background: "#8ecde7", color: "#183747", fontWeight: 750, cursor: "pointer", font: "inherit" };

export default function StripeConnectDemo() {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState(null);
  const [products, setProducts] = useState([]);
  const [storeAccountId, setStoreAccountId] = useState(new URLSearchParams(window.location.search).get("accountId") || "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("15.00");
  const [currency, setCurrency] = useState("usd");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const callApi = useCallback(async (action, method = "GET", body = null, query = "") => {
    const token = session?.access_token;
    const response = await fetch("/api/stripe?action=" + encodeURIComponent(action) + query, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: "Bearer " + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Stripe request failed.");
    return data;
  }, [session]);

  const refreshStatus = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const data = await callApi("status");
      setStatus(data);
      if (data.accountId) setStoreAccountId(current => current || data.accountId);
    } catch (e) { setError(e.message); }
  }, [callApi, session]);

  const refreshProducts = useCallback(async (id = storeAccountId) => {
    if (!id) { setProducts([]); return; }
    try {
      const response = await fetch("/api/stripe?action=products&accountId=" + encodeURIComponent(id));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load products.");
      setProducts(data.products || []);
    } catch (e) { setError(e.message); }
  }, [storeAccountId]);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("onboarding") === "return") setNotice("You returned from Stripe. The account status below is being checked directly with Stripe.");
    if (q.get("checkout") === "success") setNotice("Checkout returned successfully. Verify payment completion from Stripe webhooks before marking an order paid.");
    if (q.get("checkout") === "cancelled") setNotice("Checkout was cancelled; no purchase was completed.");
    if (q.get("subscription") === "success") setNotice("Subscription Checkout returned successfully. Confirm active status using the subscription webhook.");
  }, []);

  async function run(label, action, method = "POST", body = null) {
    setBusy(label); setError(""); setNotice("");
    try {
      const result = await callApi(action, method, body);
      if (result.url) { window.location.assign(result.url); return; }
      setNotice("Saved. Stripe returned the latest result.");
      if (action === "create-product") { setName(""); setDescription(""); await refreshProducts(status?.accountId || storeAccountId); }
      if (action === "onboard") setStoreAccountId(result.accountId || "");
      await refreshStatus();
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }

  const money = (priceObj) => {
    if (!priceObj || typeof priceObj !== "object" || typeof priceObj.unit_amount !== "number") return "Price unavailable";
    return new Intl.NumberFormat(undefined, { style: "currency", currency: (priceObj.currency || "usd").toUpperCase() }).format(priceObj.unit_amount / 100);
  };

  return <main style={{ minHeight: "100vh", background: "#f4f9fc" }}>
    <div style={page}>
      <a href="/" style={{ color: "#477b94", textDecoration: "none", fontWeight: 700 }}>← Back to HandyNeighbor</a>
      <header style={{ margin: "20px 0 26px" }}>
        <p style={{ color: "#528ba6", fontWeight: 800, letterSpacing: 1.2, marginBottom: 6 }}>HANDYNEIGHBOR • PAYMENTS DEMO</p>
        <h1 style={{ fontSize: "clamp(28px,5vw,40px)", margin: "0 0 8px" }}>Stripe Connect</h1>
        <p style={{ maxWidth: 680, lineHeight: 1.6, color: "#5b6e7b" }}>A sample seller onboarding, product catalog, and hosted checkout flow. This demo uses Stripe test mode first; payment readiness is fetched live from Stripe.</p>
      </header>
      {notice && <div role="status" style={{ ...panel, marginBottom: 16, background: "#f0fbff" }}>{notice}</div>}
      {error && <div role="alert" style={{ ...panel, marginBottom: 16, borderColor: "#e5a5a5", color: "#8b2f2f" }}>{error}</div>}
      {!session && <section style={{ ...panel, marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Sign in required for seller tools</h2>
        <p>Sign in to HandyNeighbor, then reopen this demo. The public storefront can still be loaded below using a connected account ID.</p>
        <a href="/" style={{ color: "#477b94", fontWeight: 700 }}>Go to sign in</a>
      </section>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))", gap: 18 }}>
        <section style={panel}>
          <h2 style={{ marginTop: 0 }}>1. Seller onboarding</h2>
          <p style={{ lineHeight: 1.55, color: "#5b6e7b" }}>Create or resume your connected account and continue in Stripe's hosted onboarding form.</p>
          <div style={{ padding: 12, borderRadius: 10, background: "#f3f8fb", margin: "12px 0" }}>
            <strong>Status: </strong>{!status ? "Checking Stripe…" : !status.accountId ? "Not started" : status.readyToProcessPayments ? "Ready to accept card payments" : status.onboardingComplete ? "Details submitted; payments not active yet" : "More onboarding required"}
            {status?.accountId && <p style={{ overflowWrap: "anywhere", fontSize: 12, marginBottom: 0 }}>Account ID: {status.accountId}</p>}
            {status?.currentlyDue?.length > 0 && <p style={{ fontSize: 13 }}>Currently due: {status.currentlyDue.join(", ")}</p>}
            {status?.pastDue?.length > 0 && <p style={{ fontSize: 13 }}>Past due: {status.pastDue.join(", ")}</p>}
          </div>
          <button style={button} disabled={!session || !!busy} onClick={() => run("onboard", "onboard")}>{busy === "onboard" ? "Opening Stripe…" : "Onboard to collect payments"}</button>
          <button style={{ ...button, marginLeft: 8, background: "#e7f0f5" }} disabled={!session || !!busy} onClick={refreshStatus}>Refresh status</button>
        </section>

        <section style={panel}>
          <h2 style={{ marginTop: 0 }}>2. Create a product</h2>
          <p style={{ lineHeight: 1.55, color: "#5b6e7b" }}>Products are created on your connected account, not on the platform account.</p>
          <form onSubmit={e => { e.preventDefault(); run("create-product", "create-product", "POST", { name, description, priceInCents: Math.round(Number(price) * 100), currency }); }}>
            <label>Product name<input required minLength={2} maxLength={120} value={name} onChange={e => setName(e.target.value)} style={field} placeholder="e.g. Yard cleanup" /></label>
            <label style={{ display: "block", marginTop: 12 }}>Description<input value={description} onChange={e => setDescription(e.target.value)} style={field} placeholder="What's included?" /></label>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10, marginTop: 12 }}>
              <label>Price<input required type="number" min="0.50" max="1000000" step="0.01" value={price} onChange={e => setPrice(e.target.value)} style={field} /></label>
              <label>Currency<select value={currency} onChange={e => setCurrency(e.target.value)} style={field}><option value="usd">USD</option><option value="cad">CAD</option><option value="gbp">GBP</option></select></label>
            </div>
            <button style={{ ...button, marginTop: 16 }} disabled={!session || !status?.accountId || !!busy}>{busy === "create-product" ? "Creating…" : "Create product"}</button>
          </form>
        </section>

        <section style={panel}>
          <h2 style={{ marginTop: 0 }}>3. Provider subscription</h2>
          <p style={{ lineHeight: 1.55, color: "#5b6e7b" }}>Optional platform subscription. Configure a recurring Price ID in STRIPE_CONNECT_SUBSCRIPTION_PRICE_ID.</p>
          <button style={button} disabled={!session || !status?.accountId || !!busy} onClick={() => run("subscription-checkout", "subscription-checkout")}>Subscribe with Checkout</button>
          <button style={{ ...button, marginLeft: 8, background: "#e7f0f5" }} disabled={!session || !status?.accountId || !!busy} onClick={() => run("billing-portal", "billing-portal")}>Manage subscription</button>
        </section>

        <section style={panel}>
          <h2 style={{ marginTop: 0 }}>4. Public storefront</h2>
          <p style={{ lineHeight: 1.55, color: "#5b6e7b" }}>Enter a connected account ID to show its active products. Production should use a stable public seller slug instead of an acct_ ID in the URL.</p>
          <label>Connected account ID<input value={storeAccountId} onChange={e => setStoreAccountId(e.target.value)} style={field} placeholder="acct_…" /></label>
          <button style={{ ...button, marginTop: 12 }} disabled={!storeAccountId} onClick={() => refreshProducts(storeAccountId)}>Load storefront</button>
          <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
            {products.map(p => <article key={p.id} style={{ border: "1px solid #dce8ee", borderRadius: 12, padding: 14 }}>
              <h3 style={{ margin: "0 0 6px" }}>{p.name}</h3>
              {p.description && <p style={{ margin: "0 0 10px", color: "#5b6e7b" }}>{p.description}</p>}
              <strong>{money(p.default_price)}</strong>
              <div><button style={{ ...button, marginTop: 10 }} disabled={!session || !!busy || !status?.readyToProcessPayments} onClick={() => run("checkout-" + p.id, "checkout", "POST", { accountId: storeAccountId, productId: p.id })}>Buy with Stripe Checkout</button></div>
            </article>)}
            {products.length === 0 && <p style={{ color: "#6c7e89" }}>No products loaded yet. Load a storefront above after a seller creates a product.</p>}
          </div>
        </section>
      </div>
      <p style={{ marginTop: 24, color: "#758692", fontSize: 12, lineHeight: 1.6 }}>Sample integration only. Use Stripe test mode first. Do not treat a browser redirect as proof of payment; verify payment and subscription webhooks server-side before granting services.</p>
    </div>
  </main>;
}