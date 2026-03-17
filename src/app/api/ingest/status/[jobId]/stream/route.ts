/**
 * GET /api/ingest/status/[jobId]/stream
 *
 * SSE proxy — pipes the Python container's event stream to the browser.
 *
 * Intercepts each event to:
 *   1. Detect when the job reaches "Ready"
 *   2. Auto-save the movie row via saveIngestMovie
 *   3. Enrich the forwarded event with movie_id so the client can
 *      show "Watch now" immediately
 */

import { NextRequest }         from 'next/server';
import { createClient }        from '@supabase/supabase-js';
import { getIngestJobStream }  from '@/lib/ingest-api';
import type { TorrentJob }     from '@/types';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const TERMINAL = new Set(['Ready', 'Failed', 'Cancelled']);

/** Map Python container stage → ingest_jobs status */
function stageToStatus(stage: string): string | null {
  switch (stage) {
    case 'Queued':                    return 'queued';
    case 'Fetching torrent info':     return 'running';
    case 'Downloading to servers':    return 'running';
    case 'Uploading to storage':      return 'uploading';
    case 'Ready':                     return 'completed';
    case 'Failed':                    return 'failed';
    case 'Cancelled':                 return 'cancelled';
    default:                          return null;
  }
}

/** Fire-and-forget update to keep ingest_jobs in sync */
function syncJobStatus(jobId: string, stage: string) {
  const status = stageToStatus(stage);
  if (!status) return;

  const update: Record<string, any> = {
    status,
    last_heartbeat_at: new Date().toISOString(),
  };
  if (TERMINAL.has(stage)) {
    update.finished_at = new Date().toISOString();
  }

  supabaseAdmin
    .from('ingest_jobs')
    .update(update)
    .eq('id', jobId)
    .then(({ error }) => {
      if (error) console.error('[ingest/stream] syncJobStatus error:', error.message);
    });
}

async function getLiveIP(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('container_state')
    .select('container_ip')
    .eq('id', 1)
    .single();
  return data?.container_ip ?? null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { jobId: string } },
) {
  const { jobId } = params;

  const ip = await getLiveIP();
  if (!ip) {
    // No container IP — mark the job as failed if it's still active
    syncJobStatus(jobId, 'Failed');
    return new Response('data: {"error":"Ingest service is not running"}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  // Fetch the job row to get user_id, movie_name, and metadata
  const { data: jobRow } = await supabaseAdmin
    .from('ingest_jobs')
    .select('user_id, hash, movie_name, metadata, status')
    .eq('id', jobId)
    .single();

  // If the job is already completed/failed/cancelled, don't bother connecting upstream
  if (jobRow && ['completed', 'failed', 'cancelled'].includes(jobRow.status)) {
    return new Response(`data: {"error":"Job is already ${jobRow.status}"}\n\n`, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  let upstream: Response;
  try {
    upstream = await getIngestJobStream(ip, jobId);
  } catch (err: any) {
    syncJobStatus(jobId, 'Failed');
    return new Response(`data: {"error":"${err.message}"}\n\n`, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  if (!upstream.ok || !upstream.body) {
    syncJobStatus(jobId, 'Failed');
    return new Response(`data: {"error":"Ingest service returned ${upstream.status}"}\n\n`, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  const encoder    = new TextEncoder();
  const decoder    = new TextDecoder();
  let   movieSaved = false;

  const transformed = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let   buffer = '';

      const push  = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      const close = () => { try { controller.close(); } catch {} };

      // Send a connection confirmation so the client knows the stream is alive
      push(': connected\n\n');

      // Keepalive: if no data from upstream for 60s, close with an error
      let lastActivity = Date.now();
      const keepaliveInterval = setInterval(() => {
        const elapsed = Date.now() - lastActivity;
        if (elapsed > 60_000) {
          clearInterval(keepaliveInterval);
          push(`data: {"error":"No updates from ingest service for 60s — connection may be stale"}\n\n`);
          syncJobStatus(jobId, 'Failed');
          close();
          return;
        }
        // Send SSE comment as keepalive to prevent proxy/browser timeout
        push(': keepalive\n\n');
      }, 15_000);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          lastActivity = Date.now();

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data:')) {
              push(line + '\n');
              continue;
            }

            const raw = line.slice(5).trim();
            let job: TorrentJob | null = null;
            try { job = JSON.parse(raw); } catch {}

            if (!job) {
              push(line + '\n');
              continue;
            }

            // ── Sync ingest_jobs status on every event ──────────
            syncJobStatus(jobId, job.stage);

            // ── Auto-save movie on Ready ───────────────────────────
            if (
              job.stage === 'Ready' &&
              job.blob_url &&
              !movieSaved &&
              jobRow
            ) {
              movieSaved = true;

              try {
                const { saveIngestMovie } = await import('@/lib/save-ingest-movie');
                const meta = jobRow.metadata ?? {};

                const { movieId } = await saveIngestMovie({
                  job,
                  userId:      jobRow.user_id,
                  title:       jobRow.movie_name,
                  description: meta.description,
                  posterUrl:   meta.posterUrl,
                  quality:     meta.quality,
                  subtitles:   meta.subtitles,
                });

                // Enrich the event so the client can show "Watch now"
                const enriched = { ...job, movie_id: movieId };
                push(`data: ${JSON.stringify(enriched)}\n\n`);

                if (TERMINAL.has(job.stage)) { clearInterval(keepaliveInterval); close(); return; }
                continue;
              } catch (saveErr: any) {
                console.error('[ingest/stream] saveIngestMovie failed:', saveErr.message);
                // Forward original event even if save failed
                push(`data: ${raw}\n\n`);
                if (TERMINAL.has(job.stage)) { clearInterval(keepaliveInterval); close(); return; }
                continue;
              }
            }

            // ── Forward as-is ──────────────────────────────────────
            push(`data: ${raw}\n\n`);
            if (TERMINAL.has(job.stage)) { clearInterval(keepaliveInterval); close(); return; }
          }
        }
      } catch (err) {
        console.error('[ingest/stream] stream error:', err);
      } finally {
        clearInterval(keepaliveInterval);
        close();
      }
    },
  });

  return new Response(transformed, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache',
      'X-Accel-Buffering': 'no',
      'Connection':        'keep-alive',
    },
  });
}