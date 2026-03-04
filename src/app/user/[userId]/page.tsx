'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Profile, Postcard } from '@/types';
import Navbar from '@/components/layout/Navbar';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, Film, Clock, Heart, User } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';
import { cn } from '@/lib/utils';

export default function UserProfilePage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const profileUserId = params.userId as string;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [postcards, setPostcards] = useState<Postcard[]>([]);
  const [movieCount, setMovieCount] = useState(0);
  const [isFriend, setIsFriend] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPostcard, setSelectedPostcard] = useState<Postcard | null>(null);

  useEffect(() => {
    loadProfile();
  }, [profileUserId]);

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/auth/login'); return; }
    setCurrentUserId(user.id);

    // Redirect to own profile page if viewing yourself
    if (user.id === profileUserId) {
      router.push('/profile');
      return;
    }

    const [profileRes, postcardsRes, moviesRes, friendshipRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', profileUserId).single(),
      supabase.from('postcards').select('*').eq('user_id', profileUserId).order('position_index'),
      supabase.from('movies').select('id', { count: 'exact' }).eq('uploaded_by', profileUserId),
      supabase.from('friendships')
        .select('id, status')
        .or(`and(requester_id.eq.${user.id},addressee_id.eq.${profileUserId}),and(requester_id.eq.${profileUserId},addressee_id.eq.${user.id})`)
        .eq('status', 'accepted')
        .maybeSingle(),
    ]);

    if (!profileRes.data) { router.push('/friends'); return; }

    setProfile(profileRes.data);
    setPostcards(postcardsRes.data || []);
    setMovieCount(moviesRes.count || 0);
    setIsFriend(!!friendshipRes.data);
    setLoading(false);
  }

  function isOnline(lastSeen: string | null): boolean {
    if (!lastSeen) return false;
    return Date.now() - new Date(lastSeen).getTime() < 30 * 60 * 1000;
  }

  if (loading) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <div className="pt-24 px-4 max-w-2xl mx-auto space-y-4">
          <div className="h-48 shimmer rounded-3xl" />
          <div className="h-32 shimmer rounded-3xl" />
          <div className="h-48 shimmer rounded-3xl" />
        </div>
      </div>
    );
  }

  if (!profile) return null;

  const online = isOnline(profile.last_seen_at);
  const firstName = profile.first_name;

  return (
    <div className="min-h-screen">
      <Navbar />

      <main className="relative z-10 pt-20 pb-16 px-4 sm:px-6 lg:px-8 max-w-2xl mx-auto">

        {/* Back */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-cinema-text-muted hover:text-cinema-text transition-colors mb-6 group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          <span className="text-sm">Back</span>
        </button>

        {/* Hero card */}
        <div className="relative rounded-3xl overflow-hidden bg-cinema-card border border-cinema-border mb-4">
          {/* Gradient background */}
          <div className="absolute inset-0 bg-gradient-to-br from-cinema-accent/10 via-transparent to-cinema-secondary/10" />
          <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-cinema-accent/5 blur-3xl" />

          <div className="relative p-8">
            <div className="flex items-start gap-6">
              {/* Avatar */}
              <div className="relative flex-shrink-0">
                <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-cinema-accent to-cinema-secondary flex items-center justify-center overflow-hidden ring-2 ring-cinema-border shadow-xl">
                  {profile.avatar_url ? (
                    <Image src={profile.avatar_url} alt="" width={96} height={96} className="object-cover" />
                  ) : (
                    <User className="w-10 h-10 text-cinema-bg" />
                  )}
                </div>
                {/* Online dot */}
                <div className={cn(
                  'absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-cinema-card shadow-md',
                  online ? 'bg-cinema-success' : 'bg-cinema-text-dim/40'
                )} />
              </div>

              {/* Name & status */}
              <div className="flex-1 min-w-0 pt-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="font-display text-3xl font-bold text-cinema-text">
                    {profile.first_name}
                    <span className="text-cinema-text-muted font-normal"> {profile.last_name}</span>
                  </h1>
                  {isFriend && (
                    <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-cinema-accent/15 text-cinema-accent border border-cinema-accent/20 font-medium">
                      <Heart className="w-3 h-3" fill="currentColor" /> Friends
                    </span>
                  )}
                </div>

                <p className="text-sm mt-1 flex items-center gap-1.5">
                  {online ? (
                    <span className="text-cinema-success font-medium">● Online now</span>
                  ) : profile.last_seen_at ? (
                    <span className="text-cinema-text-dim">Last seen {formatRelativeTime(profile.last_seen_at)}</span>
                  ) : (
                    <span className="text-cinema-text-dim">Never seen</span>
                  )}
                </p>

                {/* Stats row */}
                <div className="flex items-center gap-4 mt-4">
                  <div className="flex items-center gap-1.5 text-sm text-cinema-text-muted">
                    <Film className="w-4 h-4 text-cinema-accent/60" />
                    <span><span className="font-semibold text-cinema-text">{movieCount}</span> movie{movieCount !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm text-cinema-text-muted">
                    <Clock className="w-4 h-4 text-cinema-secondary/60" />
                    <span>Joined {formatRelativeTime(profile.created_at)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Bio */}
            {profile.bio && (
              <div className="mt-6 pt-6 border-t border-cinema-border/50">
                <p className="text-cinema-text-muted text-sm leading-relaxed italic">
                  "{profile.bio}"
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Postcards */}
        {postcards.length > 0 && (
          <div className="bg-cinema-card/50 backdrop-blur-sm border border-cinema-border rounded-3xl p-6 mb-4">
            <h2 className="font-display text-lg font-semibold text-cinema-text mb-4 flex items-center gap-2">
              <span className="text-xl">🖼️</span>
              {firstName}'s Postcards
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {postcards.map((pc) => (
                <div
                  key={pc.id}
                  onClick={() => setSelectedPostcard(pc)}
                  className="relative rounded-xl overflow-hidden aspect-[3/4] bg-cinema-surface cursor-pointer group transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-cinema-accent/20 hover:z-10"
                >
                  <Image
                    src={pc.image_url}
                    alt={pc.caption || 'Postcard'}
                    fill
                    className="object-cover transition-transform duration-300 group-hover:scale-110"
                    sizes="120px"
                  />
                  {pc.caption && (
                    <div className="absolute bottom-0 left-0 right-0 bg-white/90 py-1 px-1.5 translate-y-full group-hover:translate-y-0 transition-transform duration-200">
                      <p className="text-[8px] text-gray-600 text-center truncate">{pc.caption}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state — no postcards, not friends */}
        {postcards.length === 0 && (
          <div className="bg-cinema-card/30 border border-cinema-border/50 rounded-3xl p-8 text-center">
            <span className="text-4xl block mb-3">🎞️</span>
            <p className="text-cinema-text-muted text-sm">
              {firstName} hasn't added any postcards yet
            </p>
          </div>
        )}

      </main>

      {/* Postcard full-view modal */}
      {selectedPostcard && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedPostcard(null)}
        >
          <div className="relative max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="relative rounded-2xl overflow-hidden shadow-2xl bg-white">
              <div className="relative aspect-[4/5]">
                <Image
                  src={selectedPostcard.image_url}
                  alt={selectedPostcard.caption || 'Postcard'}
                  fill
                  className="object-cover"
                  sizes="500px"
                />
              </div>
              {selectedPostcard.caption && (
                <div className="bg-white py-3 px-4">
                  <p className="text-sm text-gray-700 text-center">{selectedPostcard.caption}</p>
                </div>
              )}
            </div>
            <button
              onClick={() => setSelectedPostcard(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-cinema-card border border-cinema-border flex items-center justify-center hover:bg-cinema-error transition-colors"
            >
              <ArrowLeft className="w-4 h-4 text-cinema-text rotate-[135deg]" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}