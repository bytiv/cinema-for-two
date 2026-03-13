/**
 * POST /api/upload/ingest-sas
 *
 * Called exclusively by the Python ingest container — NOT by the browser.
 *
 * After downloading a torrent file and discovering its real extension
 * (.mp4, .mkv, …), the container POSTs here with:
 *   { blobBaseName: string, ext: string }   e.g. { "userId/ts-movietest", ".mkv" }
 *
 * This route:
 *   1. Verifies the inbound HMAC-HS256 JWT (same secret shared with the container)
 *   2. Builds the full blob name:  blobBaseName + ext  →  "userId/ts-movietest.mkv"
 *   3. Generates a write-scoped SAS URL  (upload, valid 2 hours)
 *   4. Generates a read-scoped  SAS URL  (watch,  valid 1 year)
 *   5. Returns { uploadUrl, blobUrl, blobName }
 *
 * The container then PUTs the video to uploadUrl and stores blobUrl as the
 * canonical URL in the job state — exactly the same shape as a direct upload.
 *
 * Security: No Azure credentials are ever sent to the container.
 * The container only receives a time-limited SAS signed here.
 */

import { NextResponse }          from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { generateUploadSasUrl, generateReadSasUrl, ensureContainers, CONTAINERS } from '@/lib/azure-blob';

// ── HMAC-HS256 JWT verification ───────────────────────────────────────────────
// Mirrors the logic in the Python container's _verify_hmac_jwt().

const HMAC_SECRET = process.env.INGEST_HMAC_SECRET ?? '';

function b64urlDecode(s: string): Buffer {
  // Restore padding that was stripped during encoding
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function verifyIngestJwt(token: string): boolean {
  if (!HMAC_SECRET) return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  // Verify signature
  const expectedSig = createHmac('sha256', HMAC_SECRET)
    .update(signingInput)
    .digest();
  let actualSig: Buffer;
  try {
    actualSig = b64urlDecode(sigB64);
  } catch {
    return false;
  }
  if (expectedSig.length !== actualSig.length) return false;
  if (!timingSafeEqual(expectedSig, actualSig)) return false;

  // Verify claims
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
  } catch {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now)   return false;
  if (typeof payload.iat !== 'number' || payload.iat > now + 30) return false;
  if (payload.sub !== 'ingest') return false;

  return true;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    // ── 1. Verify HMAC JWT from container ──────────────────────────────────
    const authorization = request.headers.get('authorization') ?? '';
    if (!authorization.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authorization.slice(7);
    if (!verifyIngestJwt(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── 2. Parse body ──────────────────────────────────────────────────────
    const body = await request.json();
    const { blobBaseName, ext } = body as { blobBaseName?: string; ext?: string };

    if (!blobBaseName?.trim()) {
      return NextResponse.json({ error: 'blobBaseName is required' }, { status: 400 });
    }
    if (!ext?.trim()) {
      return NextResponse.json({ error: 'ext is required' }, { status: 400 });
    }

    // ── 3. Build full blob name ────────────────────────────────────────────
    // Normalise ext to always have a leading dot: ".mkv", ".mp4", etc.
    const normalExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
    const blobName  = `${blobBaseName.trim()}${normalExt}`;
    // e.g. "a1b2c3d4-…/1712345678901-movietest.mkv"

    // ── 4. Ensure containers exist & generate SAS URLs ─────────────────────
    await ensureContainers();

    // Write SAS: 2-hour window — enough for large file uploads
    const uploadUrl = generateUploadSasUrl(CONTAINERS.movies, blobName, 2);

    // Read SAS: 1-year window — same as direct upload flow
    const blobUrl   = generateReadSasUrl(CONTAINERS.movies, blobName, 8760);

    // Clean URL (no SAS query string) — stored as the canonical blob_url in
    // torrent_jobs and movies rows, matching what save-ingest-movie.ts expects.
    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
    const cleanUrl    = `https://${accountName}.blob.core.windows.net/${CONTAINERS.movies}/${blobName}`;

    console.info(`[ingest-sas] Issued write SAS for blob: ${blobName}`);

    return NextResponse.json({
      uploadUrl,          // write SAS  — container PUTs the video here
      blobUrl:  cleanUrl, // clean URL  — stored as canonical reference
      readUrl:  blobUrl,  // read SAS   — optional, container ignores this
      blobName,           // full path  — useful for debugging
    });

  } catch (err: any) {
    console.error('[ingest-sas]', err);
    return NextResponse.json({ error: err.message ?? 'SAS generation failed' }, { status: 500 });
  }
}