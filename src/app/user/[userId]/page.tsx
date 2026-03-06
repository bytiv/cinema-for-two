'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Profile, Postcard } from '@/types';
import Navbar from '@/components/layout/Navbar';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, Film, Clock, Heart, User, Pencil, Save, X } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { useAdminMode } from '@/contexts/AdminModeContext';

export default function UserProfilePage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const profileUserId = params.userId as string;
  const { adminMode } = useAdminMode();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [postcards, setPostcards] = useState<Postcard[]>([]);
  const [movieCount, setMovieCount] = useState(0);
  const [isFriend, setIsFriend] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [selectedPostcard, setSelectedPostcard] = useState<Postcard | null>(null);

  // Admin edit state
  const [showAdminEdit, setShowAdminEdit] = useState(false);
  const [editFirst, setEditFirst] = useState('');
  const [editLast, setEditLast] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editStatus, setEditStatus] = useState<'pending' | 'approved' | 'denied'>('approved');
  const [editSaving, setEditSaving] = useState(false);

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

    const [profileRes, postcardsRes, moviesRes, myProfileRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', profileUserId).single(),
      supabase.from('postcards').select('*').eq('user_id', profileUserId).order('position_index'),
      supabase.from('movies').select('id', { count: 'exact' }).eq('uploaded_by', profileUserId),
      supabase.from('profiles').select('role').eq('user_id', user.id).single(),
    ]);

    if (!profileRes.data) { router.push('/friends'); return; }

    const isAdmin = myProfileRes.data?.role === 'admin';

    // Check friendship in both directions separately to avoid RLS issues with .or()
    let isFriend = false;
    if (!isAdmin) {
      const [{ data: reqRow }, { data: addrRow }] = await Promise.all([
        supabase.from('friendships').select('id').eq('requester_id', user.id).eq('addressee_id', profileUserId).eq('status', 'accepted').maybeSingle(),
        supabase.from('friendships').select('id').eq('requester_id', profileUserId).eq('addressee_id', user.id).eq('status', 'accepted').maybeSingle(),
      ]);
      isFriend = !!(reqRow || addrRow);
    }

    if (!isAdmin && !isFriend) {
      setAccessDenied(true);
      setLoading(false);
      return;
    }

    setProfile(profileRes.data);
    setPostcards(postcardsRes.data || []);
    setMovieCount(moviesRes.count || 0);
    setIsFriend(isFriend);
    setLoading(false);
  }

  function openAdminEdit() {
    if (!profile) return;
    setEditFirst(profile.first_name);
    setEditLast(profile.last_name);
    setEditBio(profile.bio || '');
    setEditStatus(profile.status);
    setShowAdminEdit(true);
  }

  async function handleAdminSave() {
    if (!profile) return;
    setEditSaving(true);
    const { error } = await supabase.from('profiles').update({
      first_name: editFirst,
      last_name: editLast,
      bio: editBio.trim() || null,
      status: editStatus,
      updated_at: new Date().toISOString(),
    }).eq('user_id', profileUserId);
    if (!error) {
      setProfile((p) => p ? { ...p, first_name: editFirst, last_name: editLast, bio: editBio.trim() || null, status: editStatus } : p);
      setShowAdminEdit(false);
    }
    setEditSaving(false);
  }

  function isOnline(lastSeen: string | null, hideOnline?: boolean): boolean {
    if (hideOnline) return false;
    if (!lastSeen) return false;
    return Date.now() - new Date(lastSeen).getTime() < 60 * 1000;
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

  if (accessDenied) return (
    <div className="min-h-screen"><Navbar />
      <div className="pt-24 px-4 max-w-md mx-auto text-center">
        <div className="w-16 h-16 rounded-2xl bg-cinema-card flex items-center justify-center mx-auto mb-4">
          <User className="w-8 h-8 text-cinema-text-dim" />
        </div>
        <h2 className="font-display text-2xl font-bold text-cinema-text mb-2">Profile Private</h2>
        <p className="text-cinema-text-muted mb-6">You need to be friends to view this profile.</p>
        <Link href="/friends"><button className="px-5 py-2.5 rounded-xl bg-cinema-accent/15 text-cinema-accent border border-cinema-accent/30 text-sm font-medium hover:bg-cinema-accent/25 transition-colors">Go to Friends</button></Link>
      </div>
    </div>
  );

  if (!profile) return null;

  const online = isOnline(profile.last_seen_at, profile.hide_online_status);
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
                  {adminMode && (
                    <button
                      onClick={openAdminEdit}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-cinema-accent/10 text-cinema-accent border border-cinema-accent/20 hover:bg-cinema-accent/20 transition-colors font-medium"
                    >
                      <Pencil className="w-3 h-3" /> Edit Profile
                    </button>
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
                    <div className="absolute bottom-0 left-0 right-0 bg-cinema-bg/80 py-1 px-1.5 translate-y-full group-hover:translate-y-0 transition-transform duration-200">
                      <p className="text-[9px] text-cinema-text text-center truncate">{pc.caption}</p>
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

      {/* Admin edit panel */}
      {showAdminEdit && adminMode && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowAdminEdit(false)}>
          <div className="bg-cinema-card border border-cinema-accent/20 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-display text-lg font-semibold text-cinema-text flex items-center gap-2">
                <Pencil className="w-4 h-4 text-cinema-accent" /> Edit Profile
                <span className="text-xs px-2 py-0.5 rounded-full bg-cinema-accent/15 text-cinema-accent border border-cinema-accent/20 font-normal">Admin</span>
              </h3>
              <button onClick={() => setShowAdminEdit(false)} className="text-cinema-text-dim hover:text-cinema-text transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-cinema-text-muted mb-1">First name</label>
                <input value={editFirst} onChange={(e) => setEditFirst(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-cinema-surface border border-cinema-border text-cinema-text text-sm focus:outline-none focus:border-cinema-accent/50 transition-colors" />
              </div>
              <div>
                <label className="block text-xs text-cinema-text-muted mb-1">Last name</label>
                <input value={editLast} onChange={(e) => setEditLast(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-cinema-surface border border-cinema-border text-cinema-text text-sm focus:outline-none focus:border-cinema-accent/50 transition-colors" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-cinema-text-muted mb-1">Bio</label>
              <textarea value={editBio} onChange={(e) => setEditBio(e.target.value)} rows={3} maxLength={200}
                className="w-full px-3 py-2 rounded-xl bg-cinema-surface border border-cinema-border text-cinema-text text-sm focus:outline-none focus:border-cinema-accent/50 transition-colors resize-none" />
            </div>
            <div>
              <label className="block text-xs text-cinema-text-muted mb-1">Account status</label>
              <select value={editStatus} onChange={(e) => setEditStatus(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl bg-cinema-surface border border-cinema-border text-cinema-text text-sm focus:outline-none focus:border-cinema-accent/50 transition-colors">
                <option value="approved">Approved</option>
                <option value="pending">Pending</option>
                <option value="denied">Denied</option>
              </select>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowAdminEdit(false)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-cinema-surface border border-cinema-border text-cinema-text-muted hover:text-cinema-text transition-colors">
                Cancel
              </button>
              <button onClick={handleAdminSave} disabled={editSaving}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-cinema-accent/15 text-cinema-accent border border-cinema-accent/30 hover:bg-cinema-accent/25 transition-colors flex items-center justify-center gap-2">
                {editSaving ? <span className="w-4 h-4 border-2 border-cinema-accent/40 border-t-cinema-accent rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

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
                <div className="bg-cinema-bg py-3 px-4">
                  <p className="text-sm text-cinema-text-muted text-center">{selectedPostcard.caption}</p>
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