/**
 * Server-side client for the Python Media Ingest API.
 * IP and HMAC secret are resolved per-job from ingest_jobs table.
 */

import { createHmac } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import type { TorrentJob } from '@/types';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── HMAC-HS256 JWT ─────────────────────────────────────────────────────────

function b64url(value: Buffer | string): string {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buf.toString('base64url');
}

function makeIngestTokenWithSecret(secret: string): string {
  const now     = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: 'ingest', iat: now, exp: now + 300 }));
  const signing = `${header}.${payload}`;
  const sig     = createHmac('sha256', secret).update(signing).digest();
  return `${signing}.${b64url(sig)}`;
}

function authHeadersWithSecret(secret: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${makeIngestTokenWithSecret(secret)}`,
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

// ── Helper: get job's container info from Supabase ────────────────────────

export async function getJobContainerInfo(jobId: string): Promise<{
  ip: string;
  hmacSecret: string;
} | null> {
  const { data } = await supabaseAdmin
    .from('ingest_jobs')
    .select('container_ip, hmac_secret')
    .eq('id', jobId)
    .single();

  if (!data?.container_ip || !data?.hmac_secret) return null;
  return { ip: data.container_ip, hmacSecret: data.hmac_secret };
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

// ── API calls (all accept ip + hmacSecret directly) ──────────────────────

export async function startIngestJob(
  ip: string,
  hmacSecret: string,
  req: IngestJobRequest,
): Promise<{ job_id: string; stage: string }> {
  const res = await fetch(`http://${ip}:8000/download`, {
    method:  'POST',
    headers: authHeadersWithSecret(hmacSecret),
    body:    JSON.stringify(req),
    cache:   'no-store',
  });
  return expectJson(res);
}

export async function getIngestJobStatus(ip: string, hmacSecret: string, jobId: string): Promise<TorrentJob> {
  const res = await fetch(`http://${ip}:8000/status/${jobId}`, {
    headers: authHeadersWithSecret(hmacSecret),
    cache:   'no-store',
  });
  return expectJson(res);
}

export async function cancelIngestJob(ip: string, hmacSecret: string, jobId: string): Promise<TorrentJob> {
  const res = await fetch(`http://${ip}:8000/jobs/${jobId}`, {
    method:  'DELETE',
    headers: authHeadersWithSecret(hmacSecret),
  });
  return expectJson(res);
}

export async function getIngestJobStream(ip: string, hmacSecret: string, jobId: string): Promise<Response> {
  return fetch(`http://${ip}:8000/status/${jobId}/stream`, {
    headers: authHeadersWithSecret(hmacSecret, { Accept: 'text/event-stream' }),
    cache:   'no-store',
  });
}