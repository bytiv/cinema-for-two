/**
 * save-ingest-movie.ts
 *
 * Called server-side once a torrent job reaches stage "Ready".
 * Inserts the movie row into Supabase and back-fills torrent_jobs.movie_id
 * via the upsert_torrent_job function.
 *
 * Uses the service-role client so RLS doesn't block the write —
 * the auth check is already done by the calling API route.
 */

import { createServiceRoleClient } from '@/lib/supabase/server';
import type { TorrentJob } from '@/types';

export interface SaveIngestMovieParams {
  job:         TorrentJob;
  userId:      string;
  title:       string;
  description?: string;
  posterUrl?:  string;
  quality?:    '480p' | '720p' | '1080p' | '4K' | null;
  duration?:   number | null;
}

export interface SaveIngestMovieResult {
  movieId: string;
  blobUrl: string;
}

export async function saveIngestMovie(
  params: SaveIngestMovieParams,
): Promise<SaveIngestMovieResult> {
  const { job, userId, title, description, posterUrl, quality, duration } = params;

  if (!job.blob_url) {
    throw new Error('Job is Ready but has no blob_url — cannot save movie');
  }

  const supabase = createServiceRoleClient();

  // ── 1. Derive blob_name from blob_url ─────────────────────────────────────
  // blob_url is  https://<account>.blob.core.windows.net/<container>/<blob_name>
  const blobName = job.blob_url.split('/').slice(-1)[0];

  // ── 2. Derive format from file extension ──────────────────────────────────
  const ext    = blobName.split('.').pop()?.toLowerCase() ?? 'mp4';
  const format = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'm4v', 'ts'].includes(ext) ? ext : 'mp4';

  // ── 3. Insert movie row ───────────────────────────────────────────────────
  const { data: movie, error: movieError } = await supabase
    .from('movies')
    .insert({
      title:         title.trim(),
      description:   description?.trim() ?? null,
      blob_url:      job.blob_url,
      blob_name:     blobName,
      poster_url:    posterUrl ?? null,
      file_size:     0,          // unknown at ingest time — can be patched later
      format,
      quality:       quality ?? null,
      duration:      duration   ?? null,
      subtitles:     [],
      ingest_method: 'torrent',
      info_hash:     job.info_hash,
      ingest_job_id: job.job_id,
      uploaded_by:   userId,
    })
    .select('id, blob_url')
    .single();

  if (movieError || !movie) {
    throw new Error(`Failed to insert movie: ${movieError?.message}`);
  }

  // ── 4. Back-fill torrent_jobs.movie_id via upsert function ────────────────
  // We use the upsert function rather than a raw UPDATE so the COALESCE guards
  // in the function don't accidentally overwrite other fields.
  const { error: jobError } = await supabase.rpc('upsert_torrent_job', {
    p_job_id:       job.job_id,
    p_requested_by: userId,
    p_info_hash:    job.info_hash,
    p_stage:        'Ready',
    p_blob_url:     job.blob_url,
    p_movie_id:     movie.id,
  });

  if (jobError) {
    // Non-fatal — movie is saved, audit row is just missing the back-reference
    console.error(`[save-ingest-movie] Failed to back-fill movie_id on torrent_job: ${jobError.message}`);
  }

  return { movieId: movie.id, blobUrl: movie.blob_url };
}