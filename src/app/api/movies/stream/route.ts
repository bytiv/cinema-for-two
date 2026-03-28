/**
 * GET /api/movies/stream
 *
 * Returns short-lived SAS streaming URLs for a movie.
 * For external URL movies, resolves to playable video URLs inline.
 *
 * Query params:
 *   blobName  string  — blob_name on the movie row (legacy single-quality)
 *   movieId   string  — movie ID for multi-quality/HLS lookups
 *   quality   string  — e.g. '720p', '1080p' — pick a specific quality variant
 *   hls       string  — 'master' for dynamic master playlist, or quality label for per-quality playlist
 *
 * Returns: { url, variants?, hlsMasterUrl? }
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

function buildDynamicMasterPlaylist(variants: QualityVariant[]): string | null {
  const hlsVariants = variants.filter(v => v.hls_playlist);
  if (hlsVariants.length < 1) return null;
  const sorted = [...hlsVariants].sort(
    (a, b) => (QUALITY_ORDER[a.quality] ?? 0) - (QUALITY_ORDER[b.quality] ?? 0),
  );
  const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:4', ''];
  for (const v of sorted) {
    const bandwidth  = QUALITY_BANDWIDTH[v.quality]  ?? 3_000_000;
    const resolution = QUALITY_RESOLUTION[v.quality] ?? '1280x720';
    const playlistUrl = generateReadSasUrl(CONTAINERS.movies, v.hls_playlist!, 4);
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution},NAME="${v.quality}"`);
    lines.push(playlistUrl);
    lines.push('');
  }
  return lines.join('\n');
}

// ── Inline external URL resolvers (no internal HTTP calls) ──────────────────

function extractDailymotionId(url: string): string | null {
  const patterns = [/dailymotion\.com\/video\/([a-zA-Z0-9]+)/, /dai\.ly\/([a-zA-Z0-9]+)/, /dailymotion\.com\/embed\/video\/([a-zA-Z0-9]+)/];
  for (const re of patterns) { const m = url.match(re); if (m?.[1]) return m[1]; }
  return null;
}

async function resolveInternetArchive(url: string): Promise<{ videoUrl: string; qualities: { quality: string; url: string }[] } | null> {
  // Direct download link — already playable
  const dlMatch = url.match(/archive\.org\/download\/([^\/\?\#]+)\/(.+\.(?:mp4|webm|ogv))/i);
  if (dlMatch) return { videoUrl: url, qualities: [] };

  const match = url.match(/archive\.org\/(?:details|embed)\/([^\/\?\#]+)/);
  if (!match?.[1]) return null;
  const itemId = match[1];

  try {
    const metaRes = await fetch(`https://archive.org/metadata/${itemId}`, { signal: AbortSignal.timeout(10000) });
    if (!metaRes.ok) return null;
    const meta = await metaRes.json();
    const files = meta.files || [];
    const baseUrl = `https://archive.org/download/${itemId}`;

    const videoFiles = files
      .filter((f: any) => /\.(mp4|webm|ogv)$/i.test(f.name || ''))
      .map((f: any) => ({
        name: f.name,
        url: `${baseUrl}/${encodeURIComponent(f.name)}`,
        size: parseInt(f.size) || 0,
        height: f.height ? parseInt(f.height) : null,
      }))
      .sort((a: any, b: any) => b.size - a.size);

    if (videoFiles.length === 0) return null;

    const qualities: { quality: string; url: string }[] = [];
    const usedLabels = new Set<string>();
    for (const vf of videoFiles) {
      let label: string;
      if (vf.height) {
        label = vf.height >= 2160 ? '4K' : vf.height >= 1080 ? '1080p' : vf.height >= 720 ? '720p' : vf.height >= 480 ? '480p' : `${vf.height}p`;
      } else {
        const name = vf.name.toLowerCase();
        if (name.includes('1080')) label = '1080p';
        else if (name.includes('720')) label = '720p';
        else if (name.includes('480')) label = '480p';
        else if (vf.size > 2_000_000_000) label = '1080p';
        else if (vf.size > 700_000_000) label = '720p';
        else label = '480p';
      }
      if (!usedLabels.has(label)) {
        usedLabels.add(label);
        qualities.push({ quality: label, url: vf.url });
      }
    }

    return { videoUrl: videoFiles[0].url, qualities };
  } catch (err) {
    console.error('[stream] Internet Archive resolve error:', err);
    return null;
  }
}

// ── Main handler ────────────────────────────────────────────────────────────

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

    // ── Multi-quality / HLS / External path ──────────────────────────────
    if (movieId) {
      const { data: movie } = await supabase
        .from('movies')
        .select('*')
        .eq('id', movieId)
        .single();

      if (!movie) {
        return NextResponse.json({ error: 'Movie not found' }, { status: 404 });
      }

      // ── External URL — resolve inline (no internal HTTP call) ─────────
      // Detect external by ingest_method OR blob_name prefix (for pre-migration DBs)
      const isExternal = movie.ingest_method === 'external_url'
        || (movie.blob_name && movie.blob_name.startsWith('external://'));

      if (isExternal) {
        // external_url may not exist if migration hasn't been run — fall back to blob_url
        const externalUrl = movie.external_url || movie.blob_url || '';
        // Extract provider from blob_name "external://dailymotion" or from external_provider column
        const provider = movie.external_provider
          || (movie.blob_name?.startsWith('external://') ? movie.blob_name.replace('external://', '') : '')
          || '';

        if (!externalUrl || externalUrl.startsWith('external://')) {
          return NextResponse.json({
            error: 'No playable URL stored for this external movie',
            external: true,
            provider,
          }, { status: 400 });
        }

        // ── Dailymotion: use their official embed player ──
        // Scraping HLS/MP4 streams violates their TOS and the URLs expire quickly.
        // The embed player is the correct, reliable approach.
        if (provider === 'dailymotion' || externalUrl.includes('dailymotion.com') || externalUrl.includes('dai.ly')) {
          const videoId = extractDailymotionId(externalUrl);
          if (videoId) {
            return NextResponse.json({
              url: `https://geo.dailymotion.com/player.html?video=${videoId}`,
              external: true,
              provider: 'dailymotion',
              type: 'embed',
              embedVideoId: videoId,
            });
          }
          // If we can't extract the ID, return an error
          return NextResponse.json({
            error: 'Could not extract Dailymotion video ID from URL',
            external: true,
            provider: 'dailymotion',
          }, { status: 400 });
        }

        // ── Other providers: resolve to direct playable URLs ──
        let resolved: { videoUrl: string; qualities: { quality: string; url: string }[] } | null = null;

        if (provider === 'archive.org' || externalUrl.includes('archive.org')) {
          resolved = await resolveInternetArchive(externalUrl);
        } else if (/\.(mp4|webm|m3u8|ogv)(\?.*)?$/i.test(externalUrl)) {
          resolved = { videoUrl: externalUrl, qualities: [] };
        }

        // Generic fallback — try HEAD to check if URL is directly playable
        if (!resolved) {
          try {
            const headRes = await fetch(externalUrl, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(5000) });
            const ct = headRes.headers.get('content-type') || '';
            if (ct.startsWith('video/') || ct.includes('mp4') || ct.includes('mpegurl')) {
              resolved = { videoUrl: externalUrl, qualities: [] };
            }
          } catch {}
        }

        if (resolved) {
          // Wrap URLs through our proxy to bypass CORS
          const origin = new URL(req.url).origin;
          const proxyUrl = (rawUrl: string) =>
            `${origin}/api/external/proxy?url=${encodeURIComponent(rawUrl)}`;

          const proxiedUrl = proxyUrl(resolved.videoUrl);
          const proxiedVariants = resolved.qualities.length > 0
            ? resolved.qualities.map(q => ({ quality: q.quality, url: proxyUrl(q.url) }))
            : undefined;

          return NextResponse.json({
            url: proxiedUrl,
            external: true,
            provider,
            type: 'direct',
            variants: proxiedVariants,
          });
        }

        // Last resort — return stored URL. If it's a page URL, it won't play,
        // but at least the frontend can show an error instead of hanging.
        return NextResponse.json({
          url: externalUrl,
          external: true,
          provider,
          type: 'direct',
          error: 'Could not resolve to a playable video URL',
        });
      }

      const variants: QualityVariant[] | null = movie.quality_variants;

      // ── Serve dynamic HLS master playlist ──────────────────────────────
      if (hls === 'master' && variants) {
        const content = buildDynamicMasterPlaylist(variants);
        if (content) {
          return new Response(content, {
            headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache, no-store' },
          });
        }
      }

      // ── Serve per-quality HLS playlist ─────────────────────────────────
      if (hls && hls !== 'master' && variants) {
        const variant = variants.find(v => v.quality === hls);
        if (variant?.hls_playlist) {
          const hlsUrl = generateReadSasUrl(CONTAINERS.movies, variant.hls_playlist, 4);
          return NextResponse.json({ url: hlsUrl, type: 'hls' });
        }
      }

      // ── Quality variants — return SAS URLs ─────────────────────────────
      if (variants && variants.length > 0) {
        const variantUrls = variants.map(v => ({
          quality: v.quality,
          url: generateReadSasUrl(CONTAINERS.movies, v.blob_name, 4),
          file_size: v.file_size,
        }));

        if (quality) {
          const match = variantUrls.find(v => v.quality === quality);
          if (match) return NextResponse.json({ url: match.url, variants: variantUrls });
        }

        const sorted = [...variantUrls].sort((a, b) => (QUALITY_ORDER[b.quality] ?? 0) - (QUALITY_ORDER[a.quality] ?? 0));
        return NextResponse.json({ url: sorted[0].url, variants: variantUrls });
      }

      // Fallback: no variants — but guard against external:// pseudo names
      if (movie.blob_name && movie.blob_name.startsWith('external://')) {
        return NextResponse.json({
          error: 'External movie with no resolved URL',
          external: true,
        }, { status: 400 });
      }
      const url = generateReadSasUrl(CONTAINERS.movies, movie.blob_name, 4);
      return NextResponse.json({ url });
    }

    // ── Legacy single-quality path ───────────────────────────────────────
    if (!blobName) {
      return NextResponse.json({ error: 'blobName or movieId is required' }, { status: 400 });
    }

    // Guard: never generate SAS URLs for external:// pseudo blob names
    if (blobName.startsWith('external://')) {
      return NextResponse.json({ error: 'External movie — use movieId parameter instead' }, { status: 400 });
    }

    const url = generateReadSasUrl(CONTAINERS.movies, blobName, 4);
    return NextResponse.json({ url });

  } catch (err: any) {
    console.error('[movies/stream] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}