/**
 * POST /api/ingest/finalize
 *
 * Called by the client after a torrent job reaches "Ready".
 *
 * For SINGLE-QUALITY (no group): Creates the movie row immediately.
 * For MULTI-QUALITY (grouped):   Creates the movie on the FIRST quality completion
 *                                (immediately watchable). When the second quality
 *                                finishes, adds the variant and generates an HLS
 *                                master playlist for auto quality switching.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateReadSasUrl, uploadBlob, CONTAINERS } from '@/lib/azure-blob';
import type { QualityVariant } from '@/types';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const QUALITY_RANK: Record<string, number> = { '480p': 0, '720p': 1, '1080p': 2, '4K': 3 };

// Approximate bandwidth for each quality (used in HLS master playlist)
const QUALITY_BANDWIDTH: Record<string, number> = {
  '480p':  1_500_000,   // 1.5 Mbps
  '720p':  3_000_000,   // 3 Mbps
  '1080p': 6_000_000,   // 6 Mbps
  '4K':    15_000_000,  // 15 Mbps
};
const QUALITY_RESOLUTION: Record<string, string> = {
  '480p':  '854x480',
  '720p':  '1280x720',
  '1080p': '1920x1080',
  '4K':    '3840x2160',
};

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

/**
 * Generate and upload an HLS master playlist that references per-quality playlists.
 * This enables hls.js to auto-switch quality based on bandwidth.
 *
 * The master playlist uses SAS URLs for each quality's .m3u8 so the player
 * can fetch them directly from Azure.
 */
async function generateAndUploadMasterPlaylist(
  variants: QualityVariant[],
  masterBlobName: string,
): Promise<string | null> {
  // Only variants with HLS playlists can be included
  const hlsVariants = variants.filter(v => v.hls_playlist);
  if (hlsVariants.length < 2) return null;

  // Sort lowest quality first (HLS convention)
  const sorted = [...hlsVariants].sort(
    (a, b) => (QUALITY_RANK[a.quality] ?? 0) - (QUALITY_RANK[b.quality] ?? 0),
  );

  const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:4', ''];

  for (const v of sorted) {
    const bandwidth  = QUALITY_BANDWIDTH[v.quality]  ?? 3_000_000;
    const resolution = QUALITY_RESOLUTION[v.quality] ?? '1280x720';
    // Generate a long-lived SAS URL for the per-quality playlist (4 hours)
    const playlistUrl = generateReadSasUrl(CONTAINERS.movies, v.hls_playlist!, 4);

    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution},NAME="${v.quality}"`,
    );
    lines.push(playlistUrl);
    lines.push('');
  }

  const content = lines.join('\n');

  try {
    await uploadBlob(
      CONTAINERS.movies,
      masterBlobName,
      Buffer.from(content, 'utf-8'),
      'application/vnd.apple.mpegurl',
    );
    console.log(`[finalize] Uploaded HLS master playlist: ${masterBlobName} (${sorted.map(v => v.quality).join(', ')})`);
    return masterBlobName;
  } catch (err) {
    console.error('[finalize] Failed to upload HLS master playlist:', err);
    return null;
  }
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
      ingest_group_id, assigned_quality, generate_hls, hls_playlist,
    } = body;

    if (!job_id || !blob_url) {
      return NextResponse.json({ error: 'job_id and blob_url are required' }, { status: 400 });
    }

    const { data: job } = await supabaseAdmin
      .from('ingest_jobs')
      .select('user_id, hash, status, ingest_group_id, assigned_quality, generate_hls, movie_name, metadata')
      .eq('id', job_id)
      .single();

    if (!job || job.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Title priority: explicit param > job's movie_name > 'Untitled'
    const effectiveTitle = title || job.movie_name || 'Untitled';
    const groupId = ingest_group_id || job.ingest_group_id;

    // ── Multi-quality grouped path ────────────────────────────────────────
    if (groupId) {
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
        // Movie exists — add this job's variant if not already present
        const existingVariants: QualityVariant[] = existingMovie.quality_variants || [];
        const thisQuality = updatedMeta.assigned_quality || assigned_quality || job.assigned_quality;

        const alreadyHas = existingVariants.some(v => v.quality === thisQuality);
        if (alreadyHas) {
          return NextResponse.json({ movie_id: existingMovie.id });
        }

        const result = await buildVariant(updatedMeta, thisQuality, containerName);
        if (result) {
          const newVariants = [...existingVariants, result.variant];
          const newFileSize = (existingMovie.file_size || 0) + result.fileSize;

          const newRank = QUALITY_RANK[thisQuality] ?? 0;
          const currentPrimaryQuality = existingVariants[0]?.quality;
          const currentRank = QUALITY_RANK[currentPrimaryQuality] ?? 0;

          const updatePayload: Record<string, any> = {
            quality_variants: newVariants,
            file_size: newFileSize,
          };

          if (newRank > currentRank) {
            updatePayload.blob_url = result.blobUrl;
            updatePayload.blob_name = result.blobName;
          }

          // ── Generate HLS master playlist if 2+ variants have HLS ──────
          const hlsVariantCount = newVariants.filter(v => v.hls_playlist).length;
          if (hlsVariantCount >= 2) {
            // Derive master playlist blob name from the group's blob base
            const baseName = existingMovie.blob_name.replace(/(-\d{3,4}p)?\.mp4$/, '');
            const masterBlobName = `${baseName}-master.m3u8`;

            const masterPlaylist = await generateAndUploadMasterPlaylist(newVariants, masterBlobName);
            if (masterPlaylist) {
              updatePayload.hls_master_playlist = masterPlaylist;
            }
          }

          await supabaseAdmin
            .from('movies')
            .update(updatePayload)
            .eq('id', existingMovie.id);

          console.log(`[finalize] Added ${thisQuality} variant to movie ${existingMovie.id}` +
            (updatePayload.hls_master_playlist ? ' + HLS master playlist' : ''));
        }

        return NextResponse.json({ movie_id: existingMovie.id });
      }

      // ── No movie yet — create one with completed variants ───────────
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

      // Use metadata from the first completed job for shared fields
      const firstMeta = (completedJobs[0] as any).metadata || {};
      const firstJobRow = completedJobs[0] as any;

      // Title: prefer metadata.title > effectiveTitle (from body param or job.movie_name)
      const movieTitle = (firstMeta.title || effectiveTitle || firstJobRow.movie_name || 'Untitled').trim();

      // Generate HLS master playlist if 2+ variants have HLS playlists
      let hlsMasterPlaylist: string | null = null;
      const hlsVariantCount = qualityVariants.filter(v => v.hls_playlist).length;
      if (hlsVariantCount >= 2) {
        const baseName = primaryBlobName.replace(/(-\d{3,4}p)?\.mp4$/, '');
        const masterBlobName = `${baseName}-master.m3u8`;
        hlsMasterPlaylist = await generateAndUploadMasterPlaylist(qualityVariants, masterBlobName);
      }

      const { data: movie, error: movieError } = await supabaseAdmin
        .from('movies')
        .insert({
          title:              movieTitle,
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
          hls_master_playlist: hlsMasterPlaylist,
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
      console.log(`[finalize] Created movie ${movie.id} with ${completedJobs.length} variant(s), ${remainingCount} pending` +
        (hlsMasterPlaylist ? ' + HLS master' : ''));

      return NextResponse.json({ movie_id: movie.id });
    }

    // ── Single-quality path ──────────────────────────────────────────────

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