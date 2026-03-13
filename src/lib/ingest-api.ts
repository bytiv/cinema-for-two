/**
 * Server-side client for the Python Media Ingest API.
 *
 * Security model
 * ──────────────
 * • Every request is signed with a short-lived HMAC-HS256 JWT so the
 *   Python container can verify the call genuinely came from this app.
 * • The container never receives any Azure storage credentials.
 *   The caller (ingest/start/route.ts) generates a write-scoped SAS URL
 *   and passes it here; we forward it to the container alongside the job.
 * • This file has zero imports from @/lib/azure-blob — all Azure details
 *   stay in the route handler that calls us.
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
// Minimal HS256 JWT using Node stdlib only (no third-party dep).
// The Python container verifies the same way (stdlib hmac + hashlib).
// Token TTL: 5 minutes — short enough to be useless if intercepted.

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
  hash:           string;
  name:           string;   // slug — container appends the file extension
  blob_base_name: string;   // full path without extension: {userId}/{ts}-{slug}
  sas_url:        string;   // write-scoped SAS URL for the target blob
  trackers?:      string[];
}

// ── API calls ─────────────────────────────────────────────────────────────────

/**
 * Start a new torrent ingest job.
 *
 * The caller is responsible for generating blob_base_name and sas_url
 * (see ingest/start/route.ts).  This function simply signs the request
 * and forwards it to the container — no Azure imports needed here.
 */
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

/** Fetch a single status snapshot for a job. */
export async function getIngestJobStatus(jobId: string): Promise<TorrentJob> {
  const res = await fetch(`${BASE_URL}/status/${jobId}`, {
    headers: authHeaders(),
    cache:   'no-store',
  });
  return expectJson(res);
}

/** Cancel a running job. Returns the final job state. */
export async function cancelIngestJob(jobId: string): Promise<TorrentJob> {
  const res = await fetch(`${BASE_URL}/jobs/${jobId}`, {
    method:  'DELETE',
    headers: authHeaders(),
    cache:   'no-store',
  });
  return expectJson(res);
}

/**
 * Returns the raw Response for the SSE stream endpoint.
 * Caller pipes the body to the browser — we do not buffer it.
 */
export function getIngestJobStream(jobId: string): Promise<Response> {
  return fetch(`${BASE_URL}/status/${jobId}/stream`, {
    headers: authHeaders({ Accept: 'text/event-stream' }),
    cache:   'no-store',
  });
}