# Family Memories V1

Private family memories and study web app using Supabase.

## Setup

1. Open `config.js`.
2. Replace `PASTE_YOUR_SB_PUBLISHABLE_KEY_HERE` with the Supabase **publishable** key.
3. Commit the files to the GitHub repository.
4. Deploy the repository using a static hosting provider.
5. In Supabase Authentication → URL Configuration, add the deployed site URL to the allowed redirect URLs.

## Expected Supabase resources

- Authentication enabled with email/password.
- `profiles` table containing at least: `id`, `name`, `email`, `role`, `status`, `created_at`.
- Content tables: `memories`, `trips`, `celebrations`, `study_materials`.
- The app expects content fields such as `title`, `description`, `event_date`, `file_path`, `user_id`, `created_at`.
- Private Storage bucket: `family-media`.
- RLS and Storage policies that permit approved authenticated family members and restrict admin actions appropriately.

If the SQL schema created earlier uses different column names, update the payload/query fields in `app.js` before deployment.

## Security

Never place a Supabase secret key or `service_role` key in this repository or browser code. Only use the publishable key.


## V3 update
Added Forgot Password and password recovery flow using Supabase Auth.

## V5 update — Invite family members by email

Already applied to the live database (`V5_INVITES.sql` is kept for
reference / other environments, not something you need to run again here).

1. Go to the Profile page.
2. Tap **Family Admin**.
3. Enter the new family member's email address and pick a role (Admin or Member — stored in the database as `admin` / `family`).
4. Tap **Add Member**.
5. Share the Family Memories app link with the new family member.
6. They open the link and sign up (create an account with that same email +
   their own password — this is *not* passwordless, they set a password on
   first sign-up like anyone else).
7. Because their email matches an invite, they're automatically approved
   with the role the admin picked — no manual approval step needed.
8. Uninvited email addresses still fall back to the old flow: they land in
   "Approval pending" and an admin approves them manually from the same
   Family Admin page.
9. Sessions already persist automatically (Supabase's `persistSession` is
   on) — members only need to sign in again after signing out, clearing
   app/browser data, or reinstalling.
