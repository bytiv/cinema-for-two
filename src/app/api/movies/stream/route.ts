/**
 * GET /api/movies/stream
 *
 * Returns short-lived SAS streaming URLs for a movie.
 *
 * Query params:
 *   blobName  string  — blob_name on the movie row (legacy single-quality)
 *   movieId   string  — movie ID for multi-quality/HLS lookups
 *   quality   string  — e.g. '720p', '1080p' — pick a specific quality variant
 *   hls       string  — 'master' for dynamic master playlist, or quality label for per-quality playlist
 *
 * Returns: { url, variants?, hlsMasterUrl? }
 *
 * The master playlist is generated DYNAMICALLY with fresh SAS URLs on every
 * request — no stale tokens from static blob files.
 */

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateReadSasUrl, CONTAINERS } from '@/lib/azure-blob';
import type { QualityVariant } from '@/types';

export const dynamic = 'force-dynamic';

const QUALITY_ORDER: Record<string, number> = { '480p': 0, '720p': 1, '1080p': 2, '4K': 3 };
const QUALITY_BANDWIDTH: Record<string, number> = {
  '480p':  1_500_000,
  '720p':  3_000_000,
  '1080p': 6_000_000,
  '4K':    15_000_000,
};
const QUALITY_RESOLUTION: Record<string, string> = {
  '480p':  '854x480',
  '720p':  '1280x720',
  '1080p': '1920x1080',
  '4K':    '3840x2160',
};

/**
 * Generate a master HLS playlist on-the-fly with fresh SAS URLs.
 * Returns the playlist content as a string.
 */
function buildDynamicMasterPlaylist(variants: QualityVariant[]): string | null {
  const hlsVariants = variants.filter(v => v.hls_playlist);
  if (hlsVariants.length < 1) return null;

  // Sort lowest quality first (HLS convention)
  const sorted = [...hlsVariants].sort(
    (a, b) => (QUALITY_ORDER[a.quality] ?? 0) - (QUALITY_ORDER[b.quality] ?? 0),
  );

  const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:4', ''];

  for (const v of sorted) {
    const bandwidth  = QUALITY_BANDWIDTH[v.quality]  ?? 3_000_000;
    const resolution = QUALITY_RESOLUTION[v.quality] ?? '1280x720';
    // Fresh 4-hour SAS URL for each per-quality playlist
    const playlistUrl = generateReadSasUrl(CONTAINERS.movies, v.hls_playlist!, 4);

    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution},NAME="${v.quality}"`,
    );
    lines.push(playlistUrl);
    lines.push('');
  }

  return lines.join('\n');
}

export async function GET(req: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const blobName = searchParams.get('blobName');
    const movieId  = searchParams.get('movieId');
    const quality  = searchParams.get('quality');
    const hls      = searchParams.get('hls');

    // ── Multi-quality / HLS path ──────────────────────────────────────────
    if (movieId) {
      const { data: movie } = await supabase
        .from('movies')
        .select('blob_name, quality_variants, hls_master_playlist')
        .eq('id', movieId)
        .single();

      if (!movie) {
        return NextResponse.json({ error: 'Movie not found' }, { status: 404 });
      }

      const variants: QualityVariant[] | null = movie.quality_variants;

      // ── Serve dynamic HLS master playlist ────────────────────────────
      if (hls === 'master' && variants) {
        const content = buildDynamicMasterPlaylist(variants);
        if (content) {
          return new Response(content, {
            headers: {
              'Content-Type': 'application/vnd.apple.mpegurl',
              'Cache-Control': 'no-cache, no-store',
            },
          });
        }
      }

      // ── Serve per-quality HLS playlist ───────────────────────────────
      if (hls && hls !== 'master' && variants) {
        const variant = variants.find(v => v.quality === hls);
        if (variant?.hls_playlist) {
          const hlsUrl = generateReadSasUrl(CONTAINERS.movies, variant.hls_playlist, 4);
          return NextResponse.json({ url: hlsUrl, type: 'hls' });
        }
      }

      // ── Quality variants — return SAS URLs + master playlist URL ─────
      if (variants && variants.length > 0) {
        const variantUrls = variants.map(v => ({
          quality: v.quality,
          url: generateReadSasUrl(CONTAINERS.movies, v.blob_name, 4),
          file_size: v.file_size,
        }));

        // Check if any variants have HLS playlists for the master URL
        const hasHlsPlaylists = variants.some(v => v.hls_playlist);

        // hlsMasterUrl points back to THIS endpoint so the player fetches
        // a fresh dynamic master playlist (not the stale static blob)
        const hlsMasterUrl = hasHlsPlaylists
          ? `/api/movies/stream?movieId=${encodeURIComponent(movieId)}&hls=master`
          : null;

        if (quality) {
          const match = variantUrls.find(v => v.quality === quality);
          if (match) {
            return NextResponse.json({
              url: match.url,
              variants: variantUrls,
              hlsMasterUrl,
            });
          }
        }

        // Default: highest quality as primary
        const sorted = [...variantUrls].sort((a, b) =>
          (QUALITY_ORDER[b.quality] ?? 0) - (QUALITY_ORDER[a.quality] ?? 0),
        );

        return NextResponse.json({
          url: sorted[0].url,
          variants: variantUrls,
          hlsMasterUrl,
        });
      }

      // Fallback: no variants
      const url = generateReadSasUrl(CONTAINERS.movies, movie.blob_name, 4);
      return NextResponse.json({ url });
    }

    // ── Legacy single-quality path ────────────────────────────────────────
    if (!blobName) {
      return NextResponse.json({ error: 'blobName or movieId is required' }, { status: 400 });
    }

    const url = generateReadSasUrl(CONTAINERS.movies, blobName, 4);
    return NextResponse.json({ url });

  } catch (err: any) {
    console.error('[movies/stream] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}