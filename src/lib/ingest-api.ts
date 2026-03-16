/**
 * Server-side client for the Python Media Ingest API.
 * IP is resolved dynamically from Supabase — no static INGEST_API_URL needed.
 */

import { createHmac } from 'crypto';
import type { TorrentJob } from '@/types';

const HMAC_SECRET = process.env.INGEST_HMAC_SECRET ?? '';

if (!HMAC_SECRET) {
  console.warn('[ingest-api] INGEST_HMAC_SECRET is not set — all requests will be rejected by the container');
}

// ── HMAC-HS256 JWT ─────────────────────────────────────────────────────────

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

// ── Response helper ────────────────────────────────────────────────────────

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

// ── Request type ───────────────────────────────────────────────────────────

export interface IngestJobRequest {
  job_id:          string;   // ingest_jobs row id from Supabase
  hash:            string;
  name:            string;
  user_id:         string;
  blob_base_name:  string;
  storage_account: string;
  storage_key:     string;
  container_name:  string;
  trackers?:       string[];
}

// ── API calls (all accept a live IP) ──────────────────────────────────────

export async function startIngestJob(
  ip: string,
  req: IngestJobRequest,
): Promise<{ job_id: string; stage: string; queue_position?: number }> {
  const res = await fetch(`http://${ip}:8000/download`, {
    method:  'POST',
    headers: authHeaders(),
    body:    JSON.stringify(req),
    cache:   'no-store',
  });
  return expectJson(res);
}

export async function getIngestJobStatus(ip: string, jobId: string): Promise<TorrentJob> {
  const res = await fetch(`http://${ip}:8000/status/${jobId}`, {
    headers: authHeaders(),
    cache:   'no-store',
  });
  return expectJson(res);
}

export async function cancelIngestJob(ip: string, jobId: string): Promise<TorrentJob> {
  const res = await fetch(`http://${ip}:8000/jobs/${jobId}`, {
    method:  'DELETE',
    headers: authHeaders(),
  });
  return expectJson(res);
}

export function getIngestJobStream(ip: string, jobId: string): Promise<Response> {
  return fetch(`http://${ip}:8000/status/${jobId}/stream`, {
    headers: authHeaders({ Accept: 'text/event-stream' }),
    cache:   'no-store',
  });
}