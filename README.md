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
