import { NextResponse } from 'next/server';

const TMDB_API_KEY = process.env.TMDB_API_KEY || '747181f999cba42aff585aac7b400066';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';

export interface TMDBMovie {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  vote_count: number;
  genre_ids: number[];
  popularity: number;
  original_language: string;
}

export interface TMDBMovieDetail {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  vote_count: number;
  genres: { id: number; name: string }[];
  runtime: number | null;
  tagline: string;
  status: string;
  imdb_id: string | null;
  original_language: string;
}

// Genre map for search results (which only return genre_ids)
const GENRE_MAP: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy',
  80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
  14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
  9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 10770: 'TV Movie',
  53: 'Thriller', 10752: 'War', 37: 'Western',
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query');
  const movieId = searchParams.get('id');

  if (!query && !movieId) {
    return NextResponse.json({ error: 'query or id parameter required' }, { status: 400 });
  }

  try {
    // If movieId is provided, fetch full details for a single movie
    if (movieId) {
      const res = await fetch(
        `${TMDB_BASE}/movie/${movieId}?api_key=${TMDB_API_KEY}&language=en-US`,
        { next: { revalidate: 3600 } },
      );

      if (!res.ok) {
        return NextResponse.json({ error: 'TMDB API error' }, { status: res.status });
      }

      const movie: TMDBMovieDetail = await res.json();

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
          genres: movie.genres.map((g) => g.name),
          runtime: movie.runtime, // in minutes
          tagline: movie.tagline,
          imdb_id: movie.imdb_id,
          language: movie.original_language,
        },
      });
    }

    // Search movies
    const res = await fetch(
      `${TMDB_BASE}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query!)}&language=en-US&page=1&include_adult=false`,
      { next: { revalidate: 600 } },
    );

    if (!res.ok) {
      return NextResponse.json({ error: 'TMDB API error' }, { status: res.status });
    }

    const data = await res.json();
    const results = (data.results as TMDBMovie[]).slice(0, 12).map((m) => ({
      tmdb_id: m.id,
      title: m.title,
      original_title: m.original_title,
      overview: m.overview,
      poster_url: m.poster_path ? `${TMDB_IMG}/w342${m.poster_path}` : null,
      poster_path: m.poster_path,
      release_date: m.release_date,
      year: m.release_date ? new Date(m.release_date).getFullYear() : null,
      rating: Math.round(m.vote_average * 10) / 10,
      vote_count: m.vote_count,
      genres: m.genre_ids.map((id) => GENRE_MAP[id]).filter(Boolean),
      language: m.original_language,
    }));

    return NextResponse.json({ results });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to search TMDB' }, { status: 500 });
  }
}
