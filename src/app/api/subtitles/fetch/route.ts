/**
 * POST /api/subtitles/fetch
 *
 * On-demand subtitle auto-download for an existing movie.
 * Sources (searched in order):
 *   1. subdl.com   — primary, largest database, free API key
 *   2. YIFY Subs   — great for YTS torrents, no key needed
 *
 * Release-name matching: When a movie has a blob_name from a torrent,
 * we extract keywords from it and score each subtitle's release_name
 * to find the best-synced match for the exact file.
 *
 * Body: {
 *   movie_id:   string
 *   imdb_id?:   string
 *   tmdb_id?:   number
 *   query?:     string    — movie title fallback
 *   languages:  string[]
 *   blob_name?: string    — for release-name matching
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateUploadSasUrl, generateReadSasUrl, CONTAINERS } from '@/lib/azure-blob';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const SUBDL_API_KEY = process.env.SUBDL_API_KEY || '';
const SUBDL_BASE    = 'https://api.subdl.com/api/v1/subtitles';

const SUBDL_LANG_MAP: Record<string, string> = {
  en: 'EN', ar: 'AR', fr: 'FR', es: 'ES', de: 'DE',
  it: 'IT', ja: 'JA', ko: 'KO', zh: 'ZH', pt: 'PT',
  ru: 'RU', tr: 'TR',
};
const LANG_LABELS: Record<string, string> = {
  en: 'English', ar: 'Arabic', fr: 'French', es: 'Spanish', de: 'German',
  it: 'Italian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', pt: 'Portuguese',
  ru: 'Russian', tr: 'Turkish',
};

// ── Release name matching ────────────────────────────────────────────────

/**
 * Extract meaningful keywords from a torrent/blob name for matching.
 * "userId/1234-Superman.2025.1080p.BluRay.x265-YAWNTiC.mkv"
 * → ["superman", "2025", "1080p", "bluray", "x265", "yawntic"]
 */
function extractReleaseKeywords(name: string): string[] {
  // Strip path prefix and extension
  const base = name.replace(/^.*\//, '').replace(/\.\w{2,4}$/, '');
  // Split on dots, dashes, underscores, spaces
  return base
    .split(/[.\-_\s]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 2);
}

/**
 * Score how well a subtitle's release_name matches our movie file.
 * Higher = better match.
 */
function scoreReleaseMatch(subRelease: string, movieKeywords: string[]): number {
  if (!subRelease || movieKeywords.length === 0) return 0;
  const subKeywords = extractReleaseKeywords(subRelease);
  let matches = 0;
  // Quality and codec keywords are worth more
  const importantWords = new Set(['480p', '720p', '1080p', '2160p', '4k',
    'bluray', 'blu-ray', 'webdl', 'web-dl', 'webrip', 'hdrip', 'dvdrip', 'remux',
    'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'av1',
    'yts', 'yify', 'rarbg', 'sparks', 'yawntic', 'neonoir']);
  for (const kw of movieKeywords) {
    if (subKeywords.includes(kw)) {
      matches += importantWords.has(kw) ? 3 : 1;
    }
  }
  return matches;
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function extractSrtFromZip(zipBuffer: ArrayBuffer): Promise<{ content: string; format: string } | null> {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(zipBuffer);
    const fileNames = Object.keys(zip.files);
    console.log(`[subs] Zip contains ${fileNames.length} files: ${fileNames.join(', ')}`);
    // Priority: .srt first, then .vtt, then .ass/.ssa
    for (const ext of ['.srt', '.vtt', '.ass', '.ssa']) {
      for (const [name, file] of Object.entries(zip.files)) {
        if (name.toLowerCase().endsWith(ext) && !file.dir) {
          // Try UTF-8 first, then raw bytes for re-decoding
          let content = await file.async('string');
          // If content looks garbled (common with non-UTF-8 ASS files), try uint8array
          if (content.includes('\uFFFD') || (ext === '.ass' && !content.includes('Dialogue'))) {
            console.log(`[subs] UTF-8 decode may have failed for ${name}, trying raw bytes...`);
            const bytes = await file.async('uint8array');
            // Try UTF-16LE (common for Arabic ASS files)
            const decoder16 = new TextDecoder('utf-16le');
            const attempt16 = decoder16.decode(bytes);
            if (attempt16.includes('Dialogue') || attempt16.includes('[Script')) {
              content = attempt16;
              console.log(`[subs] UTF-16LE decode worked for ${name}`);
            } else {
              // Try Windows-1256 (Arabic) via latin1 fallback
              const decoderLatin = new TextDecoder('iso-8859-1');
              const attemptLatin = decoderLatin.decode(bytes);
              if (attemptLatin.includes('Dialogue') || attemptLatin.includes('[Script')) {
                content = attemptLatin;
                console.log(`[subs] Latin-1 decode worked for ${name}`);
              }
            }
          }
          console.log(`[subs] Extracted ${name} (${content.length} chars, format=${ext})`);
          return { content, format: ext };
        }
      }
    }
    console.warn(`[subs] No subtitle file found in zip`);
  } catch (err) {
    console.warn('[subs] Zip extraction error:', (err as Error).message);
  }
  return null;
}

function srtToVtt(srt: string): string {
  return 'WEBVTT\n\n' + srt
    .replace(/\r\n/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
}

/**
 * Convert ASS/SSA subtitle format to VTT.
 * Handles various ASS quirks: BOM, different spacing, Comment lines, etc.
 */
function assToVtt(ass: string): string {
  // Strip BOM and normalize line endings
  const cleaned = ass.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = cleaned.split('\n');
  const cues: string[] = [];

  // Find the Format line in [Events] to know field positions
  let fieldOrder: string[] = [];
  let startIdx = -1;
  let endIdx = -1;
  let textIdx = -1;
  let inEvents = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase() === '[events]') {
      inEvents = true;
      continue;
    }
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      inEvents = false;
      continue;
    }
    if (inEvents && trimmed.toLowerCase().startsWith('format:')) {
      fieldOrder = trimmed.substring('format:'.length).split(',').map((f) => f.trim().toLowerCase());
      startIdx = fieldOrder.indexOf('start');
      endIdx = fieldOrder.indexOf('end');
      textIdx = fieldOrder.indexOf('text');
      console.log(`[subs] ASS Format fields: ${fieldOrder.join(',')} | start=${startIdx} end=${endIdx} text=${textIdx}`);
      break;
    }
  }

  // Default field positions if Format line not found
  if (startIdx === -1) startIdx = 1;
  if (endIdx === -1) endIdx = 2;
  if (textIdx === -1) textIdx = 9;

  for (const line of lines) {
    const trimmed = line.trim();
    // Match both "Dialogue:" and "Comment:" lines (some tools use Comment for visible text)
    if (!trimmed.match(/^(Dialogue|Comment)\s*:/i)) continue;

    const colonPos = trimmed.indexOf(':');
    if (colonPos === -1) continue;
    const afterColon = trimmed.substring(colonPos + 1);

    // Split by comma, but the text field (last) can contain commas
    const parts: string[] = [];
    let current = '';
    let fieldCount = 0;
    for (let i = 0; i < afterColon.length; i++) {
      if (afterColon[i] === ',' && fieldCount < textIdx) {
        parts.push(current);
        current = '';
        fieldCount++;
      } else {
        current += afterColon[i];
      }
    }
    parts.push(current); // push the last (text) field

    if (parts.length <= Math.max(startIdx, endIdx, textIdx)) continue;

    const start = parts[startIdx]?.trim();
    const end = parts[endIdx]?.trim();
    const text = parts[textIdx]?.trim()
      .replace(/\\N/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\{[^}]*\}/g, '') // strip ASS style tags
      .replace(/<[^>]*>/g, '')   // strip any HTML-like tags
      .trim();

    if (!start || !end || !text) continue;

    // Convert ASS timestamp (H:MM:SS.CC) to VTT (HH:MM:SS.MMM)
    const formatTime = (t: string) => {
      const match = t.match(/(\d+):(\d{2}):(\d{2})\.(\d{2,3})/);
      if (!match) return t;
      const h = match[1].padStart(2, '0');
      const m = match[2];
      const s = match[3];
      const ms = match[4].length === 2 ? match[4] + '0' : match[4];
      return `${h}:${m}:${s}.${ms}`;
    };

    cues.push(`${formatTime(start)} --> ${formatTime(end)}\n${text}`);
  }

  console.log(`[subs] ASS→VTT: converted ${cues.length} cues`);
  return 'WEBVTT\n\n' + cues.join('\n\n');
}

function convertToVtt(content: string, format: string): string {
  if (format === '.ass' || format === '.ssa') return assToVtt(content);
  if (format === '.vtt') return content; // already VTT
  return srtToVtt(content); // .srt default
}

async function uploadVtt(userId: string, lang: string, vttContent: string): Promise<string | null> {
  const blobName = `${userId}/${Date.now()}-auto-${lang}.vtt`;
  const uploadUrl = generateUploadSasUrl(CONTAINERS.subtitles || 'subtitles', blobName, 1);
  const readUrl   = generateReadSasUrl(CONTAINERS.subtitles || 'subtitles', blobName, 8760);
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'text/vtt' },
    body: vttContent,
  });
  return res.ok ? readUrl : null;
}

async function downloadAndUploadSub(
  downloadUrl: string,
  userId: string,
  lang: string,
  isZip: boolean,
): Promise<string | null> {
  const res = await fetch(downloadUrl, {
    headers: { 'User-Agent': 'CinemaForTwo v1.0' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    console.warn(`[subs] Download failed: ${res.status} ${res.statusText} for ${downloadUrl.slice(0, 80)}`);
    return null;
  }

  let subContent: string | null = null;
  let format = '.srt';

  if (isZip) {
    const buf = await res.arrayBuffer();
    console.log(`[subs] Downloaded zip for ${lang}: ${buf.byteLength} bytes`);
    const extracted = await extractSrtFromZip(buf);
    if (!extracted) {
      console.warn(`[subs] Failed to extract subtitle from zip for ${lang}`);
      return null;
    }
    subContent = extracted.content;
    format = extracted.format;
  } else {
    subContent = await res.text();
    // Detect format from content
    if (subContent.includes('[Script Info]') || subContent.includes('Dialogue:')) format = '.ass';
    else if (subContent.startsWith('WEBVTT')) format = '.vtt';
  }

  if (!subContent) {
    console.warn(`[subs] No content for ${lang}`);
    return null;
  }

  console.log(`[subs] Converting ${lang} subtitle (${subContent.length} chars, format=${format}) to vtt and uploading...`);
  const vttContent = convertToVtt(subContent, format);
  console.log(`[subs] VTT output preview (${vttContent.length} chars):\n${vttContent.slice(0, 300)}`);
  const readUrl = await uploadVtt(userId, lang, vttContent);
  if (!readUrl) {
    console.warn(`[subs] Azure upload failed for ${lang}`);
    return null;
  }
  console.log(`[subs] Successfully uploaded ${lang} subtitle`);
  return readUrl;
}

// ── Subtitle candidate from any source ───────────────────────────────────

interface SubCandidate {
  lang: string;
  release_name: string;
  download_url: string;
  is_zip: boolean;
  source: string;
  score: number; // release match score
}

// ── Source 1: subdl.com ──────────────────────────────────────────────────

async function searchSubdl(
  imdbId: string | null,
  tmdbId: number | null,
  query: string | null,
  languages: string[],
  movieKeywords: string[],
): Promise<SubCandidate[]> {
  if (!SUBDL_API_KEY) return [];

  const langCodes = languages.map((l) => SUBDL_LANG_MAP[l] || l.toUpperCase());
  const params = new URLSearchParams({
    api_key: SUBDL_API_KEY,
    type: 'movie',
    languages: langCodes.join(','),
    subs_per_page: '30',
  });
  if (imdbId) params.set('imdb_id', imdbId);
  else if (tmdbId) params.set('tmdb_id', String(tmdbId));
  else if (query) params.set('film_name', query);
  else return [];

  try {
    const res = await fetch(`${SUBDL_BASE}?${params}`, {
      headers: { 'User-Agent': 'CinemaForTwo v1.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const subs = data.subtitles || [];

    return subs
      .filter((s: any) => s.url)
      .map((s: any) => {
        const subLangCode = (s.language || '').toUpperCase();
        const lang = languages.find((l) => (SUBDL_LANG_MAP[l] || l.toUpperCase()) === subLangCode) || '';
        return {
          lang,
          release_name: s.release_name || '',
          download_url: `https://dl.subdl.com${s.url}`,
          is_zip: true,
          source: 'subdl',
          score: scoreReleaseMatch(s.release_name || '', movieKeywords),
        } as SubCandidate;
      })
      .filter((c: SubCandidate) => c.lang); // only candidates with a matched language
  } catch (err) {
    console.warn('[subs] subdl search failed:', (err as Error).message);
    return [];
  }
}

// ── Source 2: YIFY Subtitles ─────────────────────────────────────────────

async function searchYifySubs(
  imdbId: string | null,
  tmdbId: number | null,
  languages: string[],
  movieKeywords: string[],
): Promise<SubCandidate[]> {
  if (!imdbId) return []; // YIFY only supports IMDB ID

  // YIFY subs API: https://yts-subs.com/api/v1/movie-imdb/{imdb_id}
  const domains = ['yts-subs.com', 'yifysubtitles.ch'];

  for (const domain of domains) {
    try {
      const res = await fetch(`https://${domain}/api/v1/movie-imdb/${imdbId}`, {
        headers: { 'User-Agent': 'CinemaForTwo v1.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data.subs || typeof data.subs !== 'object') continue;

      const candidates: SubCandidate[] = [];
      // data.subs is { "tt1234567": { "en": [...], "ar": [...] } }
      const movieSubs = data.subs[imdbId] || data.subs[Object.keys(data.subs)[0]] || {};

      for (const lang of languages) {
        // YIFY uses full language names as keys
        const langLabel = (LANG_LABELS[lang] || lang).toLowerCase();
        const subList = movieSubs[langLabel] || movieSubs[lang] || [];

        for (const sub of subList) {
          if (!sub.url) continue;
          candidates.push({
            lang,
            release_name: sub.release || '',
            download_url: sub.url.startsWith('http') ? sub.url : `https://${domain}${sub.url}`,
            is_zip: sub.url.endsWith('.zip'),
            source: 'yify',
            score: scoreReleaseMatch(sub.release || '', movieKeywords),
          });
        }
      }

      if (candidates.length > 0) return candidates;
    } catch (err) {
      console.warn(`[subs] YIFY ${domain} failed:`, (err as Error).message);
    }
  }
  return [];
}

// ── POST handler ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Allow internal server-to-server calls with service key
    const serviceKey = req.headers.get('x-service-key');
    const isInternalCall = serviceKey === process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!isInternalCall) {
      const supabase = createServerSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { movie_id, imdb_id, tmdb_id, query, languages, blob_name } = body;

    if (!movie_id) return NextResponse.json({ error: 'movie_id required' }, { status: 400 });
    if (!languages?.length) return NextResponse.json({ error: 'languages required' }, { status: 400 });

    // Get current movie
    const { data: movie } = await supabaseAdmin
      .from('movies')
      .select('uploaded_by, subtitles, blob_name, title, imdb_id, tmdb_id, release_name, subtitle_options')
      .eq('id', movie_id)
      .single();
    if (!movie) return NextResponse.json({ error: 'Movie not found' }, { status: 404 });

    const existingSubtitles: { label: string; lang: string; url: string }[] = movie.subtitles || [];
    const existingOptions: Record<string, any> = movie.subtitle_options || {};

    const existingLangs = new Set(existingSubtitles.map((s: any) => s.lang));
    const needed = languages.filter((l: string) => !existingLangs.has(l));
    if (needed.length === 0) {
      return NextResponse.json({
        message: 'All requested languages already have subtitles',
        subtitles: existingSubtitles,
        subtitle_options: existingOptions,
      });
    }

    // Use best available identifiers
    const effectiveImdb = imdb_id || movie.imdb_id || null;
    const effectiveTmdb = tmdb_id || movie.tmdb_id || null;
    const effectiveQuery = query || movie.title || null;
    const effectiveBlobName = blob_name || movie.release_name || movie.blob_name || '';

    if (!effectiveImdb && !effectiveTmdb && !effectiveQuery) {
      return NextResponse.json({ error: 'No identifiers available to search subtitles' }, { status: 400 });
    }

    const movieKeywords = extractReleaseKeywords(effectiveBlobName);
    console.log(`[subs] Searching for ${needed.join(',')} | IMDB=${effectiveImdb} TMDB=${effectiveTmdb} | keywords=${movieKeywords.slice(0, 8).join(',')}`);

    // ── Gather candidates from all sources ──
    const [subdlResults, yifyResults] = await Promise.allSettled([
      searchSubdl(effectiveImdb, effectiveTmdb, effectiveQuery, needed, movieKeywords),
      searchYifySubs(effectiveImdb, effectiveTmdb, needed, movieKeywords),
    ]);

    const allCandidates: SubCandidate[] = [
      ...(subdlResults.status === 'fulfilled' ? subdlResults.value : []),
      ...(yifyResults.status === 'fulfilled' ? yifyResults.value : []),
    ];

    console.log(`[subs] Found ${allCandidates.length} candidates`);

    // ── Group and sort per language ──
    const candidatesPerLang = new Map<string, SubCandidate[]>();
    for (const c of allCandidates) {
      const list = candidatesPerLang.get(c.lang) || [];
      list.push(c);
      candidatesPerLang.set(c.lang, list);
    }
    for (const [, list] of candidatesPerLang) {
      list.sort((a, b) => b.score - a.score);
    }

    // ── For each language: store all candidates, download ONLY the #1 best ──
    const newSubtitles = [...existingSubtitles];
    const newOptions = { ...existingOptions };
    const downloaded: string[] = [];
    const failed: string[] = [];

    for (const lang of needed) {
      const candidates = candidatesPerLang.get(lang) || [];
      if (candidates.length === 0) { failed.push(lang); continue; }

      // Store candidate metadata (no download yet)
      const candidateMeta = candidates.slice(0, 10).map((c) => ({
        source_url: c.download_url,
        release_name: c.release_name,
        score: c.score,
        is_zip: c.is_zip,
        source: c.source,
      }));

      // Download only the first (best) candidate
      let downloadedFirst = false;
      for (const candidate of candidates.slice(0, 3)) { // try top 3 in case first fails
        try {
          console.log(`[subs] Downloading ${lang} #1 from ${candidate.source} (score=${candidate.score}, release=${candidate.release_name.slice(0, 60)})`);
          const readUrl = await downloadAndUploadSub(candidate.download_url, movie.uploaded_by, `${lang}-1`, candidate.is_zip);
          if (readUrl) {
            newSubtitles.push({ label: LANG_LABELS[lang] || lang, lang, url: readUrl });
            newOptions[lang] = {
              candidates: candidateMeta,
              downloaded: [{ url: readUrl, release_name: candidate.release_name }],
              active_index: 0,
            };
            downloaded.push(lang);
            downloadedFirst = true;
            console.log(`[subs] ${lang}: ${candidateMeta.length} candidates found, #1 downloaded and active`);
            break;
          }
        } catch (err) {
          console.warn(`[subs] Download failed for ${lang}:`, (err as Error).message);
        }
      }
      if (!downloadedFirst) failed.push(lang);
    }

    // ── Update movie ──
    if (downloaded.length > 0) {
      await supabaseAdmin.from('movies').update({
        subtitles: newSubtitles,
        subtitle_options: newOptions,
      }).eq('id', movie_id);
    }

    const noApiKey = !SUBDL_API_KEY;
    return NextResponse.json({
      downloaded,
      failed: [...new Set(failed)],
      subtitles: downloaded.length > 0 ? newSubtitles : existingSubtitles,
      subtitle_options: downloaded.length > 0 ? newOptions : existingOptions,
      no_api_key: noApiKey,
      message: noApiKey
        ? 'No SUBDL_API_KEY configured. Set it in your environment.'
        : downloaded.length > 0
          ? `Downloaded ${downloaded.map((l: string) => LANG_LABELS[l] || l).join(', ')} subtitles`
          : `No subtitles found for ${needed.map((l: string) => LANG_LABELS[l] || l).join(', ')}`,
    });
  } catch (err: any) {
    console.error('[subs/fetch]', err);
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 });
  }
}