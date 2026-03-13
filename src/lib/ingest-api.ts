/**
 * Server-side client for the Python Media Ingest API.
 *
 * Security model
 * ──────────────
 * • Every request is signed with a short-lived HMAC-HS256 JWT so the
 *   Python container can verify the call genuinely came from this app.
 * • Azure storage credentials travel in the signed request body — the
 *   container reads them per-job and never has them as env vars.
 * • The HMAC secret is the only thing that needs to be in the container's
 *   environment. Everything else is sent by Next.js at job-start time.
 *
 * Never import this from a client component.
 */

import { createHmac } from 'crypto';
import type { TorrentJob } from '@/types';

const BASE_URL    = process.env.INGEST_API_URL?.replace(/\/$/, '');
const HMAC_SECRET = process.env.INGEST_HMAC_SECRET ?? '';

if (!BASE_URL) {
  console.warn('[ingest-api] INGEST_API_URL is not set — torrent ingest will fail at runtime');
}
if (!HMAC_SECRET) {
  console.warn('[ingest-api] INGEST_HMAC_SECRET is not set — all requests will be rejected by the container');
}

// ── HMAC-HS256 JWT ────────────────────────────────────────────────────────────

function b64url(value: Buffer | string): string {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buf.toString('base64url');
}

function makeIngestToken(): string {
  const now     = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: 'ingest', iat: now, exp: now + 300 }));
  const signing = `${header}.${payload}`;
  const sig     = createHmac('sha256', HMAC_SECRET).update(signing).digest();
  return `${signing}.${b64url(sig)}`;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${makeIngestToken()}`,
    ...extra,
  };
}

// ── Response helper ───────────────────────────────────────────────────────────

async function expectJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? body.error ?? detail;
    } catch {}
    throw new Error(`Ingest API ${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

// ── Request type ──────────────────────────────────────────────────────────────

export interface IngestJobRequest {
  hash:            string;
  name:            string;    // display name / slug
  blob_base_name:  string;    // full path without extension: {userId}/{ts}-{slug}
  storage_account: string;    // Azure storage account name
  storage_key:     string;    // Azure storage account key
  container_name:  string;    // blob container (e.g. "movies")
  trackers?:       string[];
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function startIngestJob(
  req: IngestJobRequest,
): Promise<{ job_id: string; stage: string }> {
  const res = await fetch(`${BASE_URL}/download`, {
    method:  'POST',
    headers: authHeaders(),
    body:    JSON.stringify(req),
    cache:   'no-store',
  });
  return expectJson(res);
}

export async function getIngestJobStatus(jobId: string): Promise<TorrentJob> {
  const res = await fetch(`${BASE_URL}/status/${jobId}`, {
    headers: authHeaders(),
    cache:   'no-store',
  });
  return expectJson(res);
}

export async function cancelIngestJob(jobId: string): Promise<TorrentJob> {
  const res = await fetch(`${BASE_URL}/jobs/${jobId}`, {
    method:  'DELETE',
    headers: authHeaders(),
    cache:   'no-store',
  });
  return expectJson(res);
}

export function getIngestJobStream(jobId: string): Promise<Response> {
  return fetch(`${BASE_URL}/status/${jobId}/stream`, {
    headers: authHeaders({ Accept: 'text/event-stream' }),
    cache:   'no-store',
  });
}