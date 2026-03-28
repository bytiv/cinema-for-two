/**
 * GET /api/external/search
 *
 * Searches free video sources for a movie/show with smart relevance filtering.
 *
 * Query params:
 *   query           string — series/movie title
 *   year            string — release year
 *   season          string — season number for TV
 *   episode         string — episode number for TV
 *   episode_title   string — episode name from TMDB
 *   episode_overview string — episode description (keywords for matching)
 *   air_date        string — episode air date
 *   runtime         string — expected runtime in minutes
 *   media_type      string — 'movie' or 'tv'
 *   language        string — original language code (e.g. 'ja', 'en')
 *
 * Returns: { results: ExternalSource[] }
 */

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface ExternalSource {
  id: string;
  title: string;
  description: string | null;
  provider: string;
  providerIcon: string;
  url: string;
  embedUrl: string;
  videoUrl: string | null;
  type: 'embed' | 'direct';
  thumbnailUrl: string | null;
  year: string | null;
  duration: string | null;
  views: number | null;
  relevanceScore: number;
}

// ── Scoring helpers ──────────────────────────────────────────────────────────

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function titleSimilarity(query: string, resultTitle: string): number {
  const q = normalizeTitle(query);
  const r = normalizeTitle(resultTitle);
  if (q === r) return 100;
  if (r.includes(q)) return 85;
  if (q.includes(r) && r.length > 3) return 70;
  const qWords = new Set(q.split(' ').filter(w => w.length > 2));
  const rWords = new Set(r.split(' ').filter(w => w.length > 2));
  if (qWords.size === 0) return 0;
  let matchCount = 0;
  for (const w of qWords) { if (rWords.has(w)) matchCount++; }
  return Math.round((matchCount / qWords.size) * 65);
}

/** Check if result contains episode identifiers (S01E05, "episode 5", etc.) */
function episodeMatch(title: string, season?: number, episode?: number): number {
  if (!season && !episode) return 0;
  const t = title.toLowerCase();
  let score = 0;

  // Check for exact S##E## match
  if (season && episode) {
    const exactPat = new RegExp(`s0?${season}\\s*e0?${episode}\\b`, 'i');
    const longPat = new RegExp(`season\\s*${season}.*episode\\s*${episode}`, 'i');
    if (exactPat.test(t) || longPat.test(t)) return 30; // perfect match

    // Check if it mentions a DIFFERENT season or episode — heavy penalty
    const anySeasonMatch = t.match(/(?:s|season)\s*0?(\d+)/i);
    const anyEpisodeMatch = t.match(/(?:e|ep|episode)\s*0?(\d+)/i);

    if (anySeasonMatch) {
      const foundSeason = parseInt(anySeasonMatch[1]);
      if (foundSeason === season) {
        score += 10; // right season
      } else {
        score -= 40; // WRONG season — very bad
      }
    }

    if (anyEpisodeMatch) {
      const foundEpisode = parseInt(anyEpisodeMatch[1]);
      if (foundEpisode === episode) {
        score += 15; // right episode
      } else if (anySeasonMatch && parseInt(anySeasonMatch[1]) === season) {
        // Right season but wrong episode — moderate penalty
        score -= 25;
      } else {
        score -= 15; // wrong episode, unknown season
      }
    }

    // Also check "Season X Episode Y" in long form with numbers
    const longSeasonMatch = t.match(/season\s*(\d+)/i);
    const longEpisodeMatch = t.match(/episode\s*(\d+)/i);
    if (longSeasonMatch && !anySeasonMatch) {
      const fs = parseInt(longSeasonMatch[1]);
      if (fs === season) score += 10;
      else score -= 40;
    }
    if (longEpisodeMatch && !anyEpisodeMatch) {
      const fe = parseInt(longEpisodeMatch[1]);
      if (fe === episode) score += 15;
      else if (longSeasonMatch && parseInt(longSeasonMatch[1]) === season) score -= 25;
      else score -= 15;
    }
  }

  return score;
}

/** Score how well the episode title matches the result */
function episodeTitleScore(
  episodeTitle: string | undefined,
  resultTitle: string,
  resultDescription: string | null,
): number {
  if (!episodeTitle || episodeTitle.length < 3) return 0;
  let score = 0;

  // Check result title for episode title
  const etNorm = normalizeTitle(episodeTitle);
  const rtNorm = normalizeTitle(resultTitle);
  if (rtNorm.includes(etNorm)) score += 20;
  else {
    // Partial word overlap between episode title and result title
    const etWords = etNorm.split(' ').filter(w => w.length > 2);
    const rtWords = new Set(rtNorm.split(' '));
    const overlap = etWords.filter(w => rtWords.has(w)).length;
    if (etWords.length > 0 && overlap > 0) {
      score += Math.round((overlap / etWords.length) * 12);
    }
  }

  // Check result description for episode title keywords
  if (resultDescription) {
    const descNorm = normalizeTitle(resultDescription);
    if (descNorm.includes(etNorm)) score += 10;
  }

  return score;
}

/** Extract key nouns from overview and check if result mentions them */
function overviewKeywordScore(
  overview: string | undefined,
  resultTitle: string,
  resultDescription: string | null,
): number {
  if (!overview || overview.length < 20) return 0;

  // Extract somewhat unique words (4+ chars, not super common)
  const stopWords = new Set([
    'this', 'that', 'with', 'from', 'have', 'will', 'been', 'they', 'their',
    'when', 'what', 'which', 'about', 'into', 'after', 'before', 'while',
    'also', 'than', 'then', 'them', 'each', 'some', 'more', 'other',
    'where', 'there', 'here', 'does', 'very', 'just', 'most', 'only',
  ]);

  const overviewWords = normalizeTitle(overview)
    .split(' ')
    .filter(w => w.length >= 4 && !stopWords.has(w));
  if (overviewWords.length === 0) return 0;

  // Take the most distinctive words (longer = more distinctive)
  const keywords = [...new Set(overviewWords)]
    .sort((a, b) => b.length - a.length)
    .slice(0, 8);

  const target = normalizeTitle(`${resultTitle} ${resultDescription || ''}`);
  const matches = keywords.filter(kw => target.includes(kw)).length;

  if (matches >= 3) return 10;
  if (matches >= 2) return 6;
  if (matches >= 1) return 3;
  return 0;
}

function penalizeJunk(title: string, query: string, year?: string): number {
  const t = title.toLowerCase();
  let penalty = 0;
  if (/\b(trailer|teaser|clip|behind the scenes|review|reaction|making of|interview|featurette|promo)\b/i.test(t)) penalty += 40;
  if (/\b(compilation|top\s*\d+|best of|worst of|ranking|countdown)\b/i.test(t)) penalty += 35;
  if (year) {
    const resultYear = t.match(/\b(19|20)\d{2}\b/);
    if (resultYear && resultYear[0] !== year) penalty += 20;
  }
  if (normalizeTitle(title).length < 4) penalty += 25;
  return penalty;
}

function durationScore(expectedMins: number | undefined, actualSeconds: number | null): number {
  if (!expectedMins || !actualSeconds) return 0;
  const actualMins = actualSeconds / 60;
  const diff = Math.abs(actualMins - expectedMins);
  const ratio = actualMins / expectedMins;
  if (diff <= 5) return 25;
  if (diff <= 15) return 15;
  if (diff <= 30) return 5;
  if (ratio < 0.3) return -50;
  if (ratio < 0.5) return -35;
  if (ratio < 0.7) return -15;
  if (ratio > 2.5) return -20;
  if (ratio > 1.5) return -5;
  return 0;
}

/** Compute the full relevance score for a result */
function computeScore(
  resultTitle: string,
  resultDescription: string | null,
  resultDurationSec: number | null,
  opts: {
    query: string;
    year?: string;
    season?: number;
    episode?: number;
    episodeTitle?: string;
    episodeOverview?: string;
    expectedRuntime?: number;
  },
): number {
  let score = titleSimilarity(opts.query, resultTitle);
  score += episodeMatch(resultTitle, opts.season, opts.episode);
  score -= penalizeJunk(resultTitle, opts.query, opts.year);
  score += episodeTitleScore(opts.episodeTitle, resultTitle, resultDescription);
  score += overviewKeywordScore(opts.episodeOverview, resultTitle, resultDescription);
  score += durationScore(opts.expectedRuntime, resultDurationSec);
  return Math.max(0, Math.min(100, score));
}

// ── Internet Archive search ──────────────────────────────────────────────────

async function searchInternetArchive(
  opts: {
    query: string; year?: string; season?: number; episode?: number;
    episodeTitle?: string; episodeOverview?: string; expectedRuntime?: number;
  },
): Promise<ExternalSource[]> {
  try {
    // Build multiple search queries for better coverage
    const queries: string[] = [];

    // Query 1: series name + "Season X Episode Y" (human-readable)
    if (opts.season && opts.episode) {
      queries.push(`"${opts.query}" "season ${opts.season}" "episode ${opts.episode}" mediatype:movies`);
    }

    // Query 2: series name + S01E05 pattern
    if (opts.season && opts.episode) {
      queries.push(`"${opts.query}" S${String(opts.season).padStart(2, '0')}E${String(opts.episode).padStart(2, '0')} mediatype:movies`);
    }

    // Query 3: series name + episode title
    if (opts.episodeTitle && opts.episodeTitle.length > 2) {
      queries.push(`"${opts.query}" "${opts.episodeTitle}" mediatype:movies`);
    }

    // Query 4: broad series name search (fallback)
    let broadQuery = `"${opts.query}" mediatype:movies`;
    if (opts.year) broadQuery += ` year:${opts.year}`;
    if (opts.season) broadQuery += ` (season OR S${String(opts.season).padStart(2, '0')})`;
    queries.push(broadQuery);

    // Deduplicate results across queries
    const seen = new Set<string>();
    const allResults: ExternalSource[] = [];

    for (const searchQuery of queries) {
      const params = new URLSearchParams({
        q: searchQuery,
        output: 'json',
        rows: '10',
        fl: 'identifier,title,description,year,downloads,item_size',
        sort: 'downloads desc',
      });

      try {
        const res = await fetch(`https://archive.org/advancedsearch.php?${params.toString()}`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const data = await res.json();
        const docs = data?.response?.docs || [];

        for (const doc of docs) {
          if (!doc.identifier || !doc.title || seen.has(doc.identifier)) continue;
          seen.add(doc.identifier);

          const title = doc.title;
          let score = computeScore(title, doc.description ? (typeof doc.description === 'string' ? doc.description : doc.description[0]) : null, null, opts);

          // IA size heuristic
          if (opts.expectedRuntime && doc.item_size) {
            const sizeMB = Number(doc.item_size) / (1024 * 1024);
            const minMB = opts.expectedRuntime * 2;
            const maxMB = opts.expectedRuntime * 50;
            if (sizeMB < minMB && sizeMB > 0) score -= 30;
            else if (sizeMB > maxMB) score -= 10;
            else if (sizeMB >= minMB * 3 && sizeMB <= maxMB * 0.5) score += 10;
          }

          allResults.push({
            id: `ia-${doc.identifier}`,
            title,
            description: doc.description
              ? (typeof doc.description === 'string' ? doc.description : doc.description[0])?.slice(0, 200) || null
              : null,
            provider: 'archive.org',
            providerIcon: '🏛️',
            url: `https://archive.org/details/${doc.identifier}`,
            embedUrl: `https://archive.org/embed/${doc.identifier}`,
            videoUrl: null,
            type: 'embed' as const,
            thumbnailUrl: `https://archive.org/services/img/${doc.identifier}`,
            year: doc.year ? String(doc.year) : null,
            duration: null,
            views: doc.downloads ? Number(doc.downloads) : null,
            relevanceScore: Math.max(0, Math.min(100, score)),
          });
        }
      } catch {}
    }

    return allResults;
  } catch (err) {
    console.error('[external/search] IA error:', err);
    return [];
  }
}

// ── Dailymotion search ───────────────────────────────────────────────────────

async function searchDailymotion(
  opts: {
    query: string; year?: string; season?: number; episode?: number;
    episodeTitle?: string; episodeOverview?: string; expectedRuntime?: number;
    language?: string;
  },
): Promise<ExternalSource[]> {
  try {
    // Build multiple search strings for better coverage
    const searchStrings: string[] = [];

    // Strategy 1: series name + "Season X Episode Y" (most common on Dailymotion)
    if (opts.season && opts.episode) {
      searchStrings.push(`${opts.query} Season ${opts.season} Episode ${opts.episode}`);
    }

    // Strategy 2: series name + S01E05 code
    if (opts.season && opts.episode) {
      searchStrings.push(`${opts.query} S${String(opts.season).padStart(2, '0')}E${String(opts.episode).padStart(2, '0')}`);
    }

    // Strategy 3: series name + episode title (useful when titles are distinctive)
    if (opts.episodeTitle && opts.episodeTitle.length > 2) {
      searchStrings.push(`${opts.query} ${opts.episodeTitle}`);
    }

    // Strategy 4: just the series/movie name (broad fallback for movies or if no episode info)
    if (searchStrings.length === 0) {
      searchStrings.push(opts.query);
    }

    // Minimum duration filter
    let minDurationFilter = '10';
    if (opts.expectedRuntime) {
      minDurationFilter = String(Math.max(5, Math.floor(opts.expectedRuntime * 0.5)));
    }

    const seen = new Set<string>();
    const allResults: ExternalSource[] = [];

    for (const searchStr of searchStrings) {
      const params = new URLSearchParams({
        search: searchStr,
        fields: 'id,title,description,duration,views_total,thumbnail_240_url,created_time',
        limit: '10',
        sort: 'relevance',
        longer_than: minDurationFilter,
      });

      // Add language filter if available (Dailymotion supports language param)
      if (opts.language) {
        params.set('language', opts.language);
      }

      try {
        const res = await fetch(`https://api.dailymotion.com/videos?${params.toString()}`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const data = await res.json();
        const videos = data?.list || [];

        for (const v of videos) {
          if (seen.has(v.id)) continue;
          seen.add(v.id);

          const title = v.title || 'Untitled';
          const mins = v.duration ? Math.floor(v.duration / 60) : null;
          const desc = v.description?.slice(0, 200) || null;

          let score = computeScore(title, desc, v.duration || null, opts);

          // Fallback duration bonus if no expected runtime
          if (!opts.expectedRuntime) {
            if (v.duration && v.duration > 2400) score += 10;
            if (v.duration && v.duration > 4800) score += 5;
          }

          allResults.push({
            id: `dm-${v.id}`,
            title,
            description: desc,
            provider: 'dailymotion',
            providerIcon: '▶️',
            url: `https://www.dailymotion.com/video/${v.id}`,
            embedUrl: `https://www.dailymotion.com/embed/video/${v.id}`,
            videoUrl: null,
            type: 'embed' as const,
            thumbnailUrl: v.thumbnail_240_url || null,
            year: v.created_time ? new Date(v.created_time * 1000).getFullYear().toString() : null,
            duration: mins ? `${mins}m` : null,
            views: v.views_total || null,
            relevanceScore: Math.max(0, Math.min(100, score)),
          });
        }
      } catch {}
    }

    return allResults;
  } catch (err) {
    console.error('[external/search] DM error:', err);
    return [];
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const query           = searchParams.get('query');
    const year            = searchParams.get('year') || undefined;
    const season          = searchParams.get('season') ? parseInt(searchParams.get('season')!) : undefined;
    const episode         = searchParams.get('episode') ? parseInt(searchParams.get('episode')!) : undefined;
    const episodeTitle    = searchParams.get('episode_title') || undefined;
    const episodeOverview = searchParams.get('episode_overview') || undefined;
    const expectedRuntime = searchParams.get('runtime') ? parseInt(searchParams.get('runtime')!) : undefined;
    const language        = searchParams.get('language') || undefined;

    if (!query?.trim()) return NextResponse.json({ error: 'query parameter required' }, { status: 400 });

    const opts = {
      query: query.trim(),
      year,
      season,
      episode,
      episodeTitle,
      episodeOverview,
      expectedRuntime,
      language,
    };

    const [iaResults, dmResults] = await Promise.allSettled([
      searchInternetArchive(opts),
      searchDailymotion(opts),
    ]);

    let results: ExternalSource[] = [];
    if (iaResults.status === 'fulfilled') results.push(...iaResults.value);
    if (dmResults.status === 'fulfilled') results.push(...dmResults.value);

    // Sort by relevance, then views as tiebreaker
    results.sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
      return (b.views || 0) - (a.views || 0);
    });

    // Filter out very low relevance
    const MIN_RELEVANCE = 15;
    results = results.filter(r => r.relevanceScore >= MIN_RELEVANCE);

    // Deduplicate by URL
    const seenUrls = new Set<string>();
    results = results.filter(r => {
      if (seenUrls.has(r.url)) return false;
      seenUrls.add(r.url);
      return true;
    });

    return NextResponse.json({ results: results.slice(0, 15) });
  } catch (err: any) {
    console.error('[external/search]', err.message);
    return NextResponse.json({ error: err.message || 'Search failed' }, { status: 500 });
  }
}