/**
 * GET /api/ingest/[jobId]/stream
 *
 * Server-Sent Events passthrough.
 *
 * Pipes the Python API's SSE stream to the browser, intercepting
 * each event to:
 *   1. Upsert the torrent_jobs audit row in Supabase on every tick
 *   2. Auto-save the movie row when stage reaches "Ready"
 *
 * Query params:
 *   title        string   — movie title (required for auto-save)
 *   description? string
 *   quality?     string
 *   posterUrl?   string
 *
 * The API key to the Python service never leaves the server.
 */

import { NextResponse }               from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { getIngestJobStream }         from '@/lib/ingest-api';
import type { TorrentJob }            from '@/types';
// saveIngestMovie is imported dynamically below to keep fluent-ffmpeg /
// @ffprobe-installer out of the webpack bundle (Next.js 14 limitation).

interface Params { params: { jobId: string } }

const TERMINAL = new Set(['Ready', 'Failed', 'Cancelled']);

export async function GET(req: Request, { params }: Params) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { jobId } = params;
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }

  // ── Verify ownership ────────────────────────────────────────────────────────
  const { data: auditRow } = await supabase
    .from('torrent_jobs')
    .select('requested_by, info_hash')
    .eq('job_id', jobId)
    .single();

  if (auditRow && auditRow.requested_by !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── Movie metadata from query params ────────────────────────────────────────
  const url         = new URL(req.url);
  const title       = url.searchParams.get('title')       ?? '';
  const description = url.searchParams.get('description') ?? undefined;
  const posterUrl   = url.searchParams.get('posterUrl')   ?? undefined;
  const quality     = (url.searchParams.get('quality') ?? undefined) as
    '480p' | '720p' | '1080p' | '4K' | undefined;


  // ── Connect to Python SSE stream ─────────────────────────────────────────────
  let upstreamRes: Response;
  try {
    upstreamRes = await getIngestJobStream(jobId);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Could not connect to ingest service: ${err.message}` },
      { status: 502 },
    );
  }

  if (!upstreamRes.ok || !upstreamRes.body) {
    return NextResponse.json(
      { error: `Ingest service returned ${upstreamRes.status}` },
      { status: 502 },
    );
  }

  const service      = createServiceRoleClient();
  const infoHash     = auditRow?.info_hash ?? '';
  let   movieSaved   = false;

  // ── Transform stream ─────────────────────────────────────────────────────────
  // We read the upstream SSE line by line, intercept the JSON payload,
  // write to Supabase, optionally save the movie, then forward the
  // (possibly enriched) event to the browser.
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const transformed = new ReadableStream({
    async start(controller) {
      const reader = upstreamRes.body!.getReader();
      let   buffer = '';

      let   closed = false;
      const push  = (chunk: string) => { if (!closed) controller.enqueue(encoder.encode(chunk)); };
      const close = () => { if (!closed) { closed = true; try { controller.close(); } catch {} } };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // Keep the last (possibly incomplete) line in the buffer
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            // SSE data lines look like:  data: {...}
            if (!line.startsWith('data:')) {
              push(line + '\n');
              continue;
            }

            const raw = line.slice(5).trim();
            // The Python API uses 'error' but our TorrentJob type uses 'error_code'
            // Parse as a loose type first, then remap
            let job: (TorrentJob & { error?: string }) | null = null;

            try { job = JSON.parse(raw); } catch {}

            if (!job) {
              push(line + '\n');
              continue;
            }

            // ── 1. Upsert audit row ─────────────────────────────────────────
            service.rpc('upsert_torrent_job', {
              p_job_id:         jobId,
              p_requested_by:   user.id,
              p_info_hash:      infoHash || job.info_hash || '',
              p_file_name:      job.file_name      ?? undefined,
              p_stage:          job.stage,
              p_error_code:     job.error_code ?? job.error ?? undefined,
              p_notification:   job.notification   ?? undefined,
              p_warning:        job.warning        ?? undefined,
              p_download_pct:   job.download_percent,
              p_download_speed: job.download_speed  ?? undefined,
              p_download_eta:   job.download_eta    ?? undefined,
              p_seeder_count:   job.seeder_count    ?? undefined,
              p_upload_pct:     job.upload_percent,
              p_blob_url:       job.blob_url        ?? undefined,
            }).then(({ error }) => {
              if (error) console.error('[ingest/stream] upsert_torrent_job:', error.message);
            });

            // ── 2. Auto-save movie on Ready ─────────────────────────────────
            if (job.stage === 'Ready' && job.blob_url && !movieSaved && title) {
              movieSaved = true; // prevent double-save on repeated Ready events

              try {
                const { saveIngestMovie } = await import('@/lib/save-ingest-movie');
                const { movieId } = await saveIngestMovie({
                  job,
                  userId:      user.id,
                  title,
                  description,
                  posterUrl,
                  quality,
                  // subtitles uploaded separately after movie is saved
                });

                // Enrich the forwarded event with the new movie_id
                // so the client can redirect to /movie/<id> immediately
                const enriched: TorrentJob = { ...job, movie_id: movieId };
                push(`data: ${JSON.stringify(enriched)}\n\n`);

              } catch (saveErr: any) {
                console.error('[ingest/stream] saveIngestMovie:', saveErr.message);
                // Forward original event even if save failed — client can retry
                push(`data: ${raw}\n\n`);
              }

              if (TERMINAL.has(job.stage)) { close(); return; }
              continue;
            }

            // ── 3. Forward event as-is ──────────────────────────────────────
            push(`data: ${raw}\n\n`);

            if (TERMINAL.has(job.stage)) { close(); return; }
          }
        }
      } catch (err) {
        console.error('[ingest/stream] stream error:', err);
      } finally {
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