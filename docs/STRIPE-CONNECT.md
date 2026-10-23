# Stripe Connect sample for HandyNeighbor

This commented integration is added alongside the existing task marketplace. Open \`/?stripe-demo=1\` after deployment. It does not replace the main dashboard.

## Included

- V2 connected-account creation and hosted onboarding.
- Onboarding and card-payment readiness read directly from Stripe; no cached status.
- Supabase mapping from the signed-in user to their connected account.
- Product creation/listing using the connected-account Stripe-Account request option.
- Hosted Checkout direct charges with a configurable application fee.
- Platform subscription Checkout and billing portal.
- V2 Thin Event handling for account requirement/capability changes and standard subscription/billing webhooks.

## Required server-side Vercel environment variables

Set these for the environments where you will test/deploy. Do not expose server secrets through a VITE_ variable.

- \`STRIPE_SECRET_KEY\`: placeholder \`sk_test_REPLACE_WITH_A_NEW_TEST_SECRET_KEY\`. Use a newly rotated/test secret key; do not reuse any key pasted into chat. Use test mode first.
- \`SUPABASE_URL\`: placeholder \`https://YOUR_PROJECT_REF.supabase.co\`.
- \`SUPABASE_SERVICE_ROLE_KEY\`: placeholder \`REPLACE_WITH_SUPABASE_SERVICE_ROLE_KEY\`. This is highly privileged and must stay server-side.
- \`APP_URL\`: placeholder \`https://YOUR-PRODUCTION-DOMAIN.example\`, no trailing slash.
- \`STRIPE_APPLICATION_FEE_PERCENT\`: optional; defaults to 10; allowed range 0–25.
- \`STRIPE_CONNECT_SUBSCRIPTION_PRICE_ID\`: optional; a recurring platform Price ID such as \`price_REPLACE_ME\`.
- \`STRIPE_THIN_WEBHOOK_SECRET\`: signing secret for the thin-event destination.
- \`STRIPE_WEBHOOK_SECRET\`: signing secret for the standard snapshot webhook destination.

The existing \`VITE_SUPABASE_URL\` and \`VITE_SUPABASE_PUBLISHABLE_KEY\` remain browser-side values only.

## Database setup

Apply \`supabase/migrations/202610230001_stripe_connect.sql\` in the Supabase SQL editor. The server uses the service-role key to store the mapping. The onboarding status is retrieved from Stripe on demand.

## Stripe Dashboard webhook setup

Create two webhook destinations to \`https://YOUR-DOMAIN.example/api/stripe-webhook\`:

1. **Thin events** for connected accounts: \`v2.core.account[requirements].updated\`, \`v2.core.account[.recipient].capability_status_updated\`, \`v2.core.account[configuration.merchant].capability_status_updated\`, and \`v2.core.account[configuration.customer].capability_status_updated\`. Copy its signing secret into \`STRIPE_THIN_WEBHOOK_SECRET\`.
2. **Standard snapshot events**: \`customer.subscription.updated\`, \`customer.subscription.deleted\`, \`invoice.paid\`, \`payment_method.attached\`, \`payment_method.detached\`, \`customer.updated\`, \`customer.tax_id.created\`, \`customer.tax_id.deleted\`, \`customer.tax_id.updated\`, \`billing_portal.configuration.created\`, \`billing_portal.configuration.updated\`, and \`billing_portal.session.created\`. Copy its signing secret into \`STRIPE_WEBHOOK_SECRET\`.

Create a recurring Price on the platform Stripe account before enabling provider subscriptions.

## Local testing

Run a local Vercel Functions runtime (for example \`vercel dev\`) alongside the Vite app; plain \`npm run dev\` does not execute the \`api/*\` serverless functions.

\`\`\`bash
stripe listen --thin-events 'v2.core.account[requirements].updated,v2.core.account[.recipient].capability_status_updated,v2.core.account[configuration.merchant].capability_status_updated,v2.core.account[configuration.customer].capability_status_updated' --forward-thin-to http://localhost:3000/api/stripe-webhook
\`\`\`

## Production follow-ups

- Replace raw account IDs in storefront URLs with a public seller slug.
- Add rate limiting, idempotency keys, and a webhook event ledger for retry-safe processing.
- Implement actual product/service entitlement grants and revocations from subscription status; webhook handlers currently save subscription state and include explicit TODOs.
- Test the V2 account and thin-event methods in Stripe test mode before going live. Review refunds, disputes, tax, legal obligations, platform liability, and account capabilities before accepting live payments.
