// Family Memories - B2 Signing Worker
//
// This Worker is the ONLY thing that ever holds Backblaze B2 credentials.
// The browser app never talks to B2 directly except to PUT/GET the
// short-lived presigned URLs this Worker hands out.
//
// Endpoints (all require: Authorization: Bearer <supabase access token>)
//   POST /sign-upload    { path, contentType }         -> { url, expiresIn }
//   POST /sign-download  { path, expiresIn? }           -> { url, expiresIn }
//   POST /delete         { path }                       -> { ok: true }
//
// Access model (mirrors the app's existing behaviour):
//   - Must belong to an "approved" row in the Supabase `profiles` table.
//   - Uploads and deletes are only allowed inside the caller's own
//     "<user_id>/..." folder (matches the storage.foldername RLS pattern
//     the app already used with Supabase Storage).
//   - Downloads (signed GET URLs) are allowed for any path, since family
//     content (memories/trips/celebrations/study materials) is shared
//     across approved family members and is already gated by Postgres RLS
//     on the metadata tables, not by storage path.
//
// If your real access rules differ (e.g. you want per-user read
// restrictions too), tighten the checks in `assertCanRead`.

import { AwsClient } from "aws4fetch";

const JSON_HEADERS = { "content-type": "application/json" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function corsHeaders(origin, env) {
  const allowed = env.ALLOWED_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": allowed === "*" ? "*" : (origin === allowed ? origin : allowed),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Max-Age": "86400"
  };
}

// Verify the Supabase access token and return { id, email }.
async function getSupabaseUser(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;

  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || !data.id) return null;
  return { id: data.id, email: data.email };
}

// Look up profile status/role using the service_role key (server-side only).
async function getProfile(userId, env) {
  const url = `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,status,role`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, body: body.slice(0, 300) };
  }
  const rows = await res.json();
  if (!rows || !rows[0]) {
    return { ok: false, status: res.status, body: "Query succeeded but no matching profile row was returned for this user id." };
  }
  return { ok: true, profile: rows[0] };
}

function ownsPath(userId, path) {
  return typeof path === "string" && (path === userId || path.startsWith(`${userId}/`));
}

function b2Endpoint(env) {
  // e.g. https://s3.us-west-004.backblazeb2.com
  return `https://s3.${env.B2_REGION}.backblazeb2.com`;
}

function objectUrl(env, path) {
  return `${b2Endpoint(env)}/${env.B2_BUCKET_NAME}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function getAwsClient(env) {
  return new AwsClient({
    accessKeyId: env.B2_KEY_ID,
    secretAccessKey: env.B2_APPLICATION_KEY,
    service: "s3",
    region: env.B2_REGION
  });
}

async function handleUpload(request, env, user) {
  const url = new URL(request.url);
  const path = url.searchParams.get("path");
  const contentType = url.searchParams.get("contentType") || request.headers.get("content-type") || "application/octet-stream";
  if (!path) return json({ error: "path query param is required" }, 400);
  if (!ownsPath(user.id, path)) {
    return json({ error: "You can only upload inside your own folder." }, 403);
  }

  const body = await request.arrayBuffer();
  const aws = getAwsClient(env);
  const res = await aws.fetch(objectUrl(env, path), {
    method: "PUT",
    headers: { "content-type": contentType },
    body
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return json({ error: `B2 upload failed: ${res.status} ${text}` }, 502);
  }
  return json({ ok: true });
}

async function handleSignUpload(request, env, user) {
  const { path, contentType } = await request.json();
  if (!path) return json({ error: "path is required" }, 400);
  if (!ownsPath(user.id, path)) {
    return json({ error: "You can only upload inside your own folder." }, 403);
  }

  const aws = getAwsClient(env);
  const expiresIn = 600; // 10 minutes to complete the upload
  const url = new URL(objectUrl(env, path));
  url.searchParams.set("X-Amz-Expires", String(expiresIn));

  const signedRequest = await aws.sign(url.toString(), {
    method: "PUT",
    headers: contentType ? { "content-type": contentType } : {},
    aws: { signQuery: true }
  });

  return json({ url: signedRequest.url, expiresIn, contentType: contentType || null });
}

async function handleSignDownload(request, env, user) {
  const { path, expiresIn } = await request.json();
  if (!path) return json({ error: "path is required" }, 400);
  // Downloads: any approved family member may read any family file.
  // (Tighten this to ownsPath(user.id, path) if you want strict per-user reads.)

  const ttl = Math.min(Math.max(Number(expiresIn) || 3600, 60), 86400);
  const aws = getAwsClient(env);
  const url = new URL(objectUrl(env, path));
  url.searchParams.set("X-Amz-Expires", String(ttl));

  const signedRequest = await aws.sign(url.toString(), {
    method: "GET",
    aws: { signQuery: true }
  });

  return json({ url: signedRequest.url, expiresIn: ttl });
}

// Unauthenticated on purpose - the person calling this has no Supabase
// session yet (that's the whole point of signing up). Safety instead comes
// from checking the `invites` table with the service_role key before ever
// creating an account, and from Postgres RLS on every other table once
// they're signed in - this endpoint's only job is the invite gate.
async function handleSignup(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Invalid request body." }, 400); }

  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const name = (body.name || "").trim();

  if (!email || !password) return json({ error: "Email and password are required." }, 400);
  if (password.length < 6) return json({ error: "Password must be at least 6 characters." }, 400);

  // 1. Only allow signup if this email is on the invites list.
  const inviteRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/invites?email=eq.${encodeURIComponent(email)}&select=email,role`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  if (!inviteRes.ok) {
    const t = await inviteRes.text().catch(() => "");
    return json({ error: `Could not check invitations (${inviteRes.status}): ${t.slice(0, 200)}` }, 502);
  }
  const invites = await inviteRes.json();
  const invite = invites && invites[0];
  if (!invite) {
    return json({ error: "This email hasn't been invited yet. Ask a family admin to invite you first." }, 403);
  }

  // 2. Create the account via the Admin API. This bypasses the project-wide
  // "allow signups" toggle entirely (so that toggle can stay OFF, closing
  // off open self-signup) and skips email verification, since the invite
  // itself is the vetting step.
  const createRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name } })
  });
  const createData = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    const msg = createData?.msg || createData?.message || createData?.error_description || `HTTP ${createRes.status}`;
    return json({ error: `Could not create account: ${msg}` }, createRes.status || 400);
  }
  const userId = createData.id;
  if (!userId) return json({ error: "Account creation returned no user id." }, 502);

  // 3. Upsert the profile with the role from the invite, auto-approved -
  // the invite itself was the admin's approval step, so there's no need
  // for a second manual "Approve" click for people who were invited.
  const profileRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({ id: userId, email, name: name || email, role: invite.role || "family", status: "approved" })
  });
  if (!profileRes.ok) {
    const t = await profileRes.text().catch(() => "");
    return json({ error: `Account created, but the profile could not be finalized (${profileRes.status}): ${t.slice(0, 200)}. Ask an admin to approve you manually.` }, 502);
  }

  // 4. Consume the invite so it moves from "Pending Invitations" to
  // "Family Members" in the admin page.
  await fetch(`${env.SUPABASE_URL}/rest/v1/invites?email=eq.${encodeURIComponent(email)}`, {
    method: "DELETE",
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
  }).catch(() => {});

  return json({ ok: true });
}

async function handleInvite(request, env, user, profile) {
  if (profile.role !== "admin") {
    return json({ error: "Only admins can send invitations." }, 403);
  }
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Invalid request body." }, 400); }
  const email = (body.email || "").trim().toLowerCase();
  const role = body.role || "family";
  if (!email) return json({ error: "Email is required." }, 400);

  // 1. Record the invite. Upsert so re-inviting the same person just
  // refreshes their row instead of erroring on a duplicate.
  const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/invites`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({ email, role, invited_by: user.id })
  });
  if (!insertRes.ok) {
    const t = await insertRes.text().catch(() => "");
    return json({ error: `Could not save the invite (${insertRes.status}): ${t.slice(0, 200)}` }, 502);
  }

  // 2. Send the actual email via Resend, if configured. If RESEND_API_KEY
  // isn't set, the invite is still saved - the admin just falls back to
  // sharing the app link themselves, same as before this endpoint existed.
  let emailSent = false;
  let emailError = null;
  if (env.RESEND_API_KEY) {
    const appUrl = env.APP_URL || env.ALLOWED_ORIGIN || "";
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.RESEND_FROM || "Family Memories <onboarding@resend.dev>",
        to: [email],
        subject: "You're invited to Family Memories",
        html: `<p>You've been invited to join <strong>Family Memories</strong>, a private space for family photos, trips, and memories.</p>
<p><a href="${appUrl}">Open Family Memories</a> and tap "Create account" using this email address (${email}) to get started.</p>
<p>If you weren't expecting this, you can ignore this email.</p>`
      })
    });
    if (emailRes.ok) {
      emailSent = true;
    } else {
      const t = await emailRes.text().catch(() => "");
      emailError = `HTTP ${emailRes.status}: ${t.slice(0, 200)}`;
    }
  }

  return json({ ok: true, emailSent, emailError });
}

async function handleDelete(request, env, user, profile) {
  const { path } = await request.json();
  if (!path) return json({ error: "path is required" }, 400);
  if (!ownsPath(user.id, path) && profile.role !== "admin") {
    return json({ error: "You can only delete your own files." }, 403);
  }

  const aws = getAwsClient(env);
  const res = await aws.fetch(objectUrl(env, path), { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    return json({ error: `B2 delete failed: ${res.status} ${text}` }, 502);
  }
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    if (request.method !== "POST") {
      return new Response("Not found", { status: 404, headers: cors });
    }

    const { pathname } = new URL(request.url);

    // /signup is the one endpoint that must work with no Supabase session
    // yet - it's how a person gets one in the first place.
    if (pathname === "/signup") {
      try {
        const resp = await handleSignup(request, env);
        const headers = new Headers(resp.headers);
        Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
        return new Response(resp.body, { status: resp.status, headers });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: { ...JSON_HEADERS, ...cors } });
      }
    }

    try {
      const user = await getSupabaseUser(request, env);
      if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...JSON_HEADERS, ...cors } });

      const profileResult = await getProfile(user.id, env);
      if (!profileResult.ok) {
        return new Response(JSON.stringify({
          error: `Account not approved (diagnostic: HTTP ${profileResult.status} - ${profileResult.body})`
        }), { status: 403, headers: { ...JSON_HEADERS, ...cors } });
      }
      const profile = profileResult.profile;
      if (profile.status !== "approved") {
        return new Response(JSON.stringify({ error: `Account not approved (status in database: "${profile.status}")` }), { status: 403, headers: { ...JSON_HEADERS, ...cors } });
      }

      let resp;
      if (pathname === "/upload") resp = await handleUpload(request, env, user);
      else if (pathname === "/sign-upload") resp = await handleSignUpload(request, env, user);
      else if (pathname === "/sign-download") resp = await handleSignDownload(request, env, user);
      else if (pathname === "/delete") resp = await handleDelete(request, env, user, profile);
      else if (pathname === "/invite") resp = await handleInvite(request, env, user, profile);
      else resp = new Response("Not found", { status: 404 });

      const headers = new Headers(resp.headers);
      Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
      return new Response(resp.body, { status: resp.status, headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: { ...JSON_HEADERS, ...cors } });
    }
  }
};
