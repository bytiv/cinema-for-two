/**
 * POST /api/external/validate
 *
 * Validates an external video URL and identifies the provider.
 * Does NOT extract playable URLs — that happens at watch time via /api/external/resolve.
 *
 * Body: { url: string }
 * Returns: { provider, url, type: 'direct' | 'page', supported: boolean }
 */

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface ValidateResult {
  provider: string;
  url: string;               // canonical URL to store
  type: 'direct' | 'page';   // 'direct' = raw video file, 'page' = provider page we can resolve later
  supported: boolean;         // true if we can extract the actual video at watch time
}

// ── Provider detection ──────────────────────────────────────────────────────

function detectProvider(url: string): ValidateResult | null {
  // Dailymotion
  const dmPatterns = [
    /dailymotion\.com\/video\/([a-zA-Z0-9]+)/,
    /dai\.ly\/([a-zA-Z0-9]+)/,
    /dailymotion\.com\/embed\/video\/([a-zA-Z0-9]+)/,
  ];
  for (const re of dmPatterns) {
    const match = url.match(re);
    if (match?.[1]) {
      return {
        provider: 'dailymotion',
        url: `https://www.dailymotion.com/video/${match[1]}`,
        type: 'page',
        supported: true,
      };
    }
  }

  // Internet Archive
  const iaPatterns = [
    /archive\.org\/details\/([^\/\?\#]+)/,
    /archive\.org\/embed\/([^\/\?\#]+)/,
  ];
  for (const re of iaPatterns) {
    const match = url.match(re);
    if (match?.[1]) {
      return {
        provider: 'archive.org',
        url: `https://archive.org/details/${match[1]}`,
        type: 'page',
        supported: true,
      };
    }
  }
  // Archive.org direct download link
  if (/archive\.org\/download\/[^\/]+\/.+\.(mp4|webm|ogv)/i.test(url)) {
    return { provider: 'archive.org', url, type: 'direct', supported: true };
  }

  // OK.ru
  if (/ok\.ru\/video\/(\d+)/.test(url)) {
    return { provider: 'ok.ru', url, type: 'page', supported: false };
  }

  // VK
  if (/vk\.com\/video/.test(url)) {
    return { provider: 'vk', url, type: 'page', supported: false };
  }

  // Streamtape
  const stMatch = url.match(/streamtape\.com\/(?:v|e)\/([a-zA-Z0-9]+)/);
  if (stMatch?.[1]) {
    return { provider: 'streamtape', url, type: 'page', supported: false };
  }

  // Direct video file
  if (/\.(mp4|webm|m3u8|ogv|mkv)(\?.*)?$/i.test(url)) {
    return { provider: 'direct', url, type: 'direct', supported: true };
  }

  // Generic embed URL (contains /embed/ or /player/)
  if (/\/embed[\/\?]|\/player[\/\?]|\/e\//i.test(url)) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      return { provider: hostname, url, type: 'page', supported: false };
    } catch {}
  }

  return null;
}

// ── Main handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const trimmed = url.trim();

    // Validate URL format
    try { new URL(trimmed); } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      return NextResponse.json({ error: 'Only HTTP/HTTPS URLs are supported' }, { status: 400 });
    }

    // Detect provider
    const result = detectProvider(trimmed);

    if (result) {
      return NextResponse.json(result);
    }

    // Unknown URL — try HEAD to check if it's a video
    try {
      const headRes = await fetch(trimmed, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      const ct = headRes.headers.get('content-type') || '';
      if (ct.startsWith('video/') || ct.includes('mp4') || ct.includes('mpegurl')) {
        return NextResponse.json({
          provider: 'direct',
          url: trimmed,
          type: 'direct',
          supported: true,
        });
      }
    } catch {}

    // Last resort — accept it but mark as unsupported
    try {
      const hostname = new URL(trimmed).hostname.replace(/^www\./, '');
      return NextResponse.json({
        provider: hostname,
        url: trimmed,
        type: 'page',
        supported: false,
      });
    } catch {
      return NextResponse.json(
        { error: 'Could not validate this URL' },
        { status: 400 },
      );
    }
  } catch (err: any) {
    console.error('[external/validate]', err.message);
    return NextResponse.json({ error: err.message || 'Validation failed' }, { status: 500 });
  }
}