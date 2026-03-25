import { NextResponse } from 'next/server';

const TMDB_API_KEY = process.env.TMDB_API_KEY || '747181f999cba42aff585aac7b400066';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';

// Genre map for search results (which only return genre_ids)
const GENRE_MAP: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy',
  80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
  14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
  9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 10770: 'TV Movie',
  53: 'Thriller', 10752: 'War', 37: 'Western',
  // TV genres
  10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News',
  10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap',
  10767: 'Talk', 10768: 'War & Politics',
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query    = searchParams.get('query');
  const movieId  = searchParams.get('id');        // movie detail
  const tvId     = searchParams.get('tv_id');      // tv detail
  const seasonOf = searchParams.get('season_of');  // tv_id to get seasons
  const seasonNum = searchParams.get('season');    // season number (requires season_of)

  try {
    // ── Movie detail ──────────────────────────────────────────
    if (movieId) {
      const res = await fetch(
        `${TMDB_BASE}/movie/${movieId}?api_key=${TMDB_API_KEY}&language=en-US`,
      );
      if (!res.ok) return NextResponse.json({ error: 'TMDB API error' }, { status: res.status });
      const movie = await res.json();

      return NextResponse.json({
        movie: {
          tmdb_id: movie.id,
          title: movie.title,
          original_title: movie.original_title,
          overview: movie.overview,
          poster_url: movie.poster_path ? `${TMDB_IMG}/w500${movie.poster_path}` : null,
          poster_path: movie.poster_path,
          backdrop_url: movie.backdrop_path ? `${TMDB_IMG}/w1280${movie.backdrop_path}` : null,
          release_date: movie.release_date,
          year: movie.release_date ? new Date(movie.release_date).getFullYear() : null,
          rating: Math.round(movie.vote_average * 10) / 10,
          vote_count: movie.vote_count,
          genres: movie.genres?.map((g: any) => g.name) || [],
          runtime: movie.runtime,
          tagline: movie.tagline,
          imdb_id: movie.imdb_id,
          language: movie.original_language,
          media_type: 'movie',
        },
      });
    }

    // ── TV detail ─────────────────────────────────────────────
    if (tvId) {
      const res = await fetch(
        `${TMDB_BASE}/tv/${tvId}?api_key=${TMDB_API_KEY}&language=en-US`,
      );
      if (!res.ok) return NextResponse.json({ error: 'TMDB API error' }, { status: res.status });
      const tv = await res.json();

      // Also fetch external IDs for IMDB
      let imdb_id: string | null = null;
      try {
        const extRes = await fetch(
          `${TMDB_BASE}/tv/${tvId}/external_ids?api_key=${TMDB_API_KEY}`,
        );
        if (extRes.ok) {
          const ext = await extRes.json();
          imdb_id = ext.imdb_id || null;
        }
      } catch {}

      return NextResponse.json({
        tv: {
          tmdb_id: tv.id,
          title: tv.name,
          original_title: tv.original_name,
          overview: tv.overview,
          poster_url: tv.poster_path ? `${TMDB_IMG}/w500${tv.poster_path}` : null,
          poster_path: tv.poster_path,
          backdrop_url: tv.backdrop_path ? `${TMDB_IMG}/w1280${tv.backdrop_path}` : null,
          release_date: tv.first_air_date,
          year: tv.first_air_date ? new Date(tv.first_air_date).getFullYear() : null,
          rating: Math.round(tv.vote_average * 10) / 10,
          vote_count: tv.vote_count,
          genres: tv.genres?.map((g: any) => g.name) || [],
          tagline: tv.tagline || '',
          language: tv.original_language,
          media_type: 'tv',
          imdb_id,
          number_of_seasons: tv.number_of_seasons,
          number_of_episodes: tv.number_of_episodes,
          status: tv.status,
          seasons: (tv.seasons || [])
            .filter((s: any) => s.season_number > 0) // skip specials (season 0)
            .map((s: any) => ({
              season_number: s.season_number,
              name: s.name,
              episode_count: s.episode_count,
              air_date: s.air_date,
              poster_url: s.poster_path ? `${TMDB_IMG}/w342${s.poster_path}` : null,
            })),
        },
      });
    }

    // ── Season episodes ───────────────────────────────────────
    if (seasonOf && seasonNum) {
      const res = await fetch(
        `${TMDB_BASE}/tv/${seasonOf}/season/${seasonNum}?api_key=${TMDB_API_KEY}&language=en-US`,
      );
      if (!res.ok) return NextResponse.json({ error: 'TMDB API error' }, { status: res.status });
      const season = await res.json();

      return NextResponse.json({
        episodes: (season.episodes || []).map((ep: any) => ({
          episode_number: ep.episode_number,
          season_number: ep.season_number,
          name: ep.name,
          overview: ep.overview,
          air_date: ep.air_date,
          runtime: ep.runtime,
          still_url: ep.still_path ? `${TMDB_IMG}/w500${ep.still_path}` : null,
          rating: Math.round(ep.vote_average * 10) / 10,
          vote_count: ep.vote_count,
        })),
      });
    }

    // ── Search movies + TV in parallel ─────────────────────────
    if (!query) {
      return NextResponse.json({ error: 'query parameter required' }, { status: 400 });
    }

    const mapResult = (m: any, mediaType: 'movie' | 'tv') => {
      const isTV = mediaType === 'tv';
      return {
        tmdb_id: m.id,
        title: isTV ? m.name : m.title,
        original_title: isTV ? m.original_name : m.original_title,
        overview: m.overview,
        poster_url: m.poster_path ? `${TMDB_IMG}/w342${m.poster_path}` : null,
        poster_path: m.poster_path,
        release_date: isTV ? m.first_air_date : m.release_date,
        year: (isTV ? m.first_air_date : m.release_date)
          ? new Date(isTV ? m.first_air_date : m.release_date).getFullYear()
          : null,
        rating: Math.round(m.vote_average * 10) / 10,
        vote_count: m.vote_count,
        genres: (m.genre_ids || []).map((id: number) => GENRE_MAP[id]).filter(Boolean),
        language: m.original_language,
        media_type: mediaType,
      };
    };

    const encodedQuery = encodeURIComponent(query);
    const [movieRes, tvRes] = await Promise.allSettled([
      fetch(`${TMDB_BASE}/search/movie?api_key=${TMDB_API_KEY}&query=${encodedQuery}&language=en-US&page=1&include_adult=false`),
      fetch(`${TMDB_BASE}/search/tv?api_key=${TMDB_API_KEY}&query=${encodedQuery}&language=en-US&page=1`),
    ]);

    const results: any[] = [];

    if (movieRes.status === 'fulfilled' && movieRes.value.ok) {
      const data = await movieRes.value.json();
      console.log(`[tmdb] Movie search for "${query}": ${(data.results || []).length} results`);
      results.push(...(data.results || []).slice(0, 10).map((m: any) => mapResult(m, 'movie')));
    } else {
      console.warn(`[tmdb] Movie search failed:`, movieRes.status === 'rejected' ? movieRes.reason?.message : `HTTP ${movieRes.value?.status}`);
    }

    if (tvRes.status === 'fulfilled' && tvRes.value.ok) {
      const data = await tvRes.value.json();
      console.log(`[tmdb] TV search for "${query}": ${(data.results || []).length} results`);
      results.push(...(data.results || []).slice(0, 10).map((m: any) => mapResult(m, 'tv')));
    } else {
      console.warn(`[tmdb] TV search failed:`, tvRes.status === 'rejected' ? tvRes.reason?.message : `HTTP ${tvRes.value?.status}`);
    }

    // Sort by popularity (vote_count as proxy)
    results.sort((a, b) => b.vote_count - a.vote_count);

    return NextResponse.json({ results: results.slice(0, 15) });
  } catch (error: any) {
    console.error('[tmdb/search]', error.message);
    return NextResponse.json({ error: error.message || 'Failed to search TMDB' }, { status: 500 });
  }
}