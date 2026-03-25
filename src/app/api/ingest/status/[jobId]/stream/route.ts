/**
 * GET /api/ingest/status/[jobId]/stream
 *
 * SSE proxy — pipes the Python container's event stream to the browser.
 *
 * Now resolves container IP + HMAC secret per-job from ingest_jobs table.
 */

import { NextRequest }         from 'next/server';
import { createClient }        from '@supabase/supabase-js';
import { getIngestJobStream }  from '@/lib/ingest-api';
import { generateReadSasUrl, generateUploadSasUrl, CONTAINERS } from '@/lib/azure-blob';
import type { TorrentJob }     from '@/types';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const OS_API_KEY    = process.env.OPENSUBTITLES_API_KEY || '';
const OS_BASE       = 'https://api.opensubtitles.com/api/v1';
const SUBDL_API_KEY = process.env.SUBDL_API_KEY || '';
const SUBDL_BASE    = 'https://api.subdl.com/api/v1/subtitles';

const SUBDL_LANG_MAP: Record<string, string> = {
  en: 'EN', ar: 'AR', fr: 'FR', es: 'ES', de: 'DE',
  it: 'IT', ja: 'JA', ko: 'KO', zh: 'ZH', pt: 'PT',
  ru: 'RU', tr: 'TR',
};
const OS_LANG_MAP: Record<string, string> = {
  en: 'en', ar: 'ar', fr: 'fr', es: 'es', de: 'de',
  it: 'it', ja: 'ja', ko: 'ko', zh: 'zh-cn', pt: 'pt-pt',
  ru: 'ru', tr: 'tr',
};
const LANG_LABELS: Record<string, string> = {
  en: 'English', ar: 'Arabic', fr: 'French', es: 'Spanish', de: 'German',
  it: 'Italian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', pt: 'Portuguese',
  ru: 'Russian', tr: 'Turkish',
};

const TERMINAL = new Set(['Ready', 'Failed', 'Cancelled']);

/** Map Python container stage → ingest_jobs status */
function stageToStatus(stage: string): string | null {
  switch (stage) {
    case 'Fetching torrent info':     return 'running';
    case 'Downloading to servers':    return 'running';
    case 'Transcoding for playback':  return 'transcoding';
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

/**
 * Auto-download subtitles from subdl.com (primary) / OpenSubtitles (fallback)
 * and attach to the movie. Runs fire-and-forget after movie save.
 */
async function _autoDownloadSubtitles(
  movieId: string,
  imdbId: string,
  languages: string[],
  existingSubtitles: { label: string; lang: string; url: string }[],
  userId: string,
) {
  // Skip languages we already have subtitles for
  const existingLangs = new Set(existingSubtitles.map((s) => s.lang));
  const needed = languages.filter((l) => !existingLangs.has(l));
  if (needed.length === 0) return;

  console.log(`[auto-subs] Searching for ${needed.join(',')} subs for IMDB ${imdbId}`);

  // ── Helper: extract first .srt from a zip buffer ──
  async function extractSrtFromZip(zipBuffer: ArrayBuffer): Promise<string | null> {
    try {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(zipBuffer);
      // Find first .srt file in the zip
      for (const [name, file] of Object.entries(zip.files)) {
        if (name.toLowerCase().endsWith('.srt') && !file.dir) {
          return await file.async('string');
        }
      }
      // If no .srt, try .ass or .vtt
      for (const [name, file] of Object.entries(zip.files)) {
        if ((name.toLowerCase().endsWith('.vtt') || name.toLowerCase().endsWith('.ass')) && !file.dir) {
          return await file.async('string');
        }
      }
    } catch (err) {
      console.warn('[auto-subs] zip extraction failed:', (err as Error).message);
    }
    return null;
  }

  // ── Helper: convert SRT content to VTT ──
  function srtToVtt(srt: string): string {
    return 'WEBVTT\n\n' + srt
      .replace(/\r\n/g, '\n')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  }

  // ── Helper: upload VTT to Azure and return read URL ──
  async function uploadVtt(lang: string, vttContent: string): Promise<string | null> {
    const blobName = `${userId}/${Date.now()}-auto-${lang}.vtt`;
    const uploadSasUrl = generateUploadSasUrl(CONTAINERS.subtitles || 'subtitles', blobName, 1);
    const readSasUrl   = generateReadSasUrl(CONTAINERS.subtitles || 'subtitles', blobName, 8760);

    const uploadRes = await fetch(uploadSasUrl, {
      method: 'PUT',
      headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'text/vtt' },
      body: vttContent,
    });
    if (!uploadRes.ok) {
      console.warn(`[auto-subs] Failed to upload ${lang} subtitle to Azure: ${uploadRes.status}`);
      return null;
    }
    return readSasUrl;
  }

  const newSubtitles: { label: string; lang: string; url: string }[] = [...existingSubtitles];

  // ── Phase 1: Try subdl.com (primary) ──
  if (SUBDL_API_KEY) {
    const langCodes = needed.map((l) => SUBDL_LANG_MAP[l] || l.toUpperCase());
    const params = new URLSearchParams({
      api_key: SUBDL_API_KEY,
      imdb_id: imdbId,
      type: 'movie',
      languages: langCodes.join(','),
      subs_per_page: '10',
    });

    try {
      const res = await fetch(`${SUBDL_BASE}?${params}`, {
        headers: { 'User-Agent': 'CinemaForTwo v1.0' },
        signal: AbortSignal.timeout(12000),
      });

      if (res.ok) {
        const data = await res.json();
        const subs = data.subtitles || [];

        // Pick best subtitle per needed language
        const bestPerLang = new Map<string, string>(); // lang → subdl url
        for (const sub of subs) {
          // subdl returns sub.language as 2-letter code ("EN","AR") and sub.lang as full name ("English","Arabic")
          const subLangCode = (sub.language || '').toUpperCase();
          const langCode = needed.find((l) => (SUBDL_LANG_MAP[l] || l.toUpperCase()) === subLangCode);
          if (langCode && !bestPerLang.has(langCode) && sub.url) {
            bestPerLang.set(langCode, sub.url);
          }
        }

        // Download each zip, extract .srt, convert to .vtt, upload
        for (const [lang, subUrl] of bestPerLang) {
          try {
            const dlUrl = `https://dl.subdl.com${subUrl}`;
            const dlRes = await fetch(dlUrl, {
              headers: { 'User-Agent': 'CinemaForTwo v1.0' },
              signal: AbortSignal.timeout(20000),
            });
            if (!dlRes.ok) continue;

            const zipBuffer = await dlRes.arrayBuffer();
            const srtContent = await extractSrtFromZip(zipBuffer);
            if (!srtContent) {
              console.warn(`[auto-subs] No .srt found in zip for ${lang}`);
              continue;
            }

            const vttContent = srtToVtt(srtContent);
            const readUrl = await uploadVtt(lang, vttContent);
            if (!readUrl) continue;

            newSubtitles.push({ label: LANG_LABELS[lang] || lang, lang, url: readUrl });
            console.log(`[auto-subs] subdl: downloaded + uploaded ${lang} subtitle for movie ${movieId}`);
          } catch (err) {
            console.warn(`[auto-subs] subdl download failed for ${lang}:`, (err as Error).message);
          }
        }
      }
    } catch (err) {
      console.warn('[auto-subs] subdl search failed:', (err as Error).message);
    }
  }

  // ── Phase 2: Fallback to OpenSubtitles for any still-missing languages ──
  const stillNeeded = needed.filter((l) => !newSubtitles.some((s) => s.lang === l));
  if (stillNeeded.length > 0 && OS_API_KEY) {
    for (const lang of stillNeeded) {
      try {
        const osLang = OS_LANG_MAP[lang] || lang;
        const params = new URLSearchParams({
          languages: osLang,
          imdb_id: imdbId.replace(/^tt/, ''),
        });
        const searchRes = await fetch(`${OS_BASE}/subtitles?${params}`, {
          headers: { 'Api-Key': OS_API_KEY, 'User-Agent': 'CinemaForTwo v1.0', 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(10000),
        });
        if (!searchRes.ok) continue;
        const data = await searchRes.json();

        // Find best non-AI subtitle
        let fileId: number | null = null;
        for (const item of (data.data || [])) {
          const attrs = item.attributes;
          if (attrs.ai_translated || attrs.foreign_parts_only) continue;
          if (attrs.files?.[0]?.file_id) { fileId = attrs.files[0].file_id; break; }
        }
        if (!fileId) continue;

        // Download the .srt
        const dlRes = await fetch(`${OS_BASE}/download`, {
          method: 'POST',
          headers: { 'Api-Key': OS_API_KEY, 'User-Agent': 'CinemaForTwo v1.0', 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_id: fileId }),
          signal: AbortSignal.timeout(10000),
        });
        if (!dlRes.ok) continue;
        const dlData = await dlRes.json();
        if (!dlData.link) continue;

        const srtRes = await fetch(dlData.link, { signal: AbortSignal.timeout(15000) });
        if (!srtRes.ok) continue;
        const srtContent = await srtRes.text();

        const vttContent = srtToVtt(srtContent);
        const readUrl = await uploadVtt(lang, vttContent);
        if (!readUrl) continue;

        newSubtitles.push({ label: LANG_LABELS[lang] || lang, lang, url: readUrl });
        console.log(`[auto-subs] OS: downloaded + uploaded ${lang} subtitle for movie ${movieId}`);
      } catch (err) {
        console.warn(`[auto-subs] OS failed for ${lang}:`, (err as Error).message);
      }
    }
  }

  // ── Update movie with new subtitles ──
  if (newSubtitles.length > existingSubtitles.length) {
    await supabaseAdmin
      .from('movies')
      .update({ subtitles: newSubtitles })
      .eq('id', movieId);
    console.log(`[auto-subs] Updated movie ${movieId} with ${newSubtitles.length} subtitles`);
  } else {
    console.log(`[auto-subs] No new subtitles found for ${needed.join(',')}`);
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { jobId: string } },
) {
  const { jobId } = params;

  // Look up this job's container IP and HMAC secret
  const { data: jobRow } = await supabaseAdmin
    .from('ingest_jobs')
    .select('user_id, hash, movie_name, metadata, status, container_ip, hmac_secret')
    .eq('id', jobId)
    .single();

  if (!jobRow) {
    return new Response('data: {"error":"Job not found"}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  // If the job is already terminal, don't bother connecting upstream
  if (['completed', 'failed', 'cancelled'].includes(jobRow.status)) {
    return new Response(`data: {"error":"Job is already ${jobRow.status}"}\n\n`, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  const ip         = jobRow.container_ip;
  const hmacSecret = jobRow.hmac_secret;

  if (!ip || !hmacSecret) {
    syncJobStatus(jobId, 'Failed');
    return new Response('data: {"error":"Ingest container is not running for this job"}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  let upstream: Response;
  try {
    upstream = await getIngestJobStream(ip, hmacSecret, jobId);
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
                  // TMDB metadata
                  tmdb_id:           meta.tmdb_id ?? null,
                  release_date:      meta.release_date ?? null,
                  rating:            meta.rating ?? null,
                  genres:            meta.genres ?? null,
                  runtime:           meta.runtime ?? null,
                  tagline:           meta.tagline ?? null,
                  imdb_id:           meta.imdb_id ?? null,
                  original_language: meta.original_language ?? null,
                  source_type:       meta.source_type ?? null,
                });

                // ── Auto-download subtitles in the background ──────
                // Fire-and-forget: search OpenSubtitles by IMDB ID and
                // attach the best subtitles per requested language.
                if (meta.imdb_id && meta.subtitle_languages) {
                  _autoDownloadSubtitles(
                    movieId,
                    meta.imdb_id,
                    meta.subtitle_languages,
                    meta.subtitles || [],
                    jobRow.user_id,
                  ).catch((err) =>
                    console.error('[ingest/stream] auto-subtitle failed:', err.message),
                  );
                }

                // Enrich the event so the client can show "Watch now"
                const enriched = { ...job, movie_id: movieId };
                push(`data: ${JSON.stringify(enriched)}\n\n`);

                if (TERMINAL.has(job.stage)) { clearInterval(keepaliveInterval); close(); return; }
                continue;
              } catch (saveErr: any) {
                console.error('[ingest/stream] saveIngestMovie failed:', saveErr.message);
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