/**
 * GET /api/movies/stream
 *
 * Returns a short-lived SAS streaming URL for a movie blob.
 * Called by the watch page to get a playable URL for the video player.
 *
 * Query params:
 *   blobName  string  — the blob_name stored on the movie row (used for legacy single-quality)
 *   movieId   string  — (optional) the movie ID, used for multi-quality/HLS lookups
 *   quality   string  — (optional) e.g. '720p', '1080p' — pick a specific quality variant
 *   hls       string  — (optional) 'master' to get master playlist URL, or '720p'/'1080p' for per-quality playlist
 *
 * Returns: { url: string, variants?: { quality: string, url: string }[], hlsMasterUrl?: string }
 */

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateReadSasUrl, CONTAINERS } from '@/lib/azure-blob';
import type { QualityVariant } from '@/types';

export const dynamic = 'force-dynamic';

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

      // If requesting HLS master playlist
      if (hls === 'master' && movie.hls_master_playlist) {
        const hlsUrl = generateReadSasUrl(CONTAINERS.movies, movie.hls_master_playlist, 4);
        return NextResponse.json({ url: hlsUrl, type: 'hls' });
      }

      // If requesting HLS playlist for a specific quality
      if (hls && hls !== 'master' && variants) {
        const variant = variants.find(v => v.quality === hls);
        if (variant?.hls_playlist) {
          const hlsUrl = generateReadSasUrl(CONTAINERS.movies, variant.hls_playlist, 4);
          return NextResponse.json({ url: hlsUrl, type: 'hls' });
        }
      }

      // If movie has quality variants
      if (variants && variants.length > 0) {
        // Build SAS URLs for all variants
        const variantUrls = variants.map(v => ({
          quality: v.quality,
          url: generateReadSasUrl(CONTAINERS.movies, v.blob_name, 4),
          file_size: v.file_size,
        }));

        // If a specific quality was requested, return that one as primary
        if (quality) {
          const match = variantUrls.find(v => v.quality === quality);
          if (match) {
            return NextResponse.json({
              url: match.url,
              variants: variantUrls,
              hlsMasterUrl: movie.hls_master_playlist
                ? generateReadSasUrl(CONTAINERS.movies, movie.hls_master_playlist, 4)
                : null,
            });
          }
        }

        // Default: return highest quality as primary, plus all variants
        const sorted = [...variantUrls].sort((a, b) => {
          const order = { '480p': 0, '720p': 1, '1080p': 2, '4K': 3 };
          return (order[b.quality as keyof typeof order] ?? 0) - (order[a.quality as keyof typeof order] ?? 0);
        });

        return NextResponse.json({
          url: sorted[0].url,
          variants: variantUrls,
          hlsMasterUrl: movie.hls_master_playlist
            ? generateReadSasUrl(CONTAINERS.movies, movie.hls_master_playlist, 4)
            : null,
        });
      }

      // Fallback: no variants, use the main blob_name
      const url = generateReadSasUrl(CONTAINERS.movies, movie.blob_name, 4);
      return NextResponse.json({ url });
    }

    // ── Legacy single-quality path (backward compatible) ──────────────────
    if (!blobName) {
      return NextResponse.json({ error: 'blobName or movieId is required' }, { status: 400 });
    }

    // Generate a 4-hour SAS URL for streaming
    const url = generateReadSasUrl(CONTAINERS.movies, blobName, 4);
    return NextResponse.json({ url });

  } catch (err: any) {
    console.error('[movies/stream] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}