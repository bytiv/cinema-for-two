/**
 * POST /api/ingest/finalize
 *
 * Called by the client after a torrent job reaches "Ready".
 *
 * For SINGLE-QUALITY (no group): Creates the movie row immediately (legacy behavior).
 * For MULTI-QUALITY (grouped):   Creates the movie as soon as the FIRST quality
 *                                finishes (so it's immediately watchable). When the
 *                                second quality completes, updates the existing movie
 *                                row to add the new variant.
 *
 * Body: {
 *   job_id:           string
 *   blob_url:         string
 *   title:            string
 *   description?:     string
 *   quality?:         string
 *   poster_url?:      string
 *   subtitles?:       { label: string; lang: string; url: string }[]
 *   ingest_group_id?: string   // if part of a multi-quality group
 *   assigned_quality?: string  // which quality this job represents
 *   generate_hls?:    boolean  // whether HLS was enabled
 *   hls_playlist?:    string   // blob name of this quality's .m3u8 (from Python worker)
 *   ... (TMDB metadata fields)
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateReadSasUrl, CONTAINERS } from '@/lib/azure-blob';
import type { QualityVariant } from '@/types';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const QUALITY_RANK: Record<string, number> = { '480p': 0, '720p': 1, '1080p': 2, '4K': 3 };

/** Build a QualityVariant from a completed job's metadata */
async function buildVariant(
  meta: Record<string, any>,
  assignedQuality: string,
  containerName: string,
): Promise<{ variant: QualityVariant; blobName: string; blobUrl: string; fileSize: number } | null> {
  const gjBlobUrl = meta.blob_url;
  if (!gjBlobUrl) return null;

  const afterContainer = gjBlobUrl.split(`/${containerName}/`)[1];
  if (!afterContainer) return null;

  const gjBlobName = afterContainer;
  const gjQuality  = meta.assigned_quality || assignedQuality;

  let fileSize = 0;
  try {
    const sasUrl = generateReadSasUrl(CONTAINERS.movies, gjBlobName, 1);
    const head = await fetch(sasUrl, { method: 'HEAD' });
    const cl = parseInt(head.headers.get('content-length') ?? '0', 10);
    if (!isNaN(cl)) fileSize = cl;
  } catch {}

  return {
    variant: {
      quality: gjQuality,
      blob_name: gjBlobName,
      blob_url: gjBlobUrl,
      file_size: fileSize,
      hls_playlist: meta.hls_playlist || null,
    },
    blobName: gjBlobName,
    blobUrl: gjBlobUrl,
    fileSize,
  };
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      job_id, blob_url, title, description, quality, poster_url, subtitles,
      tmdb_id, release_date, rating, genres, runtime,
      tagline, imdb_id, original_language, source_type, release_name,
      series_name, season_number, episode_number, episode_title,
      // Multi-quality fields
      ingest_group_id, assigned_quality, generate_hls, hls_playlist,
    } = body;

    if (!job_id || !blob_url) {
      return NextResponse.json({ error: 'job_id and blob_url are required' }, { status: 400 });
    }

    // Verify the job belongs to this user
    const { data: job } = await supabaseAdmin
      .from('ingest_jobs')
      .select('user_id, hash, status, ingest_group_id, assigned_quality, generate_hls, movie_name, metadata')
      .eq('id', job_id)
      .single();

    if (!job || job.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Use job's movie_name as fallback title
    const effectiveTitle = title || job.movie_name || 'Untitled';

    const groupId = ingest_group_id || job.ingest_group_id;

    // ── Multi-quality grouped path ────────────────────────────────────────
    if (groupId) {
      // Update this job's metadata with its blob_url and quality info
      const existingMeta = (job as any).metadata || {};
      const updatedMeta: Record<string, any> = {
        ...existingMeta,
        blob_url,
        assigned_quality: assigned_quality || job.assigned_quality || existingMeta.assigned_quality,
        hls_playlist: hls_playlist || existingMeta.hls_playlist || null,
      };
      if (title) updatedMeta.title = title;
      if (description !== undefined) updatedMeta.description = description;
      if (poster_url) updatedMeta.poster_url = poster_url;
      if (subtitles) updatedMeta.subtitles = subtitles;
      if (tmdb_id !== undefined) updatedMeta.tmdb_id = tmdb_id;
      if (release_date) updatedMeta.release_date = release_date;
      if (rating !== undefined) updatedMeta.rating = rating;
      if (genres) updatedMeta.genres = genres;
      if (runtime !== undefined) updatedMeta.runtime = runtime;
      if (tagline) updatedMeta.tagline = tagline;
      if (imdb_id) updatedMeta.imdb_id = imdb_id;
      if (original_language) updatedMeta.original_language = original_language;
      if (source_type) updatedMeta.source_type = source_type;
      if (release_name) updatedMeta.release_name = release_name;
      if (series_name) updatedMeta.series_name = series_name;
      if (season_number !== undefined) updatedMeta.season_number = season_number;
      if (episode_number !== undefined) updatedMeta.episode_number = episode_number;
      if (episode_title) updatedMeta.episode_title = episode_title;

      await supabaseAdmin
        .from('ingest_jobs')
        .update({
          status: 'completed',
          finished_at: new Date().toISOString(),
          metadata: updatedMeta,
        })
        .eq('id', job_id);

      // Fetch all jobs in this group
      const { data: groupJobs } = await supabaseAdmin
        .from('ingest_jobs')
        .select('id, status, metadata, assigned_quality, hash, movie_name')
        .eq('ingest_group_id', groupId);

      if (!groupJobs) {
        return NextResponse.json({ error: 'Failed to fetch group jobs' }, { status: 500 });
      }

      const completedJobs = groupJobs.filter(j => j.status === 'completed');
      const containerName = process.env.AZURE_STORAGE_CONTAINER_MOVIES ?? 'movies';

      // ── Check if a movie already exists for this group ────────────────
      const { data: existingMovie } = await supabaseAdmin
        .from('movies')
        .select('id, quality_variants, file_size, blob_url, blob_name')
        .eq('ingest_group_id', groupId)
        .maybeSingle();

      if (existingMovie) {
        // Movie already exists — add this job's variant if not already present
        const existingVariants: QualityVariant[] = existingMovie.quality_variants || [];
        const thisQuality = updatedMeta.assigned_quality || assigned_quality || job.assigned_quality;

        // Check if this quality is already in the variants
        const alreadyHas = existingVariants.some(v => v.quality === thisQuality);
        if (alreadyHas) {
          return NextResponse.json({ movie_id: existingMovie.id });
        }

        // Build the new variant from this job
        const result = await buildVariant(updatedMeta, thisQuality, containerName);
        if (result) {
          const newVariants = [...existingVariants, result.variant];
          const newFileSize = (existingMovie.file_size || 0) + result.fileSize;

          // Check if the new variant is higher quality — if so, update primary blob
          const newRank = QUALITY_RANK[thisQuality] ?? 0;
          const currentPrimaryQuality = existingVariants[0]?.quality;
          const currentRank = QUALITY_RANK[currentPrimaryQuality] ?? 0;

          const updatePayload: Record<string, any> = {
            quality_variants: newVariants,
            file_size: newFileSize,
          };

          // If the new variant is higher quality, make it the primary
          if (newRank > currentRank) {
            updatePayload.blob_url = result.blobUrl;
            updatePayload.blob_name = result.blobName;
          }

          await supabaseAdmin
            .from('movies')
            .update(updatePayload)
            .eq('id', existingMovie.id);

          console.log(`[finalize] Added ${thisQuality} variant to existing movie ${existingMovie.id}`);
        }

        return NextResponse.json({ movie_id: existingMovie.id });
      }

      // ── No movie yet — create one with whatever variants are completed ──
      const qualityVariants: QualityVariant[] = [];
      let primaryBlobUrl = '';
      let primaryBlobName = '';
      let primaryInfoHash = '';
      let totalFileSize = 0;

      for (const gj of completedJobs) {
        const meta = (gj as any).metadata || {};
        const gjQuality = meta.assigned_quality || gj.assigned_quality || quality;
        const result = await buildVariant(meta, gjQuality, containerName);
        if (!result) continue;

        qualityVariants.push(result.variant);
        totalFileSize += result.fileSize;

        // Use highest quality as the primary/fallback
        if (!primaryBlobUrl || gjQuality === '1080p' || gjQuality === '4K') {
          primaryBlobUrl  = result.blobUrl;
          primaryBlobName = result.blobName;
          primaryInfoHash = gj.hash;
        }
      }

      if (!primaryBlobUrl) {
        return NextResponse.json({ error: 'No completed variants found' }, { status: 500 });
      }

      const ext    = primaryBlobName.split('.').pop()?.toLowerCase() ?? 'mp4';
      const format = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'm4v', 'ts'].includes(ext) ? ext : 'mp4';

      const firstMeta = (completedJobs[0] as any).metadata || {};
      const firstJobRow = completedJobs[0] as any;

      const { data: movie, error: movieError } = await supabaseAdmin
        .from('movies')
        .insert({
          title:              (firstMeta.title || effectiveTitle || firstJobRow.movie_name || 'Untitled').trim(),
          description:        (firstMeta.description || description)?.trim() || null,
          blob_url:           primaryBlobUrl,
          blob_name:          primaryBlobName,
          poster_url:         firstMeta.posterUrl || firstMeta.poster_url || poster_url || null,
          file_size:          totalFileSize,
          format,
          quality:            null,
          duration:           null,
          subtitles:          firstMeta.subtitles || subtitles || [],
          ingest_method:      'torrent',
          info_hash:          primaryInfoHash,
          ingest_job_id:      job_id,
          ingest_group_id:    groupId,
          uploaded_by:        user.id,
          quality_variants:   qualityVariants,
          hls_master_playlist: null,
          // TMDB metadata
          tmdb_id:            firstMeta.tmdb_id ?? tmdb_id ?? null,
          release_date:       firstMeta.release_date ?? release_date ?? null,
          rating:             firstMeta.rating ?? rating ?? null,
          genres:             firstMeta.genres ?? genres ?? null,
          runtime:            firstMeta.runtime ?? runtime ?? null,
          tagline:            firstMeta.tagline ?? tagline ?? null,
          imdb_id:            firstMeta.imdb_id ?? imdb_id ?? null,
          original_language:  firstMeta.original_language ?? original_language ?? null,
          source_type:        firstMeta.source_type ?? source_type ?? null,
          release_name:       firstMeta.release_name ?? release_name ?? null,
          series_name:        firstMeta.series_name ?? series_name ?? null,
          season_number:      firstMeta.season_number ?? season_number ?? null,
          episode_number:     firstMeta.episode_number ?? episode_number ?? null,
          episode_title:      firstMeta.episode_title ?? episode_title ?? null,
        })
        .select('id')
        .single();

      if (movieError || !movie) {
        // Race condition check
        const { data: raceWinner } = await supabaseAdmin
          .from('movies')
          .select('id')
          .eq('ingest_group_id', groupId)
          .maybeSingle();

        if (raceWinner) {
          return NextResponse.json({ movie_id: raceWinner.id });
        }

        return NextResponse.json(
          { error: `Failed to create movie: ${movieError?.message}` },
          { status: 500 },
        );
      }

      const remainingCount = groupJobs.length - completedJobs.length;
      console.log(`[finalize] Created movie ${movie.id} with ${completedJobs.length} variant(s), ${remainingCount} still pending`);

      return NextResponse.json({ movie_id: movie.id });
    }

    // ── Single-quality path (legacy behavior) ─────────────────────────────

    const containerName = process.env.AZURE_STORAGE_CONTAINER_MOVIES ?? 'movies';
    const afterContainer = blob_url.split(`/${containerName}/`)[1];
    if (!afterContainer) {
      return NextResponse.json({ error: 'Invalid blob_url format' }, { status: 400 });
    }

    const blobName = afterContainer;
    const ext      = blobName.split('.').pop()?.toLowerCase() ?? 'mp4';
    const format   = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'm4v', 'ts'].includes(ext) ? ext : 'mp4';

    let fileSize = 0;
    try {
      const sasUrl = generateReadSasUrl(CONTAINERS.movies, blobName, 1);
      const head = await fetch(sasUrl, { method: 'HEAD' });
      const cl = parseInt(head.headers.get('content-length') ?? '0', 10);
      if (!isNaN(cl)) fileSize = cl;
    } catch {}

    const { data: existingMovie } = await supabaseAdmin
      .from('movies')
      .select('id')
      .eq('ingest_job_id', job_id)
      .maybeSingle();

    if (existingMovie) {
      return NextResponse.json({ movie_id: existingMovie.id });
    }

    let qualityVariants: QualityVariant[] | null = null;
    if (hls_playlist && assigned_quality) {
      qualityVariants = [{
        quality: assigned_quality,
        blob_name: blobName,
        blob_url: blob_url,
        file_size: fileSize,
        hls_playlist: hls_playlist,
      }];
    }

    const { data: movie, error: movieError } = await supabaseAdmin
      .from('movies')
      .insert({
        title:              effectiveTitle.trim(),
        description:        description?.trim() ?? null,
        blob_url,
        blob_name:          blobName,
        poster_url:         poster_url ?? null,
        file_size:          fileSize,
        format,
        quality:            quality ?? null,
        duration:           null,
        subtitles:          subtitles ?? [],
        ingest_method:      'torrent',
        info_hash:          job.hash,
        ingest_job_id:      job_id,
        uploaded_by:        user.id,
        quality_variants:   qualityVariants,
        hls_master_playlist: null,
        // TMDB metadata
        tmdb_id:            tmdb_id ?? null,
        release_date:       release_date ?? null,
        rating:             rating ?? null,
        genres:             genres ?? null,
        runtime:            runtime ?? null,
        tagline:            tagline ?? null,
        imdb_id:            imdb_id ?? null,
        original_language:  original_language ?? null,
        source_type:        source_type ?? null,
        release_name:       release_name ?? null,
        series_name:        series_name ?? null,
        season_number:      season_number ?? null,
        episode_number:     episode_number ?? null,
        episode_title:      episode_title ?? null,
      })
      .select('id')
      .single();

    if (movieError || !movie) {
      const { data: raceWinner } = await supabaseAdmin
        .from('movies')
        .select('id')
        .eq('ingest_job_id', job_id)
        .maybeSingle();

      if (raceWinner) {
        return NextResponse.json({ movie_id: raceWinner.id });
      }

      return NextResponse.json(
        { error: `Failed to create movie: ${movieError?.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ movie_id: movie.id });
  } catch (err: any) {
    console.error('[ingest/finalize]', err);
    return NextResponse.json({ error: err.message ?? 'Unexpected error' }, { status: 500 });
  }
}