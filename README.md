# Neighbortask

React + Vite starter for the Neighbortask local task marketplace. Includes email/password registration and login, account roles, automatic profile creation through the existing Supabase trigger, and a signed-in dashboard showing open tasks.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` using the existing Supabase project settings.
4. Run `npm install`, then `npm run dev`.

Never put a Supabase service-role or secret key in browser code. The frontend must use the publishable/anon key and rely on Row Level Security.

## Supabase Auth

Email/password sign-up sends `display_name` and `role` metadata. The existing `on_auth_user_created_profile` trigger creates the matching `public.profiles` row. If email confirmation is enabled in Supabase Auth, the user must confirm their email before signing in.


## Task posting

Signed-in customers and members with the `both` role can post tasks from the dashboard. Task titles and descriptions are validated in the browser and again by the database constraints. Database Row Level Security must still authorize inserts and restrict users to their own records.

## Launch preparation

- [Deployment checklist](docs/DEPLOYMENT.md) (hosting setup and smoke tests).
- [Privacy policy draft](docs/PRIVACY-POLICY-DRAFT.md) — incomplete until bracketed fields are resolved and legally reviewed.
- [Terms of service draft](docs/TERMS-OF-SERVICE-DRAFT.md) — incomplete until bracketed fields are resolved and legally reviewed.

The policy and terms drafts are starting points only. Do not publish them without replacing placeholders and checking that they match the actual product, operating entity, data processors, age rules, and implemented payment/safety flows.
