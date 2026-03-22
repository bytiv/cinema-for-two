import { NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeFetch = require('node-fetch');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const HttpsProxyAgent = require('https-proxy-agent');

// ── Proxy-aware fetch ────────────────────────────────────────────────────────
// Phase 1 uses direct fetch(). If results are scarce, Phase 2 retries through
// free rotating proxies using node-fetch + https-proxy-agent (CJS, webpack-safe).

type FetchFn = (url: string, init?: any) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const directFetch: FetchFn = async (url, init = {}) => {
  const res = await fetch(url, init);
  return res;
};

function makeProxyFetch(proxyUrl: string): FetchFn {
  const agent = new HttpsProxyAgent(proxyUrl);
  return async (url: string, init: any = {}) => {
    const res = await nodeFetch(url, { ...init, agent, timeout: 10000 });
    return {
      ok: res.ok,
      status: res.status,
      text: () => res.text(),
    };
  };
}

// Cache free proxies for 10 minutes
let _proxyCache: string[] = [];
let _proxyCacheTime = 0;

async function getFreeProxies(): Promise<string[]> {
  if (_proxyCache.length > 0 && Date.now() - _proxyCacheTime < 600_000) return _proxyCache;

  const sources = [
    'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.json',
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
  ];
  const proxies: string[] = [];

  for (const src of sources) {
    try {
      const res = await fetch(src, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const text = await res.text();
      if (src.endsWith('.json')) {
        try {
          const data = JSON.parse(text);
          if (Array.isArray(data)) {
            for (const p of data.slice(0, 40)) {
              if (p.ip && p.port) proxies.push(`http://${p.ip}:${p.port}`);
            }
          }
        } catch {}
      } else {
        const lines = text.split('\n').filter((l: string) => l.trim().match(/^\d+\.\d+\.\d+\.\d+:\d+$/));
        for (const line of lines.slice(0, 40)) proxies.push(`http://${line.trim()}`);
      }
      if (proxies.length >= 15) break;
    } catch { continue; }
  }

  // Shuffle
  for (let i = proxies.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [proxies[i], proxies[j]] = [proxies[j], proxies[i]];
  }

  _proxyCache = proxies;
  _proxyCacheTime = Date.now();
  if (proxies.length > 0) console.log(`[proxy] Cached ${proxies.length} free proxies`);
  return proxies;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface TorrentResult {
  name: string;
  hash: string;
  size: string;
  size_bytes: number;
  seeders: number;
  leechers: number;
  quality: string | null;
  source_type: string | null;
  codec: string | null;
  origin: string;
  magnet: string;
  score: number;
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

function scoreResult(r: TorrentResult): number {
  let score = 0;
  score += Math.min(Math.log2(r.seeders + 1) * 15, 100);
  if (r.quality === '1080p') score += 30;
  else if (r.quality === '4K') score += 25;
  else if (r.quality === '720p') score += 20;
  if (r.source_type === 'BluRay') score += 20;
  else if (r.source_type === 'Remux') score += 18;
  else if (r.source_type === 'WEB-DL') score += 15;
  else if (r.source_type === 'WEBRip') score += 10;
  else if (r.source_type === 'HDRip') score += 5;
  if (r.codec === 'x265') score += 5;
  if (r.codec === 'x264') score += 3;
  if (r.size_bytes > 15 * 1024 * 1024 * 1024) score -= 10;
  if (r.size_bytes > 0 && r.size_bytes < 500 * 1024 * 1024) score -= 15;
  return Math.round(score);
}

// ── Scraper: YTS ─────────────────────────────────────────────────────────────

async function searchYTS(query: string, year?: number, fetchFn: FetchFn = directFetch): Promise<TorrentResult[]> {
  const domains = ['yts.lt', 'yts.mx', 'yts.am'];
  for (const domain of domains) {
    try {
      const params = new URLSearchParams({ query_term: query, limit: '20', sort_by: 'seeds' });
      const res = await fetchFn(`https://${domain}/api/v2/list_movies.json?${params}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (text.startsWith('<')) continue;
      const data = JSON.parse(text);
      const movies = data?.data?.movies;
      if (!Array.isArray(movies)) continue;
      const results: TorrentResult[] = [];
      for (const movie of movies) {
        if (year && movie.year && Math.abs(movie.year - year) > 1) continue;
        if (!Array.isArray(movie.torrents)) continue;
        for (const t of movie.torrents) {
          if (!t.hash) continue;
          const quality = t.quality || detectQuality(t.type || '');
          const trackers = [
            'udp://tracker.opentrackr.org:1337/announce',
            'udp://open.stealth.si:80/announce',
            'udp://tracker.torrent.eu.org:451/announce',
            'udp://exodus.desync.com:6969/announce',
          ];
          const magnet = `magnet:?xt=urn:btih:${t.hash}&dn=${encodeURIComponent(movie.title_long || movie.title)}&${trackers.map(tr => `tr=${encodeURIComponent(tr)}`).join('&')}`;
          results.push({
            name: `${movie.title_long || movie.title} [${quality || '?'}] [YTS]`,
            hash: t.hash, size: t.size || '?', size_bytes: parseSizeToBytes(t.size || '0'),
            seeders: t.seeds || 0, leechers: t.peers || 0, quality,
            source_type: t.type?.includes('bluray') ? 'BluRay' : (t.type?.includes('web') ? 'WEB-DL' : null),
            codec: detectCodec(t.type || ''), origin: 'YTS', magnet, score: 0,
          });
        }
      }
      if (results.length > 0) return results;
    } catch (e) {
      console.warn(`[YTS] ${domain} failed:`, (e as Error).message);
    }
  }
  return [];
}

// ── Scraper: 1337x ───────────────────────────────────────────────────────────

async function search1337x(query: string, fetchFn: FetchFn = directFetch): Promise<TorrentResult[]> {
  const domains = ['1337x.to', '1337x.st', '1337x.gd', '1337x.is'];
  for (const domain of domains) {
    try {
      const res = await fetchFn(`https://${domain}/search/${encodeURIComponent(query)}/1/`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (!html.includes('coll-1')) continue;
      const rowRegex = /<td class="coll-1 name">[\s\S]*?<a href="(\/torrent\/[^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<td class="coll-2[^"]*">([^<]+)<\/td>[\s\S]*?<td class="coll-4[^"]*">(\d+)<\/td>[\s\S]*?<td class="coll-5[^"]*">(\d+)<\/td>/g;
      const detailLinks: { url: string; name: string; size: string; seeders: number; leechers: number }[] = [];
      let match;
      while ((match = rowRegex.exec(html)) !== null && detailLinks.length < 8) {
        detailLinks.push({
          url: `https://${domain}${match[1]}`, name: match[2].trim(),
          size: match[3].trim(), seeders: parseInt(match[4]) || 0, leechers: parseInt(match[5]) || 0,
        });
      }
      if (detailLinks.length === 0) continue;
      const detailPromises = detailLinks.map(async (item) => {
        try {
          const detailRes = await fetchFn(item.url, {
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
    }
  }
  return [];
}

// ── Scraper: The Pirate Bay ──────────────────────────────────────────────────

async function searchTPB(query: string, fetchFn: FetchFn = directFetch): Promise<TorrentResult[]> {
  const apis = [
    { base: 'https://apibay.org', path: '/q.php' },
    { base: 'https://piratebay.live', path: '/q.php' },
    { base: 'https://tpb.party', path: '/q.php' },
    { base: 'https://thepiratebay.org', path: '/q.php' },
  ];
  for (const { base, path } of apis) {
    try {
      const url = `${base}${path}?q=${encodeURIComponent(query)}&cat=207`;
      const res = await fetchFn(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
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
        'udp://tracker.opentrackr.org:1337/announce', 'udp://open.stealth.si:80/announce',
        'udp://tracker.torrent.eu.org:451/announce', 'udp://exodus.desync.com:6969/announce',
        'udp://tracker.openbittorrent.com:6969/announce',
      ];
      const trStr = trackers.map(tr => `&tr=${encodeURIComponent(tr)}`).join('');
      const results = data.slice(0, 25).map((t: any) => {
        const hash = (t.info_hash || '').toUpperCase();
        const name = t.name || 'Unknown';
        const sizeBytes = parseInt(t.size) || 0;
        const sizeStr = sizeBytes > 1024 * 1024 * 1024
          ? `${(sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB`
          : `${(sizeBytes / 1024 / 1024).toFixed(0)} MB`;
        return {
          name, hash, size: sizeStr, size_bytes: sizeBytes,
          seeders: parseInt(t.seeders) || 0, leechers: parseInt(t.leechers) || 0,
          quality: detectQuality(name), source_type: detectSourceType(name),
          codec: detectCodec(name), origin: 'TPB',
          magnet: `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}${trStr}`, score: 0,
        } satisfies TorrentResult;
      }).filter((r: TorrentResult) => r.hash && r.hash.length >= 32);
      if (results.length > 0) {
        console.log(`[TPB] Found ${results.length} results via ${base}`);
        return results;
      }
    } catch (e) {
      console.warn(`[TPB] ${base} failed:`, (e as Error).message);
    }
  }
  return [];
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query');
  const yearStr = searchParams.get('year');

  if (!query) {
    return NextResponse.json({ error: 'query parameter required' }, { status: 400 });
  }

  const year = yearStr ? parseInt(yearStr, 10) : undefined;
  const queryWithYear = year ? `${query} ${year}` : query;

  try {
    const [ytsResults, results1337x, results1337xPlain, tpbResults, tpbResultsPlain] = await Promise.allSettled([
      searchYTS(query, year),
      search1337x(queryWithYear),
      year ? search1337x(query) : Promise.resolve([]),
      searchTPB(queryWithYear),
      year ? searchTPB(query) : Promise.resolve([]),
    ]);

    let all: TorrentResult[] = [
      ...(ytsResults.status === 'fulfilled' ? ytsResults.value : []),
      ...(results1337x.status === 'fulfilled' ? results1337x.value : []),
      ...(results1337xPlain.status === 'fulfilled' ? results1337xPlain.value : []),
      ...(tpbResults.status === 'fulfilled' ? tpbResults.value : []),
      ...(tpbResultsPlain.status === 'fulfilled' ? tpbResultsPlain.value : []),
    ];

    console.log(`[search] Direct: ${all.length} results`);

    // ═══ Phase 2: If few results, retry through free proxies ═══
    if (all.length < 5) {
      const proxies = await getFreeProxies();
      for (let i = 0; i < Math.min(3, proxies.length) && all.length < 10; i++) {
        try {
          const pFetch = makeProxyFetch(proxies[i]);
          const [pYts, pTpb] = await Promise.allSettled([
            searchYTS(query, year, pFetch),
            searchTPB(query, pFetch),
          ]);
          if (pYts.status === 'fulfilled') all.push(...pYts.value);
          if (pTpb.status === 'fulfilled') all.push(...pTpb.value);
          console.log(`[proxy] ${proxies[i]} → ${all.length} total`);
        } catch { continue; }
      }
    }

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

    // Score and sort — quality filtering happens client-side for instant switching
    all = all.map(r => ({ ...r, score: scoreResult(r) }));
    all.sort((a, b) => b.score - a.score);
    all = all.slice(0, 30);

    console.log(`[search] Returning ${all.length} results for "${query}"`);
    return NextResponse.json({ results: all });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Search failed' }, { status: 500 });
  }
}