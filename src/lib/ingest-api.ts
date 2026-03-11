/**
 * Server-side client for the Python Media Ingest API.
 *
 * Never import this from a client component — it reads INGEST_API_KEY
 * which is a server-only env var (no NEXT_PUBLIC_ prefix).
 *
 * All fetch calls throw on non-2xx so callers can catch and surface errors.
 */

import type { TorrentJob, TorrentJobRequest } from '@/types';

const BASE_URL = process.env.INGEST_API_URL?.replace(/\/$/, '');
const API_KEY  = process.env.INGEST_API_KEY ?? '';

if (!BASE_URL) {
  // Warn at boot time so it's obvious in logs — don't throw so build succeeds
  console.warn('[ingest-api] INGEST_API_URL is not set — torrent ingest will fail at runtime');
}

// ── Shared headers ────────────────────────────────────────────────────────────

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(API_KEY ? { 'X-Api-Key': API_KEY } : {}),
    ...extra,
  };
}

// ── Response helpers ──────────────────────────────────────────────────────────

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

// ── API calls ─────────────────────────────────────────────────────────────────

/**
 * Start a new torrent ingest job.
 * Returns { job_id, stage } immediately — job runs in the background.
 */
export async function startIngestJob(
  req: TorrentJobRequest,
): Promise<{ job_id: string; stage: string }> {
  const res = await fetch(`${BASE_URL}/download`, {
    method:  'POST',
    headers: headers(),
    body:    JSON.stringify(req),
    // next.js server fetch — no caching needed here
    cache:   'no-store',
  });
  return expectJson(res);
}

/**
 * Fetch a single status snapshot for a job.
 */
export async function getIngestJobStatus(jobId: string): Promise<TorrentJob> {
  const res = await fetch(`${BASE_URL}/status/${jobId}`, {
    headers: headers(),
    cache:   'no-store',
  });
  return expectJson(res);
}

/**
 * Cancel a running job.
 * Returns the final job state.
 */
export async function cancelIngestJob(jobId: string): Promise<TorrentJob> {
  const res = await fetch(`${BASE_URL}/jobs/${jobId}`, {
    method:  'DELETE',
    headers: headers(),
    cache:   'no-store',
  });
  return expectJson(res);
}

/**
 * Returns the raw Response for the SSE stream endpoint.
 * Caller is responsible for piping the body to the client.
 * We deliberately do NOT await/buffer — we stream it through.
 */
export function getIngestJobStream(jobId: string): Promise<Response> {
  return fetch(`${BASE_URL}/status/${jobId}/stream`, {
    headers: {
      ...(API_KEY ? { 'X-Api-Key': API_KEY } : {}),
      Accept: 'text/event-stream',
    },
    cache: 'no-store',
  });
}