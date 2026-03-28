/**
 * GET /api/external/proxy
 *
 * Proxies external video content through our server to bypass CORS.
 * Supports HTTP Range requests for seeking/streaming.
 *
 * Query params:
 *   url  string — the actual video URL to proxy (must be from a known provider)
 *
 * Security: Only proxies URLs from whitelisted domains.
 */

import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
// Disable body size limit for video streaming
export const maxDuration = 300; // 5 min max execution time

// Only proxy from these domains — prevents abuse
const ALLOWED_DOMAINS = [
  'cdndirector.dailymotion.com',
  'cdn-cf-east.streamable.com',
  'proxy-', // dailymotion proxy servers: proxy-01.xx.dailymotion.com etc.
  '.dailymotion.com',
  'archive.org',
  'ia800', 'ia600', 'ia900', // archive.org CDN servers
  '.us.archive.org',
];

function isAllowedUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return ALLOWED_DOMAINS.some(d => {
      if (d.startsWith('.')) return hostname.endsWith(d);
      return hostname.includes(d);
    });
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    // Auth check
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const url = req.nextUrl.searchParams.get('url');
    if (!url) {
      return new Response('url parameter required', { status: 400 });
    }

    // Security: only proxy from whitelisted domains
    if (!isAllowedUrl(url)) {
      return new Response('Domain not allowed for proxying', { status: 403 });
    }

    // Forward range header for seeking support
    const rangeHeader = req.headers.get('range');
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
    if (rangeHeader) {
      headers['Range'] = rangeHeader;
    }

    const upstream = await fetch(url, {
      headers,
      // No timeout — video streams can take a while
    });

    if (!upstream.ok && upstream.status !== 206) {
      return new Response(`Upstream error: ${upstream.status}`, { status: upstream.status });
    }

    // Build response headers
    const responseHeaders = new Headers();

    // Forward content headers
    const contentType = upstream.headers.get('content-type');
    if (contentType) responseHeaders.set('Content-Type', contentType);

    const contentLength = upstream.headers.get('content-length');
    if (contentLength) responseHeaders.set('Content-Length', contentLength);

    const contentRange = upstream.headers.get('content-range');
    if (contentRange) responseHeaders.set('Content-Range', contentRange);

    const acceptRanges = upstream.headers.get('accept-ranges');
    if (acceptRanges) responseHeaders.set('Accept-Ranges', acceptRanges);
    else responseHeaders.set('Accept-Ranges', 'bytes');

    // CORS headers — allow our frontend
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Range');
    responseHeaders.set('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

    // Cache for 1 hour
    responseHeaders.set('Cache-Control', 'public, max-age=3600');

    return new Response(upstream.body, {
      status: upstream.status, // 200 or 206
      headers: responseHeaders,
    });
  } catch (err: any) {
    console.error('[external/proxy] error:', err.message);
    return new Response(err.message || 'Proxy error', { status: 500 });
  }
}

// Handle preflight CORS requests
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
    },
  });
}

// HEAD requests for preloader
export async function HEAD(req: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response('Unauthorized', { status: 401 });

    const url = req.nextUrl.searchParams.get('url');
    if (!url || !isAllowedUrl(url)) return new Response('Forbidden', { status: 403 });

    const upstream = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    });

    const responseHeaders = new Headers();
    const cl = upstream.headers.get('content-length');
    if (cl) responseHeaders.set('Content-Length', cl);
    const ct = upstream.headers.get('content-type');
    if (ct) responseHeaders.set('Content-Type', ct);
    responseHeaders.set('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

    return new Response(null, { status: 200, headers: responseHeaders });
  } catch {
    return new Response('HEAD failed', { status: 500 });
  }
}
