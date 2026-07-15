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
