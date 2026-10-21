# Deployment checklist

## Hosting

Import this repository into Vercel or Netlify. Configure the build command as `npm run build` and the output directory as `dist`.

Set these environment variables in the hosting dashboard:

- `VITE_SUPABASE_URL`: the Supabase project URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: the Supabase publishable key or legacy anon key.

Never put a Supabase service-role key or secret key in browser code or any `VITE_` variable.

## Before launch

1. Deploy a preview and confirm the site loads.
2. Test registration, email confirmation if enabled, login, page refresh, and logout.
3. Test task creation with a customer account and confirm providers cannot edit another user's task.
4. Test password reset, profile permissions, application permissions, and invalid input handling.
5. Check the browser console and hosting logs.
6. Review Supabase Security Advisors and test Row Level Security using separate accounts.
7. Set the final production URL and allowed redirect URLs in Supabase Authentication settings.

A successful frontend build does not prove database policies, email delivery, or marketplace safety controls. Complete a real production smoke test before sharing the app publicly.
