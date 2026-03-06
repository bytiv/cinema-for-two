'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Movie, Profile } from '@/types';
import MovieCard from '@/components/movie/MovieCard';
import Navbar from '@/components/layout/Navbar';
import FloatingPostcards from '@/components/postcards/FloatingPostcards';
import Button from '@/components/ui/Button';
import { Search, Upload, Film, Clock, ArrowUpDown, User, Users, Globe } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import WatchInviteToast from '@/components/watch/WatchInviteToast';

type SortBy = 'newest' | 'oldest' | 'title';
type FilterBy = 'all' | 'mine' | 'friends';

export default function BrowsePage() {
  const supabase = createClient();
  const [allMovies, setAllMovies] = useState<Movie[]>([]);
  const [myIds, setMyIds] = useState<Set<string>>(new Set());
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminViewActive, setAdminViewActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [filterBy, setFilterBy] = useState<FilterBy>('all');

  useEffect(() => { loadMovies(false); }, []);

  // Re-fetch when admin toggles the view
  useEffect(() => {
    if (isAdmin) loadMovies(adminViewActive);
  }, [adminViewActive]);

  async function loadMovies(globalView: boolean) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    const admin = profile?.role === 'admin';
    setIsAdmin(admin);

    const [{ data: asRequester }, { data: asAddressee }] = await Promise.all([
      supabase.from('friendships').select('addressee_id').eq('requester_id', user.id).eq('status', 'accepted'),
      supabase.from('friendships').select('requester_id').eq('addressee_id', user.id).eq('status', 'accepted'),
    ]);

    const fIds = new Set<string>();
    if (asRequester) asRequester.forEach((f) => fIds.add(f.addressee_id));
    if (asAddressee) asAddressee.forEach((f) => fIds.add(f.requester_id));
    setFriendIds(fIds);
    setMyIds(new Set([user.id]));

    let query = supabase.from('movies').select('*').order('created_at', { ascending: false });
    if (!(admin && globalView)) {
      const allowedIds = [user.id, ...Array.from(fIds)];
      query = query.in('uploaded_by', allowedIds);
    }

    const { data } = await query;
    if (data) setAllMovies(data);
    setLoading(false);
  }

  const filteredMovies = allMovies
    .filter((m) => {
      // Text search
      const matchesSearch =
        m.title.toLowerCase().includes(search.toLowerCase()) ||
        m.description?.toLowerCase().includes(search.toLowerCase());
      if (!matchesSearch) return false;

      // Filter tab
      if (filterBy === 'mine') return myIds.has(m.uploaded_by);
      if (filterBy === 'friends') return friendIds.has(m.uploaded_by);
      return true; // 'all'
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'newest': return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'oldest': return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'title': return a.title.localeCompare(b.title);
        default: return 0;
      }
    });

  const filterTabs: { key: FilterBy; label: string; icon: React.ElementType }[] = [
    { key: 'all', label: isAdmin ? 'All' : 'All', icon: Globe },
    { key: 'mine', label: 'Mine', icon: User },
    { key: 'friends', label: "Friends'", icon: Users },
  ];

  return (
    <div className="min-h-screen">
      <Navbar />
      <FloatingPostcards />

      <main className="relative z-10 pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold text-cinema-text mb-1">
              {isAdmin ? 'All Movies' : 'Our Movies'} <span className="text-cinema-accent">🍿</span>
            </h1>
            <p className="text-cinema-text-muted">
              {filteredMovies.length} {filteredMovies.length === 1 ? 'movie' : 'movies'}
              {filterBy !== 'all' && <span className="text-cinema-text-dim"> · filtered</span>}
            </p>
          </div>
          <Link href="/upload">
            <Button icon={<Upload className="w-4 h-4" />}>Upload Movie</Button>
          </Link>
        </div>

        {/* Filter tabs + search + sort */}
        <div className="space-y-3 mb-8">
          {/* Filter tabs */}
          <div className="flex gap-2">
            {filterTabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setFilterBy(key)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all border',
                  filterBy === key
                    ? 'bg-cinema-accent/15 text-cinema-accent border-cinema-accent/30'
                    : 'bg-cinema-card border-cinema-border text-cinema-text-muted hover:text-cinema-text'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
                <span className={cn(
                  'text-xs px-1.5 py-0.5 rounded-md',
                  filterBy === key ? 'bg-cinema-accent/20 text-cinema-accent' : 'bg-cinema-surface text-cinema-text-dim'
                )}>
                  {key === 'all' && allMovies.length}
                  {key === 'mine' && allMovies.filter(m => myIds.has(m.uploaded_by)).length}
                  {key === 'friends' && allMovies.filter(m => friendIds.has(m.uploaded_by)).length}
                </span>
              </button>
            ))}
            {isAdmin && (
              <button
                onClick={() => setAdminViewActive((v) => !v)}
                className={cn(
                  'ml-auto flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border transition-all',
                  adminViewActive
                    ? 'bg-cinema-accent/15 text-cinema-accent border-cinema-accent/30'
                    : 'bg-cinema-card text-cinema-text-dim border-cinema-border hover:text-cinema-text'
                )}
              >
                <Globe className="w-3 h-3" />
                {adminViewActive ? 'Global view on' : 'Global view off'}
              </button>
            )}
          </div>

          {/* Search + sort */}
          <div className="flex flex-col sm:flex-row gap-3">
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
        </div>

        {/* Movie Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-2xl overflow-hidden">
                <div className="aspect-[4/3] shimmer rounded-2xl" />
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
                : filterBy === 'mine'
                ? "You haven't uploaded any movies yet."
                : filterBy === 'friends'
                ? "Your friends haven't uploaded any movies yet."
                : 'Upload your first movie or add friends to see their movies!'}
            </p>
            {!search && filterBy !== 'friends' && (
              <Link href="/upload">
                <Button icon={<Upload className="w-4 h-4" />}>Upload a Movie</Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
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