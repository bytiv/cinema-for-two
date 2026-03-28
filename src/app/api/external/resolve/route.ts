/**
 * GET /api/external/resolve
 *
 * Resolves an external video URL to actual playable stream URLs.
 * Called at watch-time to get fresh/non-expired direct video URLs.
 *
 * Query params:
 *   url       string — the stored external URL (page URL or direct URL)
 *   provider  string — provider name (dailymotion, archive.org, direct, etc.)
 *
 * Returns: {
 *   videoUrl: string,                    // primary playable URL
 *   qualities?: { quality: string; url: string }[],  // available quality variants
 *   type: 'direct'                       // always direct now — no more embeds
 * }
 */

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// ── Dailymotion resolver ─────────────────────────────────────────────────────
// Uses official embed player instead of scraping streams (which violates TOS
// and breaks because HLS segment URLs expire / are CORS-blocked).

function resolveDailymotion(url: string): {
  videoUrl: string;
  qualities: { quality: string; url: string }[];
  type: 'embed';
  embedVideoId: string;
} | null {
  const patterns = [
    /dailymotion\.com\/video\/([a-zA-Z0-9]+)/,
    /dai\.ly\/([a-zA-Z0-9]+)/,
    /dailymotion\.com\/embed\/video\/([a-zA-Z0-9]+)/,
  ];
  let videoId: string | null = null;
  for (const re of patterns) {
    const match = url.match(re);
    if (match?.[1]) { videoId = match[1]; break; }
  }
  if (!videoId) return null;

  return {
    videoUrl: `https://geo.dailymotion.com/player.html?video=${videoId}`,
    qualities: [],
    type: 'embed',
    embedVideoId: videoId,
  };
}

// ── Internet Archive resolver ────────────────────────────────────────────────
// Fetches the item metadata to find actual MP4 files with different qualities

async function resolveInternetArchive(url: string): Promise<{
  videoUrl: string;
  qualities: { quality: string; url: string }[];
} | null> {
  // Extract item identifier
  const match = url.match(/archive\.org\/(?:details|embed|download)\/([^\/\?\#]+)/);
  if (!match?.[1]) return null;
  const itemId = match[1];

  try {
    // Fetch item metadata — lists all files
    const metaRes = await fetch(
      `https://archive.org/metadata/${itemId}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!metaRes.ok) return null;
    const meta = await metaRes.json();

    const files = meta.files || [];
    const baseUrl = `https://archive.org/download/${itemId}`;

    // Find video files (mp4, ogv, webm) and sort by size (proxy for quality)
    const videoFiles = files
      .filter((f: any) => {
        const name = (f.name || '').toLowerCase();
        return name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.ogv');
      })
      .map((f: any) => ({
        name: f.name,
        url: `${baseUrl}/${encodeURIComponent(f.name)}`,
        size: parseInt(f.size) || 0,
        format: f.format || '',
        height: f.height ? parseInt(f.height) : null,
      }))
      .sort((a: any, b: any) => b.size - a.size); // largest first = best quality

    if (videoFiles.length === 0) return null;

    // Build quality variants
    const qualities: { quality: string; url: string }[] = [];
    for (const vf of videoFiles) {
      let label: string;
      if (vf.height) {
        label = vf.height >= 2160 ? '4K' : vf.height >= 1080 ? '1080p'
          : vf.height >= 720 ? '720p' : vf.height >= 480 ? '480p' : `${vf.height}p`;
      } else {
        // Guess from filename or size
        const name = vf.name.toLowerCase();
        if (name.includes('1080') || name.includes('fullhd')) label = '1080p';
        else if (name.includes('720') || name.includes('hd')) label = '720p';
        else if (name.includes('480') || name.includes('sd')) label = '480p';
        else if (vf.size > 2_000_000_000) label = '1080p';
        else if (vf.size > 700_000_000) label = '720p';
        else label = '480p';
      }

      // Avoid duplicate quality labels
      if (!qualities.find(q => q.quality === label)) {
        qualities.push({ quality: label, url: vf.url });
      }
    }

    // Best = first (largest file, sorted above)
    const bestUrl = videoFiles[0].url;

    return { videoUrl: bestUrl, qualities };
  } catch (err) {
    console.error('[resolve] Internet Archive error:', err);
    return null;
  }
}

// ── Direct URL resolver (pass-through) ───────────────────────────────────────

function resolveDirect(url: string): {
  videoUrl: string;
  qualities: { quality: string; url: string }[];
} {
  return { videoUrl: url, qualities: [] };
}

// ── Fallback: try HEAD request to see if URL is directly playable ────────────

async function resolveGeneric(url: string): Promise<{
  videoUrl: string;
  qualities: { quality: string; url: string }[];
} | null> {
  try {
    const headRes = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    const ct = headRes.headers.get('content-type') || '';
    if (ct.startsWith('video/') || ct.includes('mpegurl') || ct.includes('mp4')) {
      return { videoUrl: url, qualities: [] };
    }
  } catch {}
  return null;
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const url      = searchParams.get('url');
    const provider = searchParams.get('provider') || '';

    if (!url) {
      return NextResponse.json({ error: 'url parameter required' }, { status: 400 });
    }

    let result: { videoUrl: string; qualities: { quality: string; url: string }[]; type?: string; embedVideoId?: string } | null = null;

    // Route to the right resolver
    if (provider === 'dailymotion' || url.includes('dailymotion.com') || url.includes('dai.ly')) {
      result = resolveDailymotion(url);
    } else if (provider === 'archive.org' || url.includes('archive.org')) {
      result = await resolveInternetArchive(url);
    } else if (provider === 'direct' || /\.(mp4|webm|m3u8|ogv)(\?.*)?$/i.test(url)) {
      result = resolveDirect(url);
    }

    // Fallback for unknown providers
    if (!result) {
      result = await resolveGeneric(url);
    }

    if (!result) {
      return NextResponse.json(
        { error: 'Could not extract a playable video URL from this source. The provider may not be supported or the video may be unavailable.' },
        { status: 400 },
      );
    }

    return NextResponse.json({
      videoUrl: result.videoUrl,
      qualities: result.qualities.length > 0 ? result.qualities : undefined,
      type: result.type || 'direct',
      ...(result.embedVideoId ? { embedVideoId: result.embedVideoId } : {}),
    });
  } catch (err: any) {
    console.error('[external/resolve]', err.message);
    return NextResponse.json({ error: err.message || 'Failed to resolve video URL' }, { status: 500 });
  }
}