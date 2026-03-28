/**
 * GET /api/external/search
 *
 * Searches free video sources for a movie/show with smart relevance filtering.
 *
 * Query params:
 *   query       string — movie/show title
 *   year        string — release year (optional, strongly recommended)
 *   season      string — season number for TV (optional)
 *   episode     string — episode number for TV (optional)
 *   episode_title string — episode title for TV (optional)
 *   media_type  string — 'movie' or 'tv' (optional, helps filtering)
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
  relevanceScore: number;     // 0-100, higher = more relevant
}

// ── Title similarity scoring ─────────────────────────────────────────────────

function normalizeTitle(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Score 0-100 how well a result title matches the query */
function titleSimilarity(query: string, resultTitle: string): number {
  const q = normalizeTitle(query);
  const r = normalizeTitle(resultTitle);

  // Exact match
  if (q === r) return 100;

  // Result contains query exactly
  if (r.includes(q)) return 85;

  // Query contains result (result is a substring)
  if (q.includes(r) && r.length > 3) return 70;

  // Word overlap scoring
  const qWords = new Set(q.split(' ').filter(w => w.length > 2));
  const rWords = new Set(r.split(' ').filter(w => w.length > 2));
  if (qWords.size === 0) return 0;

  let matchCount = 0;
  for (const w of qWords) {
    if (rWords.has(w)) matchCount++;
  }

  const overlapRatio = matchCount / qWords.size;
  return Math.round(overlapRatio * 65);
}

/** Check if result looks like it contains the right episode */
function episodeMatch(title: string, season?: number, episode?: number): number {
  if (!season && !episode) return 0;
  const t = title.toLowerCase();

  let bonus = 0;

  // Look for S01E05 pattern
  if (season && episode) {
    const sePat = new RegExp(`s0?${season}\\s*e0?${episode}\\b`, 'i');
    if (sePat.test(t)) return 30;

    // Also check "season 1 episode 5"
    const longPat = new RegExp(`season\\s*${season}.*episode\\s*${episode}`, 'i');
    if (longPat.test(t)) return 25;

    // Check just episode number at end like "- 05" or "ep 5"
    const epPat = new RegExp(`(?:ep|episode|e)\\s*0?${episode}\\b`, 'i');
    if (epPat.test(t)) bonus += 15;

    // Season match without episode
    const sPat = new RegExp(`(?:s|season)\\s*0?${season}\\b`, 'i');
    if (sPat.test(t)) bonus += 10;
  }

  return bonus;
}

/** Penalty for results that are clearly wrong */
function penalizeJunk(title: string, query: string, year?: string): number {
  const t = title.toLowerCase();
  let penalty = 0;

  // Trailer, clip, behind the scenes, review, reaction
  if (/\b(trailer|teaser|clip|behind the scenes|review|reaction|making of|interview|featurette|promo)\b/i.test(t)) penalty += 40;

  // Compilation, top 10, best of
  if (/\b(compilation|top\s*\d+|best of|worst of|ranking|countdown)\b/i.test(t)) penalty += 35;

  // Different year (if we know the year)
  if (year) {
    const resultYear = t.match(/\b(19|20)\d{2}\b/);
    if (resultYear && resultYear[0] !== year) penalty += 20;
  }

  // Very short titles that are likely generic
  if (normalizeTitle(title).length < 4) penalty += 25;

  return penalty;
}

// ── Internet Archive search ──────────────────────────────────────────────────

async function searchInternetArchive(
  query: string, year?: string, season?: number, episode?: number, episodeTitle?: string,
): Promise<ExternalSource[]> {
  try {
    // Build a more targeted search query
    let searchQuery = `"${query}" mediatype:movies`;
    if (year) searchQuery += ` year:${year}`;
    if (season && episode) {
      // Try adding episode info to narrow results
      searchQuery += ` (S${String(season).padStart(2,'0')}E${String(episode).padStart(2,'0')} OR "season ${season}" OR "episode ${episode}")`;
    }

    const params = new URLSearchParams({
      q: searchQuery,
      output: 'json',
      rows: '20',
      fl: 'identifier,title,description,year,downloads,item_size',
      sort: 'downloads desc',
    });

    const res = await fetch(`https://archive.org/advancedsearch.php?${params.toString()}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = await res.json();
    const docs = data?.response?.docs || [];

    return docs
      .filter((doc: any) => doc.identifier && doc.title)
      .map((doc: any) => {
        const title = doc.title;
        let score = titleSimilarity(query, title);
        score += episodeMatch(title, season, episode);
        score -= penalizeJunk(title, query, year);
        if (episodeTitle) score += titleSimilarity(episodeTitle, title) * 0.3;

        return {
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
        };
      });
  } catch (err) {
    console.error('[external/search] IA error:', err);
    return [];
  }
}

// ── Dailymotion search ───────────────────────────────────────────────────────

async function searchDailymotion(
  query: string, year?: string, season?: number, episode?: number, episodeTitle?: string,
): Promise<ExternalSource[]> {
  try {
    // Build episode-aware search query
    let searchStr = query;
    if (season && episode) {
      searchStr += ` S${String(season).padStart(2,'0')}E${String(episode).padStart(2,'0')}`;
    }

    const params = new URLSearchParams({
      search: searchStr,
      fields: 'id,title,description,duration,views_total,thumbnail_240_url,created_time',
      limit: '15',
      sort: 'relevance',
      longer_than: '10',   // filter out very short clips
    });

    const res = await fetch(`https://api.dailymotion.com/videos?${params.toString()}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    const videos = data?.list || [];

    return videos.map((v: any) => {
      const mins = v.duration ? Math.floor(v.duration / 60) : null;
      const title = v.title || 'Untitled';

      let score = titleSimilarity(query, title);
      score += episodeMatch(title, season, episode);
      score -= penalizeJunk(title, query, year);
      if (episodeTitle) score += titleSimilarity(episodeTitle, title) * 0.3;

      // Bonus for longer videos (more likely to be full episodes/movies)
      if (v.duration && v.duration > 2400) score += 10; // > 40min
      if (v.duration && v.duration > 4800) score += 5;  // > 80min

      return {
        id: `dm-${v.id}`,
        title,
        description: v.description?.slice(0, 200) || null,
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
      };
    });
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
    const query        = searchParams.get('query');
    const year         = searchParams.get('year') || undefined;
    const season       = searchParams.get('season') ? parseInt(searchParams.get('season')!) : undefined;
    const episode      = searchParams.get('episode') ? parseInt(searchParams.get('episode')!) : undefined;
    const episodeTitle = searchParams.get('episode_title') || undefined;

    if (!query?.trim()) return NextResponse.json({ error: 'query parameter required' }, { status: 400 });

    const [iaResults, dmResults] = await Promise.allSettled([
      searchInternetArchive(query.trim(), year, season, episode, episodeTitle),
      searchDailymotion(query.trim(), year, season, episode, episodeTitle),
    ]);

    let results: ExternalSource[] = [];
    if (iaResults.status === 'fulfilled') results.push(...iaResults.value);
    if (dmResults.status === 'fulfilled') results.push(...dmResults.value);

    // Sort by relevance score (descending), then by views as tiebreaker
    results.sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
      return (b.views || 0) - (a.views || 0);
    });

    // Filter out very low relevance results (likely unrelated)
    const MIN_RELEVANCE = 20;
    results = results.filter(r => r.relevanceScore >= MIN_RELEVANCE);

    return NextResponse.json({ results: results.slice(0, 15) });
  } catch (err: any) {
    console.error('[external/search]', err.message);
    return NextResponse.json({ error: err.message || 'Search failed' }, { status: 500 });
  }
}