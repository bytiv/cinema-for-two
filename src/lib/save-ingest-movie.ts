/**
 * save-ingest-movie.ts
 *
 * Called server-side once a torrent job reaches stage "Ready".
 * Inserts the movie row into Supabase (matching the direct-upload schema)
 * and back-fills torrent_jobs.movie_id.
 *
 * blob_url from the Python container is the clean canonical URL with
 * extension already included:
 *   https://<account>.blob.core.windows.net/movies/{userId}/{ts}-{slug}.{ext}
 *
 * This matches the normal upload pattern exactly — no reconstruction needed.
 */

import { createServiceRoleClient } from '@/lib/supabase/server';
import { generateReadSasUrl, CONTAINERS } from '@/lib/azure-blob';
import type { TorrentJob } from '@/types';

export interface SaveIngestMovieParams {
  job:          TorrentJob;
  userId:       string;
  title:        string;
  description?: string;
  posterUrl?:   string;
  quality?:     '480p' | '720p' | '1080p' | '4K' | null;
  subtitles?:   { label: string; lang: string; url: string }[];
  // TMDB metadata
  tmdb_id?:      number | null;
  release_date?: string | null;
  rating?:       number | null;
  genres?:       string[] | null;
  runtime?:      number | null;
}

export interface SaveIngestMovieResult {
  movieId: string;
  blobUrl: string;
}

/**
 * Probes the blob for file size (HEAD) and duration (ffprobe via SAS URL).
 */
async function probeBlobMeta(
  blobName: string,
): Promise<{ fileSize: number; duration: number | null }> {
  const sasUrl = generateReadSasUrl(CONTAINERS.movies, blobName, 1);

  let fileSize = 0;
  try {
    const head = await fetch(sasUrl, { method: 'HEAD' });
    const cl   = parseInt(head.headers.get('content-length') ?? '0', 10);
    if (!isNaN(cl)) fileSize = cl;
  } catch {}

  let duration: number | null = null;
  try {
    const ffmpeg  = (await import('fluent-ffmpeg')).default;
    const ffprobe = await import('@ffprobe-installer/ffprobe');
    ffmpeg.setFfprobePath(ffprobe.path);
    duration = await new Promise<number | null>((resolve) => {
      ffmpeg.ffprobe(sasUrl, (err, metadata) => {
        if (err) { resolve(null); return; }
        const secs = metadata?.format?.duration;
        resolve(typeof secs === 'number' && isFinite(secs) && secs > 0 ? Math.round(secs) : null);
      });
    });
  } catch {
    duration = null;
  }

  return { fileSize, duration };
}

export async function saveIngestMovie(
  params: SaveIngestMovieParams,
): Promise<SaveIngestMovieResult> {
  const { job, userId, title, description, posterUrl, quality, subtitles,
          tmdb_id, release_date, rating, genres, runtime } = params;

  if (!job.blob_url) {
    throw new Error('Job is Ready but has no blob_url — cannot save movie');
  }

  const supabase = createServiceRoleClient();

  // ── Derive blob_name from blob_url ────────────────────────────────────────
  //
  // blob_url is the clean canonical URL with extension:
  //   https://<account>.blob.core.windows.net/movies/{userId}/{ts}-{slug}.{ext}
  //
  // Extract everything after "/movies/" as the blob_name.
  const afterContainer = job.blob_url.split(`/${CONTAINERS.movies}/`)[1];
  if (!afterContainer) {
    throw new Error(`Unexpected blob_url format — cannot extract blob_name: ${job.blob_url}`);
  }

  // blob_name already includes the extension (e.g. "userId/ts-movietest.mkv")
  const blobName  = afterContainer;
  const ext       = blobName.split('.').pop()?.toLowerCase() ?? 'mp4';
  const format    = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'm4v', 'ts'].includes(ext) ? ext : 'mp4';

  // ── Probe blob ────────────────────────────────────────────────────────────
  const { fileSize, duration } = await probeBlobMeta(blobName);

  // ── Insert movie row ──────────────────────────────────────────────────────
  const { data: movie, error: movieError } = await supabase
    .from('movies')
    .insert({
      title:         title.trim(),
      description:   description?.trim() ?? null,
      blob_url:      job.blob_url,
      blob_name:     blobName,
      poster_url:    posterUrl ?? null,
      file_size:     fileSize,
      format,
      quality:       quality ?? null,
      duration,
      subtitles:     subtitles ?? [],
      ingest_method: 'torrent',
      info_hash:     job.info_hash,
      ingest_job_id: job.job_id,
      uploaded_by:   userId,
      // TMDB metadata
      tmdb_id:       tmdb_id ?? null,
      release_date:  release_date ?? null,
      rating:        rating ?? null,
      genres:        genres ?? null,
      runtime:       runtime ?? null,
    })
    .select('id, blob_url')
    .single();

  if (movieError || !movie) {
    throw new Error(`Failed to insert movie: ${movieError?.message}`);
  }

  // ── Back-fill torrent_jobs.movie_id ───────────────────────────────────────
  // Use direct upsert instead of RPC to avoid PostgREST schema-cache issues
  // with partial named parameters on functions with many defaults.
  const { error: jobError } = await supabase
    .from('torrent_jobs')
    .upsert(
      {
        job_id:       job.job_id,
        requested_by: userId,
        info_hash:    job.info_hash ?? '',
        stage:        'Ready',
        blob_url:     job.blob_url,
        movie_id:     movie.id,
        completed_at: new Date().toISOString(),
      },
      { onConflict: 'job_id' },
    );

  if (jobError) {
    console.error(`[save-ingest-movie] back-fill movie_id: ${jobError.message}`);
  }

  return { movieId: movie.id, blobUrl: movie.blob_url };
}