#!/usr/bin/env node
// ============================================================
// 🎬 CinemaForTwo — Regenerate SAS URLs
// ============================================================
// Fixes all bare blob URLs (no SAS token) stored in Supabase
// after migrating to a new Azure Storage account.
//
// Usage:
//   node regenerate-sas-urls.mjs
//
// Requires these env vars (copy from your .env.local):
//   AZURE_STORAGE_ACCOUNT_NAME
//   AZURE_STORAGE_ACCOUNT_KEY
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import {
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} from '@azure/storage-blob';
import { createClient } from '@supabase/supabase-js';

// ── Config ──────────────────────────────────────────────────
const ACCOUNT_NAME = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const ACCOUNT_KEY  = process.env.AZURE_STORAGE_ACCOUNT_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!ACCOUNT_NAME || !ACCOUNT_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing env vars. Set AZURE_STORAGE_ACCOUNT_NAME, AZURE_STORAGE_ACCOUNT_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const credential = new StorageSharedKeyCredential(ACCOUNT_NAME, ACCOUNT_KEY);
const supabase   = createClient(SUPABASE_URL, SUPABASE_KEY);

// SAS expiry — 1 year for stored URLs
const EXPIRES_HOURS = 8760;

// ── Helpers ─────────────────────────────────────────────────

function needsNewSas(url) {
  // Regenerate ALL URLs — bare or old SAS tokens
  return url && url.includes('blob.core.windows.net');
}

function extractContainerAndBlob(url) {
  // Strip query string first, then parse
  const bare = url.split('?')[0];
  const match = bare.match(/blob\.core\.windows\.net\/([^/]+)\/(.+)/);
  if (!match) return null;
  return { containerName: match[1], blobName: decodeURIComponent(match[2]) };
}

function generateSasUrl(containerName, blobName) {
  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse('r'),
      startsOn:  new Date(Date.now() - 10 * 60 * 1000),
      expiresOn: new Date(Date.now() + EXPIRES_HOURS * 60 * 60 * 1000),
      protocol:  SASProtocol.Https,
      version:   '2021-12-02',
    },
    credential
  ).toString();
  return `https://${ACCOUNT_NAME}.blob.core.windows.net/${containerName}/${blobName}?${sasToken}`;
}

// ── Profiles (avatar_url) ────────────────────────────────────

async function fixProfiles() {
  const { data, error } = await supabase.from('profiles').select('id, avatar_url').not('avatar_url', 'is', null);
  if (error) { console.error('profiles fetch error', error); return; }

  let fixed = 0;
  for (const row of data) {
    if (!needsNewSas(row.avatar_url)) continue;
    const parts = extractContainerAndBlob(row.avatar_url);
    if (!parts) { console.warn(`⚠️  Skipping unparseable avatar: ${row.avatar_url}`); continue; }

    const newUrl = generateSasUrl(parts.containerName, parts.blobName);
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: newUrl })
      .eq('id', row.id);

    if (updateError) {
      console.error(`❌ Failed to update profile ${row.id}:`, updateError.message);
    } else {
      console.log(`✅ avatar  ${parts.blobName}`);
      fixed++;
    }
  }
  console.log(`→ Profiles: ${fixed} avatar(s) fixed\n`);
}

// ── Postcards (image_url) ────────────────────────────────────

async function fixPostcards() {
  const { data, error } = await supabase.from('postcards').select('id, image_url');
  if (error) { console.error('postcards fetch error', error); return; }

  let fixed = 0;
  for (const row of data) {
    if (!needsNewSas(row.image_url)) continue;
    const parts = extractContainerAndBlob(row.image_url);
    if (!parts) { console.warn(`⚠️  Skipping unparseable postcard: ${row.image_url}`); continue; }

    const newUrl = generateSasUrl(parts.containerName, parts.blobName);
    const { error: updateError } = await supabase
      .from('postcards')
      .update({ image_url: newUrl })
      .eq('id', row.id);

    if (updateError) {
      console.error(`❌ Failed to update postcard ${row.id}:`, updateError.message);
    } else {
      console.log(`✅ postcard ${parts.blobName}`);
      fixed++;
    }
  }
  console.log(`→ Postcards: ${fixed} image(s) fixed\n`);
}

// ── Movies (blob_url + poster_url + subtitles JSON) ──────────

async function fixMovies() {
  const { data, error } = await supabase.from('movies').select('id, blob_url, poster_url, subtitles');
  if (error) { console.error('movies fetch error', error); return; }

  let fixedBlobs = 0, fixedPosters = 0, fixedSubs = 0;

  for (const row of data) {
    const updates = {};

    // blob_url (actual movie file)
    if (row.blob_url && needsNewSas(row.blob_url)) {
      const bare = row.blob_url.split('?')[0];
      const parts = extractContainerAndBlob(bare);
      if (parts) {
        updates.blob_url = generateSasUrl(parts.containerName, parts.blobName);
        fixedBlobs++;
        console.log(`✅ movie    ${parts.blobName}`);
      }
    }

    // poster_url
    if (row.poster_url && needsNewSas(row.poster_url)) {
      const bare = row.poster_url.split('?')[0];
      const parts = extractContainerAndBlob(bare);
      if (parts) {
        updates.poster_url = generateSasUrl(parts.containerName, parts.blobName);
        fixedPosters++;
        console.log(`✅ poster   ${parts.blobName}`);
      }
    }

    // subtitles JSONB array
    const subs = Array.isArray(row.subtitles) ? row.subtitles : [];
    const newSubs = subs.map(sub => {
      if (!sub.url || !needsNewSas(sub.url)) return sub;
      const bare = sub.url.split('?')[0];
      const parts = extractContainerAndBlob(bare);
      if (!parts) return sub;
      fixedSubs++;
      console.log(`✅ subtitle ${parts.blobName}`);
      return { ...sub, url: generateSasUrl(parts.containerName, parts.blobName) };
    });

    if (JSON.stringify(newSubs) !== JSON.stringify(subs)) {
      updates.subtitles = newSubs;
    }

    if (Object.keys(updates).length === 0) continue;

    const { error: updateError } = await supabase
      .from('movies')
      .update(updates)
      .eq('id', row.id);

    if (updateError) {
      console.error(`❌ Failed to update movie ${row.id}:`, updateError.message);
    }
  }
  console.log(`→ Movies: ${fixedBlobs} movie file(s), ${fixedPosters} poster(s), ${fixedSubs} subtitle(s) fixed\n`);
}

// ── Main ─────────────────────────────────────────────────────

console.log(`\n🎬 CinemaForTwo — Regenerating SAS URLs`);
console.log(`   Account : ${ACCOUNT_NAME}`);
console.log(`   Expires : ${EXPIRES_HOURS}h (1 year)\n`);

await fixProfiles();
await fixPostcards();
await fixMovies();

console.log('🎉 Done!');