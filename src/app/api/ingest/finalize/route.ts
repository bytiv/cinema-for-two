/**
 * POST /api/ingest/finalize
 *
 * Called by the client after a torrent job reaches "Ready".
 *
 * For SINGLE-QUALITY (no group): Creates the movie row immediately (legacy behavior).
 * For MULTI-QUALITY (grouped):   Only creates the movie row once ALL jobs in the
 *                                 group are "Ready" (completed). If some jobs are
 *                                 still running, returns { waiting: true }.
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
      await supabaseAdmin
        .from('ingest_jobs')
        .update({
          status: 'completed',
          finished_at: new Date().toISOString(),
          metadata: {
            ...(job as any).metadata,
            blob_url,
            assigned_quality: assigned_quality || job.assigned_quality,
            hls_playlist: hls_playlist || null,
            title, description, poster_url, subtitles,
            tmdb_id, release_date, rating, genres, runtime,
            tagline, imdb_id, original_language, source_type, release_name,
            series_name, season_number, episode_number, episode_title,
          },
        })
        .eq('id', job_id);

      // Check if ALL jobs in this group are now completed
      const { data: groupJobs } = await supabaseAdmin
        .from('ingest_jobs')
        .select('id, status, metadata, assigned_quality, hash')
        .eq('ingest_group_id', groupId);

      if (!groupJobs) {
        return NextResponse.json({ error: 'Failed to fetch group jobs' }, { status: 500 });
      }

      const allCompleted = groupJobs.every(j => j.status === 'completed');
      const anyFailed    = groupJobs.some(j => j.status === 'failed' || j.status === 'cancelled');

      if (!allCompleted) {
        // Some jobs still running — don't create movie yet
        return NextResponse.json({
          waiting: true,
          completed: groupJobs.filter(j => j.status === 'completed').length,
          total: groupJobs.length,
          failed: anyFailed,
        });
      }

      // All done! Check if movie already exists for this group
      const { data: existingMovie } = await supabaseAdmin
        .from('movies')
        .select('id')
        .eq('ingest_group_id', groupId)
        .maybeSingle();

      if (existingMovie) {
        return NextResponse.json({ movie_id: existingMovie.id });
      }

      // Build quality_variants array from all completed jobs
      const containerName = process.env.AZURE_STORAGE_CONTAINER_MOVIES ?? 'movies';
      const qualityVariants: QualityVariant[] = [];

      // Use the first job's data for shared metadata (title, poster, etc.)
      let primaryBlobUrl = '';
      let primaryBlobName = '';
      let primaryInfoHash = '';
      let totalFileSize = 0;

      for (const gj of groupJobs) {
        const meta = (gj as any).metadata || {};
        const gjBlobUrl = meta.blob_url;
        if (!gjBlobUrl) continue;

        const afterContainer = gjBlobUrl.split(`/${containerName}/`)[1];
        if (!afterContainer) continue;

        const gjBlobName = afterContainer;
        const gjQuality  = meta.assigned_quality || gj.assigned_quality || quality;

        // Probe file size
        let fileSize = 0;
        try {
          const sasUrl = generateReadSasUrl(CONTAINERS.movies, gjBlobName, 1);
          const head = await fetch(sasUrl, { method: 'HEAD' });
          const cl = parseInt(head.headers.get('content-length') ?? '0', 10);
          if (!isNaN(cl)) fileSize = cl;
        } catch {}

        qualityVariants.push({
          quality: gjQuality,
          blob_name: gjBlobName,
          blob_url: gjBlobUrl,
          file_size: fileSize,
          hls_playlist: meta.hls_playlist || null,
        });

        totalFileSize += fileSize;

        // Use highest quality as the primary/fallback
        if (!primaryBlobUrl || gjQuality === '1080p' || gjQuality === '4K') {
          primaryBlobUrl  = gjBlobUrl;
          primaryBlobName = gjBlobName;
          primaryInfoHash = gj.hash;
        }
      }

      const ext    = primaryBlobName.split('.').pop()?.toLowerCase() ?? 'mp4';
      const format = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'm4v', 'ts'].includes(ext) ? ext : 'mp4';

      // Determine HLS master playlist (will be set by a later stage when HLS generation is implemented)
      // For now, set to null — Stage 3 will populate this
      const hlsMasterPlaylist = null;

      // Get shared metadata from the first job
      const firstMeta = (groupJobs[0] as any).metadata || {};

      const { data: movie, error: movieError } = await supabaseAdmin
        .from('movies')
        .insert({
          title:              (firstMeta.title || effectiveTitle).trim(),
          description:        (firstMeta.description || description)?.trim() ?? null,
          blob_url:           primaryBlobUrl,
          blob_name:          primaryBlobName,
          poster_url:         firstMeta.poster_url || poster_url || null,
          file_size:          totalFileSize,
          format,
          quality:            null,  // multi-quality — individual qualities are in variants
          duration:           null,
          subtitles:          firstMeta.subtitles || subtitles || [],
          ingest_method:      'torrent',
          info_hash:          primaryInfoHash,
          ingest_job_id:      job_id,  // reference to the last-completing job
          ingest_group_id:    groupId,
          uploaded_by:        user.id,
          quality_variants:   qualityVariants,
          hls_master_playlist: hlsMasterPlaylist,
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

      return NextResponse.json({ movie_id: movie.id });
    }

    // ── Single-quality path (legacy behavior) ─────────────────────────────

    // Derive blob_name from blob_url
    const containerName = process.env.AZURE_STORAGE_CONTAINER_MOVIES ?? 'movies';
    const afterContainer = blob_url.split(`/${containerName}/`)[1];
    if (!afterContainer) {
      return NextResponse.json({ error: 'Invalid blob_url format' }, { status: 400 });
    }

    const blobName = afterContainer;
    const ext      = blobName.split('.').pop()?.toLowerCase() ?? 'mp4';
    const format   = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'm4v', 'ts'].includes(ext) ? ext : 'mp4';

    // Probe file size via SAS URL
    let fileSize = 0;
    try {
      const sasUrl = generateReadSasUrl(CONTAINERS.movies, blobName, 1);
      const head = await fetch(sasUrl, { method: 'HEAD' });
      const cl = parseInt(head.headers.get('content-length') ?? '0', 10);
      if (!isNaN(cl)) fileSize = cl;
    } catch {}

    // Guard against duplicate inserts
    const { data: existingMovie } = await supabaseAdmin
      .from('movies')
      .select('id')
      .eq('ingest_job_id', job_id)
      .maybeSingle();

    if (existingMovie) {
      return NextResponse.json({ movie_id: existingMovie.id });
    }

    // Build single-quality variant if HLS was enabled for single quality
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

    // Insert movie row
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
        hls_master_playlist: null,  // will be set by HLS generation in Stage 3
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