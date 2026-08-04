// Supabase frontend configuration.
// The publishable key is safe for browser use when RLS and Storage policies are correctly configured.
window.APP_CONFIG = {
  SUPABASE_URL: "https://aekljejbojikghoyujrc.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_iN4x21Ql7nFOuWa3qZ3L4g_XxJZRs90",
  // Media (photos/videos/music) now lives in Backblaze B2. This Worker is
  // the only thing holding B2 credentials - the browser only ever talks to
  // the presigned URLs it hands back. Replace with your deployed Worker's
  // URL (e.g. https://family-memories-b2.YOURSUBDOMAIN.workers.dev).
  WORKER_URL: "https://family-memories-b2.hueyshiuan21.workers.dev"
};
