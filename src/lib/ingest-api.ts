/**
 * Server-side client for the Python Media Ingest API.
 * IP is resolved dynamically from Supabase — no static INGEST_API_URL needed.
 * HMAC secret is generated per-container and stored in Supabase container_state.
 */

import { createHmac } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import type { TorrentJob } from '@/types';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── HMAC secret cache (avoid hitting Supabase on every request) ─────────────
let _cachedSecret = '';
let _cachedAt = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

async function getHmacSecret(): Promise<string> {
  const now = Date.now();
  if (_cachedSecret && now - _cachedAt < CACHE_TTL_MS) return _cachedSecret;

  const { data } = await supabaseAdmin
    .from('container_state')
    .select('hmac_secret')
    .eq('id', 1)
    .single();

  _cachedSecret = data?.hmac_secret ?? '';
  _cachedAt = now;

  if (!_cachedSecret) {
    console.warn('[ingest-api] No HMAC secret in container_state — requests will be rejected');
  }
  return _cachedSecret;
}

// ── HMAC-HS256 JWT ─────────────────────────────────────────────────────────

function b64url(value: Buffer | string): string {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buf.toString('base64url');
}

async function makeIngestToken(): Promise<string> {
  const secret = await getHmacSecret();
  const now     = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: 'ingest', iat: now, exp: now + 300 }));
  const signing = `${header}.${payload}`;
  const sig     = createHmac('sha256', secret).update(signing).digest();
  return `${signing}.${b64url(sig)}`;
}

async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${await makeIngestToken()}`,
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
    headers: await authHeaders(),
    body:    JSON.stringify(req),
    cache:   'no-store',
  });
  return expectJson(res);
}

export async function getIngestJobStatus(ip: string, jobId: string): Promise<TorrentJob> {
  const res = await fetch(`http://${ip}:8000/status/${jobId}`, {
    headers: await authHeaders(),
    cache:   'no-store',
  });
  return expectJson(res);
}

export async function cancelIngestJob(ip: string, jobId: string): Promise<TorrentJob> {
  const res = await fetch(`http://${ip}:8000/jobs/${jobId}`, {
    method:  'DELETE',
    headers: await authHeaders(),
  });
  return expectJson(res);
}

export async function getIngestJobStream(ip: string, jobId: string): Promise<Response> {
  return fetch(`http://${ip}:8000/status/${jobId}/stream`, {
    headers: await authHeaders({ Accept: 'text/event-stream' }),
    cache:   'no-store',
  });
}