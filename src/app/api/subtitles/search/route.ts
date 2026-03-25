/**
 * GET /api/subtitles/search
 *
 * Searches for subtitles by IMDB ID and language codes.
 * Primary: subdl.com (free API key from subdl.com/plugins)
 * Fallback: OpenSubtitles (if OPENSUBTITLES_API_KEY is set)
 *
 * Query params:
 *   imdb_id:    string  — IMDB ID (e.g. "tt0347149")
 *   languages:  string  — comma-separated language codes (e.g. "en,ar")
 *   tmdb_id?:   string  — fallback identifier
 *   query?:     string  — fallback: movie title for text search
 */

import { NextRequest, NextResponse } from 'next/server';

// subdl.com — get a free key at https://subdl.com/plugins
const SUBDL_API_KEY = process.env.SUBDL_API_KEY || '';
const SUBDL_BASE   = 'https://api.subdl.com/api/v1/subtitles';

// OpenSubtitles — optional fallback
const OS_API_KEY = process.env.OPENSUBTITLES_API_KEY || '';
const OS_BASE    = 'https://api.opensubtitles.com/api/v1';

// ── Language code mapping ─────────────────────────────────────────────────

const LANG_LABELS: Record<string, string> = {
  en: 'English', ar: 'Arabic', fr: 'French', es: 'Spanish', de: 'German',
  it: 'Italian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', pt: 'Portuguese',
  ru: 'Russian', tr: 'Turkish',
};

// subdl uses 2-letter codes in uppercase
const SUBDL_LANG_MAP: Record<string, string> = {
  en: 'EN', ar: 'AR', fr: 'FR', es: 'ES', de: 'DE',
  it: 'IT', ja: 'JA', ko: 'KO', zh: 'ZH', pt: 'PT',
  ru: 'RU', tr: 'TR',
};

// OpenSubtitles uses lowercase codes
const OS_LANG_MAP: Record<string, string> = {
  en: 'en', ar: 'ar', fr: 'fr', es: 'es', de: 'de',
  it: 'it', ja: 'ja', ko: 'ko', zh: 'zh-cn', pt: 'pt-pt',
  ru: 'ru', tr: 'tr',
};

interface SubtitleMatch {
  file_name: string;
  language: string;
  lang_code: string;
  download_count: number;
  hearing_impaired: boolean;
  ai_translated: boolean;
  release: string;
  source: 'subdl' | 'opensubtitles';
  // subdl-specific
  subdl_url?: string;        // path to append to dl.subdl.com
  // opensubtitles-specific
  os_file_id?: number;
}

// ── Search subdl.com (primary) ────────────────────────────────────────────

async function searchSubdl(
  imdbId: string | null,
  tmdbId: string | null,
  query: string | null,
  languages: string[],
): Promise<SubtitleMatch[]> {
  if (!SUBDL_API_KEY) {
    console.warn('[subtitles] No SUBDL_API_KEY set — skipping subdl search');
    return [];
  }

  const results: SubtitleMatch[] = [];

  const params = new URLSearchParams({
    api_key: SUBDL_API_KEY,
    subs_per_page: '30',
    type: 'movie',
  });

  if (imdbId) {
    params.set('imdb_id', imdbId);
  } else if (tmdbId) {
    params.set('tmdb_id', tmdbId);
  } else if (query) {
    params.set('film_name', query);
  } else {
    return [];
  }

  // subdl accepts comma-separated uppercase language codes
  const langCodes = languages.map((l) => SUBDL_LANG_MAP[l] || l.toUpperCase());
  params.set('languages', langCodes.join(','));

  try {
    const res = await fetch(`${SUBDL_BASE}?${params}`, {
      headers: { 'User-Agent': 'CinemaForTwo v1.0' },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      console.warn(`[subtitles] subdl returned ${res.status}`);
      return [];
    }

    const data = await res.json();
    if (!data.subtitles || !Array.isArray(data.subtitles)) return [];

    for (const sub of data.subtitles) {
      // subdl returns sub.language as 2-letter code ("EN","AR") and sub.lang as full name ("English","Arabic")
      const subLangCode = (sub.language || '').toUpperCase();
      const langCode = languages.find(
        (l) => (SUBDL_LANG_MAP[l] || l.toUpperCase()) === subLangCode,
      ) || 'en';

      results.push({
        file_name: sub.release_name || sub.name || `subtitle.${langCode}.srt`,
        language: LANG_LABELS[langCode] || sub.language || langCode,
        lang_code: langCode,
        download_count: sub.download_count || 0,
        hearing_impaired: sub.hi === true || sub.hearing_impaired === true,
        ai_translated: false,
        release: sub.release_name || '',
        source: 'subdl',
        subdl_url: sub.url || undefined,
      });
    }
  } catch (err) {
    console.warn('[subtitles] subdl error:', (err as Error).message);
  }

  return results;
}

// ── Search OpenSubtitles (fallback) ───────────────────────────────────────

async function searchOpenSubtitles(
  imdbId: string | null,
  tmdbId: string | null,
  query: string | null,
  languages: string[],
): Promise<SubtitleMatch[]> {
  if (!OS_API_KEY) return [];

  const results: SubtitleMatch[] = [];

  for (const lang of languages) {
    const osLang = OS_LANG_MAP[lang] || lang;
    const params = new URLSearchParams({ languages: osLang });

    if (imdbId) {
      params.set('imdb_id', imdbId.replace(/^tt/, ''));
    } else if (tmdbId) {
      params.set('tmdb_id', tmdbId);
    } else if (query) {
      params.set('query', query);
    } else {
      continue;
    }

    try {
      const res = await fetch(`${OS_BASE}/subtitles?${params}`, {
        headers: {
          'Api-Key': OS_API_KEY,
          'User-Agent': 'CinemaForTwo v1.0',
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) continue;
      const data = await res.json();

      for (const item of (data.data || []).slice(0, 5)) {
        const attrs = item.attributes;
        if (attrs.ai_translated || attrs.foreign_parts_only) continue;
        for (const file of attrs.files || []) {
          results.push({
            file_name: file.file_name || `subtitle.${lang}.srt`,
            language: LANG_LABELS[lang] || lang,
            lang_code: lang,
            download_count: attrs.download_count || 0,
            hearing_impaired: attrs.hearing_impaired || false,
            ai_translated: false,
            release: attrs.release || '',
            source: 'opensubtitles',
            os_file_id: file.file_id,
          });
        }
      }
    } catch (err) {
      console.warn(`[subtitles] OS search failed for ${lang}:`, (err as Error).message);
    }
  }

  return results;
}

// ── GET handler ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const imdbId    = searchParams.get('imdb_id');
  const tmdbId    = searchParams.get('tmdb_id');
  const query     = searchParams.get('query');
  const languages = (searchParams.get('languages') || 'en').split(',').filter(Boolean);

  if (!imdbId && !tmdbId && !query) {
    return NextResponse.json({ error: 'imdb_id, tmdb_id, or query required' }, { status: 400 });
  }

  try {
    // Primary: subdl.com
    let results = await searchSubdl(imdbId, tmdbId, query, languages);

    // Fallback: OpenSubtitles
    if (results.length === 0) {
      results = await searchOpenSubtitles(imdbId, tmdbId, query, languages);
    }

    // Sort: by download count desc
    results.sort((a, b) => b.download_count - a.download_count);

    // Dedupe: keep best per language
    const bestPerLang = new Map<string, SubtitleMatch>();
    for (const r of results) {
      if (!bestPerLang.has(r.lang_code)) {
        bestPerLang.set(r.lang_code, r);
      }
    }

    return NextResponse.json({
      results,
      best: Object.fromEntries(bestPerLang),
    });
  } catch (err: any) {
    console.error('[subtitles/search]', err);
    return NextResponse.json({ error: err.message || 'Search failed' }, { status: 500 });
  }
}