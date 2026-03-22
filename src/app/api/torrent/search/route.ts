import { NextResponse } from 'next/server';

// ── Types ────────────────────────────────────────────────────────────────────

interface TorrentResult {
  name: string;
  hash: string;
  size: string;
  size_bytes: number;
  seeders: number;
  leechers: number;
  quality: string | null;       // 480p, 720p, 1080p, 4K
  source_type: string | null;   // BluRay, WEB-DL, HDRip, etc.
  codec: string | null;         // x264, x265, HEVC
  origin: string;               // which indexer found it
  magnet: string;
  score: number;                // computed ranking score
}

// ── Quality & source detection ───────────────────────────────────────────────

function detectQuality(name: string): string | null {
  const n = name.toLowerCase();
  if (n.includes('2160p') || n.includes('4k') || n.includes('uhd')) return '4K';
  if (n.includes('1080p')) return '1080p';
  if (n.includes('720p')) return '720p';
  if (n.includes('480p')) return '480p';
  return null;
}

function detectSourceType(name: string): string | null {
  const n = name.toLowerCase();
  if (n.includes('bluray') || n.includes('blu-ray') || n.includes('bdrip') || n.includes('brrip')) return 'BluRay';
  if (n.includes('web-dl') || n.includes('webdl')) return 'WEB-DL';
  if (n.includes('webrip')) return 'WEBRip';
  if (n.includes('hdrip')) return 'HDRip';
  if (n.includes('dvdrip')) return 'DVDRip';
  if (n.includes('hdtv')) return 'HDTV';
  if (n.includes('remux')) return 'Remux';
  return null;
}

function detectCodec(name: string): string | null {
  const n = name.toLowerCase();
  if (n.includes('x265') || n.includes('h265') || n.includes('hevc')) return 'x265';
  if (n.includes('x264') || n.includes('h264') || n.includes('avc')) return 'x264';
  if (n.includes('av1')) return 'AV1';
  return null;
}

function isCamOrTS(name: string): boolean {
  const n = name.toLowerCase();
  const bad = ['camrip', 'cam-rip', 'hdcam', 'hd-cam', 'telesync', 'ts-rip', 'tsrip',
               'telecine', 'tc-rip', 'hdts', 'hd-ts', '.cam.', '.ts.', 'predvd'];
  return bad.some(b => n.includes(b));
}

function parseSizeToBytes(size: string): number {
  const match = size.match(/([\d.]+)\s*(gb|mb|kb|tb)/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'tb') return val * 1024 * 1024 * 1024 * 1024;
  if (unit === 'gb') return val * 1024 * 1024 * 1024;
  if (unit === 'mb') return val * 1024 * 1024;
  if (unit === 'kb') return val * 1024;
  return 0;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

function scoreResult(r: TorrentResult, preferredQuality: string | null): number {
  let score = 0;

  // Seeders are king — logarithmic so 100 seeders isn't 100x better than 1
  score += Math.min(Math.log2(r.seeders + 1) * 15, 100);

  // Quality match bonus
  if (preferredQuality && r.quality === preferredQuality) {
    score += 50;
  } else if (r.quality === '1080p') {
    score += 30; // default preference
  } else if (r.quality === '720p') {
    score += 20;
  } else if (r.quality === '4K') {
    score += 25;
  }

  // Source type bonus
  if (r.source_type === 'BluRay') score += 20;
  else if (r.source_type === 'Remux') score += 18;
  else if (r.source_type === 'WEB-DL') score += 15;
  else if (r.source_type === 'WEBRip') score += 10;
  else if (r.source_type === 'HDRip') score += 5;

  // Codec preference
  if (r.codec === 'x265') score += 5; // smaller files
  if (r.codec === 'x264') score += 3; // max compatibility

  // Penalize very large files (>15GB) slightly
  if (r.size_bytes > 15 * 1024 * 1024 * 1024) score -= 10;
  // Penalize very small files (<500MB for a movie) — likely bad quality
  if (r.size_bytes > 0 && r.size_bytes < 500 * 1024 * 1024) score -= 15;

  return Math.round(score);
}

// ── Scraper: YTS (multiple mirrors) ──────────────────────────────────────────

async function searchYTS(query: string, year?: number): Promise<TorrentResult[]> {
  // Try multiple YTS domains — yts.mx is blocked in many regions
  const domains = ['yts.lt', 'yts.mx', 'yts.am'];

  for (const domain of domains) {
    try {
      const params = new URLSearchParams({ query_term: query, limit: '20', sort_by: 'seeds' });
      const res = await fetch(`https://${domain}/api/v2/list_movies.json?${params}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;

      const text = await res.text();
      if (text.startsWith('<')) continue; // HTML response = blocked/redirect

      const data = JSON.parse(text);
      const movies = data?.data?.movies;
      if (!Array.isArray(movies)) continue;

      const results: TorrentResult[] = [];
      for (const movie of movies) {
        if (year && movie.year && Math.abs(movie.year - year) > 1) continue;
        const torrents = movie.torrents;
        if (!Array.isArray(torrents)) continue;

        for (const t of torrents) {
          const hash = t.hash;
          if (!hash) continue;
          const quality = t.quality || detectQuality(t.type || '');
          const trackers = [
            'udp://tracker.opentrackr.org:1337/announce',
            'udp://open.stealth.si:80/announce',
            'udp://tracker.torrent.eu.org:451/announce',
            'udp://exodus.desync.com:6969/announce',
          ];
          const magnet = `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(movie.title_long || movie.title)}&${trackers.map(tr => `tr=${encodeURIComponent(tr)}`).join('&')}`;
          results.push({
            name: `${movie.title_long || movie.title} [${quality || '?'}] [YTS]`,
            hash,
            size: t.size || '?',
            size_bytes: parseSizeToBytes(t.size || '0'),
            seeders: t.seeds || 0,
            leechers: t.peers || 0,
            quality,
            source_type: t.type?.includes('bluray') ? 'BluRay' : (t.type?.includes('web') ? 'WEB-DL' : null),
            codec: detectCodec(t.type || ''),
            origin: 'YTS',
            magnet,
            score: 0,
          });
        }
      }
      if (results.length > 0) return results;
    } catch (e) {
      console.warn(`[YTS] ${domain} failed:`, (e as Error).message);
      continue;
    }
  }
  return [];
}

// ── Scraper: 1337x (multiple mirrors) ────────────────────────────────────────

async function search1337x(query: string): Promise<TorrentResult[]> {
  const domains = ['1337x.to', '1337x.st', '1337x.gd', '1337x.is'];

  for (const domain of domains) {
    try {
      const searchUrl = `https://${domain}/search/${encodeURIComponent(query)}/1/`;
      const res = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (!html.includes('coll-1')) continue; // not a valid results page

      // Parse search results page
      const rowRegex = /<td class="coll-1 name">.*?<a href="(\/torrent\/[^"]+)"[^>]*>([^<]+)<\/a>.*?<td class="coll-2[^"]*">([^<]+)<\/td>.*?<td class="coll-4[^"]*">(\d+)<\/td>.*?<td class="coll-5[^"]*">(\d+)<\/td>/gs;

      const detailLinks: { url: string; name: string; size: string; seeders: number; leechers: number }[] = [];
      let match;
      while ((match = rowRegex.exec(html)) !== null && detailLinks.length < 8) {
        detailLinks.push({
          url: `https://${domain}${match[1]}`,
          name: match[2].trim(),
          size: match[3].trim(),
          seeders: parseInt(match[4]) || 0,
          leechers: parseInt(match[5]) || 0,
        });
      }

      if (detailLinks.length === 0) continue;

      // Fetch detail pages in parallel to get magnet links
      const detailPromises = detailLinks.map(async (item) => {
        try {
          const detailRes = await fetch(item.url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
            signal: AbortSignal.timeout(8000),
          });
          if (!detailRes.ok) return null;
          const detailHtml = await detailRes.text();
          const magnetMatch = detailHtml.match(/href="(magnet:\?[^"]+)"/);
          if (!magnetMatch) return null;
          const magnet = magnetMatch[1].replace(/&amp;/g, '&');
          const hashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/i);
          if (!hashMatch) return null;
          return {
            name: item.name, hash: hashMatch[1].toUpperCase(), size: item.size,
            size_bytes: parseSizeToBytes(item.size), seeders: item.seeders,
            leechers: item.leechers, quality: detectQuality(item.name),
            source_type: detectSourceType(item.name), codec: detectCodec(item.name),
            origin: '1337x', magnet, score: 0,
          } satisfies TorrentResult;
        } catch { return null; }
      });

      const settled = await Promise.all(detailPromises);
      const results = settled.filter((r): r is TorrentResult => r !== null);
      if (results.length > 0) return results;
    } catch (e) {
      console.warn(`[1337x] ${domain} failed:`, (e as Error).message);
      continue;
    }
  }
  return [];
}

// ── Scraper: The Pirate Bay (via apibay.org / thepiratebay.org) ──────────────

async function searchTPB(query: string): Promise<TorrentResult[]> {
  // TPB's JSON API is served from apibay.org (separate domain from thepiratebay.org).
  // The main site loads this API via client-side JS. We try multiple domains.
  const apis = [
    { base: 'https://apibay.org', path: '/q.php' },
    { base: 'https://piratebay.live', path: '/q.php' },
    { base: 'https://tpb.party', path: '/q.php' },
    { base: 'https://thepiratebay.org', path: '/q.php' },
  ];

  for (const { base, path } of apis) {
    try {
      const url = `${base}${path}?q=${encodeURIComponent(query)}&cat=207`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;

      const text = await res.text();
      if (text.startsWith('<') || text === '[]' || !text.startsWith('[')) continue;

      let data: any[];
      try { data = JSON.parse(text); } catch { continue; }
      if (!Array.isArray(data) || data.length === 0) continue;
      if (data.length === 1 && data[0].id === '0') continue;

      const trackers = [
        'udp://tracker.opentrackr.org:1337/announce',
        'udp://open.stealth.si:80/announce',
        'udp://tracker.torrent.eu.org:451/announce',
        'udp://exodus.desync.com:6969/announce',
        'udp://tracker.openbittorrent.com:6969/announce',
      ];
      const trStr = trackers.map(tr => `&tr=${encodeURIComponent(tr)}`).join('');

      const results = data.slice(0, 25).map((t: any) => {
        const hash = (t.info_hash || '').toUpperCase();
        const name = t.name || 'Unknown';
        const seeders = parseInt(t.seeders) || 0;
        const leechers = parseInt(t.leechers) || 0;
        const sizeBytes = parseInt(t.size) || 0;
        const sizeStr = sizeBytes > 1024 * 1024 * 1024
          ? `${(sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB`
          : `${(sizeBytes / 1024 / 1024).toFixed(0)} MB`;
        const magnet = `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}${trStr}`;

        return {
          name,
          hash,
          size: sizeStr,
          size_bytes: sizeBytes,
          seeders,
          leechers,
          quality: detectQuality(name),
          source_type: detectSourceType(name),
          codec: detectCodec(name),
          origin: 'TPB',
          magnet,
          score: 0,
        } satisfies TorrentResult;
      }).filter((r: TorrentResult) => r.hash && r.hash.length >= 32);

      if (results.length > 0) {
        console.log(`[TPB] Found ${results.length} results via ${base}`);
        return results;
      }
    } catch (e) {
      console.warn(`[TPB] ${base} failed:`, (e as Error).message);
      continue;
    }
  }
  return [];
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query');
  const yearStr = searchParams.get('year');
  const quality = searchParams.get('quality');

  if (!query) {
    return NextResponse.json({ error: 'query parameter required' }, { status: 400 });
  }

  const year = yearStr ? parseInt(yearStr, 10) : undefined;

  // Build search query — include year for better matching
  const searchQuery = year ? `${query} ${year}` : query;

  try {
    // Search all indexers in parallel
    const [ytsResults, results1337x, tpbResults] = await Promise.allSettled([
      searchYTS(query, year),
      search1337x(searchQuery),
      searchTPB(searchQuery),
    ]);

    let all: TorrentResult[] = [
      ...(ytsResults.status === 'fulfilled' ? ytsResults.value : []),
      ...(results1337x.status === 'fulfilled' ? results1337x.value : []),
      ...(tpbResults.status === 'fulfilled' ? tpbResults.value : []),
    ];

    // Deduplicate by hash
    const seen = new Set<string>();
    all = all.filter(r => {
      const key = r.hash.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Filter out cam/TS rips and dead torrents
    all = all.filter(r => !isCamOrTS(r.name) && r.seeders > 0);

    // Score and sort
    all = all.map(r => ({ ...r, score: scoreResult(r, quality) }));
    all.sort((a, b) => b.score - a.score);

    // Limit to top 20
    all = all.slice(0, 20);

    return NextResponse.json({
      results: all,
      sources: {
        yts: ytsResults.status === 'fulfilled' ? ytsResults.value.length : 0,
        '1337x': results1337x.status === 'fulfilled' ? results1337x.value.length : 0,
        tpb: tpbResults.status === 'fulfilled' ? tpbResults.value.length : 0,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Search failed' }, { status: 500 });
  }
}