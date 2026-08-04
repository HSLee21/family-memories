# Family Memories — B2 Migration: Deploy Guide

Architecture after this change:

```
Browser (GitHub Pages)
  │
  ├── Supabase Auth + Postgres  (login, profiles, memories/trips/etc rows)
  │
  └── Cloudflare Worker  ──────►  Backblaze B2 (private bucket)
      (checks the user is an        (all photos, videos, music)
       approved family member,
       then hands back a
       short-lived signed URL)
```

The browser never sees a B2 key. The Worker is the only thing holding
B2 credentials and your Supabase `service_role` key.

---

## 1. Backblaze B2

1. Sign up at backblaze.com → Buckets → **Create a Bucket**.
   - Name: `family-media` (or anything — you'll put the real name in config)
   - Files in bucket: **Private**
2. Note the **Endpoint** shown for the bucket, e.g. `s3.us-west-004.backblazeb2.com` — the `us-west-004` part is your `B2_REGION`.
3. Account → **App Keys** → **Add a New Application Key**.
   - Restrict to this bucket only.
   - Copy the **keyID** and **applicationKey** immediately (the applicationKey is shown once).
4. **CORS** — B2 blocks browser PUT/GET from your presigned URLs unless the bucket's CORS rules allow your site's origin. Easiest way is the `b2` CLI:
   ```bash
   pip install b2
   b2 account authorize <keyID> <applicationKey>
   b2 bucket update family-media allPrivate \
     --corsRules '[{
       "corsRuleName": "family-memories-app",
       "allowedOrigins": ["https://hslee21.github.io"],
       "allowedOperations": ["s3_get","s3_put","s3_head"],
       "allowedHeaders": ["*"],
       "maxAgeSeconds": 3600
     }]'
   ```

## 2. Cloudflare Worker

Files: `worker/` in this bundle.

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put B2_KEY_ID
npx wrangler secret put B2_APPLICATION_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # from Supabase → Project Settings → API
npx wrangler deploy
```

Before deploying, edit `wrangler.toml`:
- `B2_REGION` / `B2_BUCKET_NAME` → match what you created in step 1
- `ALLOWED_ORIGIN` → already set to `https://hslee21.github.io` in `wrangler.toml`

`wrangler deploy` prints your Worker URL, like:
`https://family-memories-b2.YOURSUBDOMAIN.workers.dev`

## 3. Point the app at the Worker

In `app/config.js`, set:
```js
WORKER_URL: "https://family-memories-b2.YOURSUBDOMAIN.workers.dev"
```

## 4. Migrate existing files from Supabase Storage → B2

Files: `migrate/` in this bundle. Run this **locally**, not on GitHub Pages.

```bash
cd migrate
npm install
cp .env.example .env
# edit .env: paste Supabase service_role key + B2 keyID/applicationKey/region/bucket
node migrate.js
```

It copies every file, preserving the exact same path, so nothing in your
Postgres tables (`file_path` columns) needs to change.

## 5. Test before cutting over

- Run the app locally against the new `config.js`/`app.js`, sign in, upload a
  photo and a short video, confirm they load back correctly, delete one.
- Check the Worker's logs (`npx wrangler tail`) if anything 401/403s.

## 6. Ship it

```bash
git add .
git commit -m "Move media storage from Supabase Storage to Backblaze B2"
git push
```

GitHub Pages redeploys automatically from the branch it's configured to serve.

## 7. Clean up (optional, once you've verified everything for a while)

- Delete the old files in the Supabase `family-media` storage bucket to stop
  paying for both copies (Supabase dashboard → Storage).
- Rotate the Supabase `service_role` key if it was ever pasted anywhere
  outside the Worker's `wrangler secret`.

---

## What I need from you to go further

I can't reach Cloudflare, Backblaze, or Supabase's APIs from my sandbox, so
I can't click through those dashboards or run `wrangler deploy` myself. If
you'd like me to **push these files directly to your GitHub repo** instead of
you copying them manually, share a GitHub personal access token (repo scope)
and I'll do that part.
