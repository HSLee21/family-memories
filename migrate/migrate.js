// One-time migration: copies every file out of the Supabase Storage bucket
// "family-media" into your new Backblaze B2 bucket, preserving the exact
// same path/key. Because file_path values in Postgres stay identical,
// nothing in the database needs to change - the app just starts reading
// the same paths from B2 instead of Supabase Storage.
//
// Run locally (NOT in a browser): this needs your Supabase service_role
// key and your B2 application key, neither of which should ever be public.
//
// Setup:
//   npm install @supabase/supabase-js @aws-sdk/client-s3
//   cp .env.example .env   (then fill in the real values)
//   node migrate.js
//
// Safe to re-run: it skips files that already exist in B2 unless
// FORCE_OVERWRITE=true.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_BUCKET = "family-media",
  B2_KEY_ID,
  B2_APPLICATION_KEY,
  B2_REGION,
  B2_BUCKET_NAME,
  FORCE_OVERWRITE = "false"
} = process.env;

for (const [name, val] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, B2_KEY_ID, B2_APPLICATION_KEY, B2_REGION, B2_BUCKET_NAME })) {
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const s3 = new S3Client({
  endpoint: `https://s3.${B2_REGION}.backblazeb2.com`,
  region: B2_REGION,
  credentials: { accessKeyId: B2_KEY_ID, secretAccessKey: B2_APPLICATION_KEY }
});

// Recursively lists every file under `prefix` in the Supabase bucket.
async function listAllFiles(prefix = "") {
  const results = [];
  const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).list(prefix, { limit: 1000 });
  if (error) throw error;

  for (const entry of data) {
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    // Supabase Storage "folders" show up as entries with id === null and no metadata.
    if (entry.id === null) {
      const nested = await listAllFiles(fullPath);
      results.push(...nested);
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

async function existsInB2(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: B2_BUCKET_NAME, Key: key }));
    return true;
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

async function migrateFile(path) {
  if (FORCE_OVERWRITE !== "true" && (await existsInB2(path))) {
    console.log(`SKIP (already in B2): ${path}`);
    return;
  }

  const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).download(path);
  if (error) {
    console.error(`FAILED to download ${path}:`, error.message);
    return;
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  const contentType = data.type || "application/octet-stream";

  await s3.send(new PutObjectCommand({
    Bucket: B2_BUCKET_NAME,
    Key: path,
    Body: buffer,
    ContentType: contentType
  }));

  console.log(`OK: ${path} (${buffer.length} bytes)`);
}

async function main() {
  console.log(`Listing files in Supabase bucket "${SUPABASE_BUCKET}"...`);
  const files = await listAllFiles();
  console.log(`Found ${files.length} files. Starting migration to B2 bucket "${B2_BUCKET_NAME}"...\n`);

  let ok = 0, failed = 0;
  for (const path of files) {
    try {
      await migrateFile(path);
      ok++;
    } catch (err) {
      failed++;
      console.error(`FAILED: ${path}:`, err.message);
    }
  }

  console.log(`\nDone. ${ok} succeeded, ${failed} failed, out of ${files.length} total.`);
  if (failed > 0) process.exitCode = 1;
}

main();
