'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Movie } from '@/types';
import MovieCard from '@/components/movie/MovieCard';
import Navbar from '@/components/layout/Navbar';
import FloatingPostcards from '@/components/postcards/FloatingPostcards';
import Button from '@/components/ui/Button';
import { Search, Upload, Film, Clock, ArrowUpDown } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import WatchInviteToast from '@/components/watch/WatchInviteToast';

type SortBy = 'newest' | 'oldest' | 'title' | 'size';

export default function BrowsePage() {
  const supabase = createClient();
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('newest');

  useEffect(() => {
    loadMovies();
  }, []);

  async function loadMovies() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    // Get friend IDs (two queries to avoid .or() RLS issues)
    const [{ data: asRequester }, { data: asAddressee }] = await Promise.all([
      supabase.from('friendships').select('addressee_id').eq('requester_id', user.id).eq('status', 'accepted'),
      supabase.from('friendships').select('requester_id').eq('addressee_id', user.id).eq('status', 'accepted'),
    ]);

    const allowedIds: string[] = [user.id];
    if (asRequester) asRequester.forEach((f) => allowedIds.push(f.addressee_id));
    if (asAddressee) asAddressee.forEach((f) => allowedIds.push(f.requester_id));

    // Only show movies uploaded by the user or their friends
    const { data } = await supabase
      .from('movies')
      .select('*')
      .in('uploaded_by', allowedIds)
      .order('created_at', { ascending: false });

    if (data) setMovies(data);
    setLoading(false);
  }

  const filteredMovies = movies
    .filter((m) =>
      m.title.toLowerCase().includes(search.toLowerCase()) ||
      m.description?.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      switch (sortBy) {
        case 'newest': return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'oldest': return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'title': return a.title.localeCompare(b.title);
        case 'size': return b.file_size - a.file_size;
        default: return 0;
      }
    });

  return (
    <div className="min-h-screen">
      <Navbar />
      <FloatingPostcards />

      <main className="relative z-10 pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold text-cinema-text mb-1">
              Our Movies <span className="text-cinema-accent">🍿</span>
            </h1>
            <p className="text-cinema-text-muted">
              {movies.length} {movies.length === 1 ? 'movie' : 'movies'} in the collection
            </p>
          </div>
          <Link href="/upload">
            <Button icon={<Upload className="w-4 h-4" />}>Upload Movie</Button>
          </Link>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cinema-text-dim" />
            <input
              type="text"
              placeholder="Search movies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-cinema-card border border-cinema-border text-cinema-text placeholder:text-cinema-text-dim focus:outline-none focus:border-cinema-accent/50 focus:ring-2 focus:ring-cinema-accent/20 transition-all"
            />
          </div>
          <div className="flex gap-2">
            {([
              { key: 'newest', label: 'Newest', icon: Clock },
              { key: 'title', label: 'A-Z', icon: ArrowUpDown },
            ] as const).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setSortBy(key)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all',
                  sortBy === key
                    ? 'bg-cinema-accent/15 text-cinema-accent border border-cinema-accent/30'
                    : 'bg-cinema-card border border-cinema-border text-cinema-text-muted hover:text-cinema-text'
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Movie Grid */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-2xl overflow-hidden">
                <div className="aspect-[2/3] shimmer rounded-2xl" />
                <div className="p-4 space-y-2">
                  <div className="h-5 w-3/4 shimmer rounded" />
                  <div className="h-4 w-full shimmer rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredMovies.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 rounded-2xl bg-cinema-card flex items-center justify-center mx-auto mb-6">
              <Film className="w-10 h-10 text-cinema-text-dim" />
            </div>
            <h2 className="font-display text-2xl font-semibold text-cinema-text mb-2">
              {search ? 'No movies found' : 'No movies yet'}
            </h2>
            <p className="text-cinema-text-muted mb-6">
              {search
                ? `Nothing matches "${search}". Try a different search?`
                : 'Upload your first movie or add friends to see their movies!'}
            </p>
            {!search && (
              <Link href="/upload">
                <Button icon={<Upload className="w-4 h-4" />}>Upload a Movie</Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
            {filteredMovies.map((movie) => (
              <MovieCard key={movie.id} movie={movie} />
            ))}
          </div>
        )}
      </main>
      <WatchInviteToast />
    </div>
  );
}