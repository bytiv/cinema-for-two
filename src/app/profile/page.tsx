'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Profile, Postcard, Movie, WatchHistory, Friendship } from '@/types';
import Navbar from '@/components/layout/Navbar';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Image from 'next/image';
import AzurePosterImage from '@/components/movie/AzurePosterImage';
import { User, Camera, Save, Plus, X, Film, Image as ImageIcon, History, Users, Lock, Eye, EyeOff, Trash2 } from 'lucide-react';
import { formatRelativeTime, formatFileSize, generateBlobName } from '@/lib/utils';
import { cn } from '@/lib/utils';
import PostcardModal from '@/components/postcards/PostcardModal';
import Link from 'next/link';

const MAX_POSTCARDS = 3;

export default function ProfilePage() {
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [postcards, setPostcards] = useState<Postcard[]>([]);
  const [myMovies, setMyMovies] = useState<Movie[]>([]);
  const [watchHistory, setWatchHistory] = useState<WatchHistory[]>([]);
  const [friends, setFriends] = useState<(Friendship & { friendProfile: Profile })[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPostcard, setSelectedPostcard] = useState<Postcard | null>(null);

  // Edit states
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [postcardUploading, setPostcardUploading] = useState(false);
  const [postcardCaption, setPostcardCaption] = useState('');
  const [showPostcardForm, setShowPostcardForm] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Password states
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // Delete account states
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const [profileRes, postcardsRes, moviesRes, historyRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', user.id).single(),
      supabase.from('postcards').select('*').eq('user_id', user.id).order('created_at'),
      supabase.from('movies').select('*').eq('uploaded_by', user.id).order('created_at', { ascending: false }),
      supabase.from('watch_history').select('*, movie:movies(*)').eq('user_id', user.id).order('watched_at', { ascending: false }).limit(10),
    ]);

    if (profileRes.data) {
      setProfile(profileRes.data);
      setFirstName(profileRes.data.first_name);
      setLastName(profileRes.data.last_name);
      setBio(profileRes.data.bio || '');
    }
    if (postcardsRes.data) setPostcards(postcardsRes.data);
    if (moviesRes.data) setMyMovies(moviesRes.data);
    if (historyRes.data) setWatchHistory(historyRes.data);

    const [{ data: asRequester }, { data: asAddressee }] = await Promise.all([
      supabase.from('friendships').select('id, addressee_id, created_at').eq('requester_id', user.id).eq('status', 'accepted'),
      supabase.from('friendships').select('id, requester_id, created_at').eq('addressee_id', user.id).eq('status', 'accepted'),
    ]);

    const friendUserIds: string[] = [];
    if (asRequester) asRequester.forEach((f) => friendUserIds.push(f.addressee_id));
    if (asAddressee) asAddressee.forEach((f) => friendUserIds.push(f.requester_id));

    if (friendUserIds.length > 0) {
      const { data: friendProfiles } = await supabase.from('profiles').select('*').in('user_id', friendUserIds);
      if (friendProfiles) {
        const profileMap = new Map(friendProfiles.map((p) => [p.user_id, p]));
        const allFriends: (Friendship & { friendProfile: Profile })[] = [];
        asRequester?.forEach((f) => {
          const fp = profileMap.get(f.addressee_id);
          if (fp) allFriends.push({ ...f, requester_id: user.id, addressee_id: f.addressee_id, status: 'accepted', updated_at: f.created_at, friendProfile: fp } as any);
        });
        asAddressee?.forEach((f) => {
          const fp = profileMap.get(f.requester_id);
          if (fp) allFriends.push({ ...f, requester_id: f.requester_id, addressee_id: user.id, status: 'accepted', updated_at: f.created_at, friendProfile: fp } as any);
        });
        setFriends(allFriends);
      }
    }

    setLoading(false);
  }

  function isOnline(lastSeen: string | null): boolean {
    if (!lastSeen) return false;
    return Date.now() - new Date(lastSeen).getTime() < 30 * 60 * 1000;
  }

  async function handleSaveProfile() {
    if (!userId) return;
    setSaving(true);
    const { error } = await supabase.from('profiles')
      .update({ first_name: firstName, last_name: lastName, bio: bio.trim() || null, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (!error) {
      showSuccess('Profile updated!');
      setProfile((prev) => prev ? { ...prev, first_name: firstName, last_name: lastName, bio: bio.trim() || null } : null);
    }
    setSaving(false);
  }

  async function handleChangePassword() {
    setPasswordError('');
    if (newPassword.length < 6) { setPasswordError('Password must be at least 6 characters'); return; }
    if (newPassword !== confirmPassword) { setPasswordError('Passwords do not match'); return; }
    setPasswordSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setPasswordError(error.message);
    } else {
      setNewPassword('');
      setConfirmPassword('');
      showSuccess('Password changed!');
    }
    setPasswordSaving(false);
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    setAvatarUploading(true);
    try {
      const blobName = generateBlobName(userId, file.name);
      const sasRes = await fetch('/api/upload/sas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ container: 'avatars', blobName, contentType: file.type }),
      });
      if (!sasRes.ok) throw new Error('Failed to get upload URL');
      const { uploadUrl, readUrl } = await sasRes.json();
      await fetch(uploadUrl, { method: 'PUT', headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': file.type }, body: file });
      await supabase.from('profiles').update({ avatar_url: readUrl }).eq('user_id', userId);
      setProfile((prev) => prev ? { ...prev, avatar_url: readUrl } : null);
      showSuccess('Avatar updated!');
    } catch (err) { console.error(err); }
    setAvatarUploading(false);
  }

  async function handlePostcardUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    setPostcardUploading(true);
    try {
      const blobName = generateBlobName(userId, file.name);
      const sasRes = await fetch('/api/upload/sas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ container: 'postcards', blobName, contentType: file.type }),
      });
      if (!sasRes.ok) throw new Error('Failed');
      const { uploadUrl, readUrl } = await sasRes.json();
      await fetch(uploadUrl, { method: 'PUT', headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': file.type }, body: file });
      const { data } = await supabase.from('postcards').insert({
        user_id: userId, image_url: readUrl, blob_name: blobName,
        caption: postcardCaption.trim() || null, position_index: postcards.length,
      }).select().single();
      if (data) setPostcards((prev) => [...prev, data]);
      setPostcardCaption('');
      setShowPostcardForm(false);
      showSuccess('Postcard added!');
    } catch (err) { console.error(err); }
    setPostcardUploading(false);
  }

  async function handleDeletePostcard(id: string) {
    await supabase.from('postcards').delete().eq('id', id);
    setPostcards((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleDeleteAccount() {
    if (!userId) return;
    setDeleting(true);
    try {
      await supabase.from('watch_history').delete().eq('user_id', userId);
      await supabase.from('postcards').delete().eq('user_id', userId);
      await supabase.from('friendships').delete().or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
      await supabase.from('profiles').delete().eq('user_id', userId);
      await supabase.auth.signOut();
      window.location.href = '/';
    } catch (err) {
      console.error(err);
      setDeleting(false);
    }
  }

  function showSuccess(msg: string) {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(''), 3000);
  }

  if (loading) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <div className="pt-24 px-4 max-w-3xl mx-auto space-y-6">
          <div className="h-32 shimmer rounded-2xl" />
          <div className="h-48 shimmer rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />

      {successMessage && (
        <div className="fixed top-20 right-4 z-50 bg-cinema-success/20 border border-cinema-success/30 text-cinema-success px-4 py-2 rounded-xl text-sm" style={{ animation: 'toastIn 0.3s ease' }}>
          {successMessage}
        </div>
      )}

      <main className="relative z-10 pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto">
        <h1 className="font-display text-3xl font-bold text-cinema-text mb-8">
          Your Profile <span className="text-cinema-accent">✨</span>
        </h1>

        <div className="space-y-6">

          {/* Avatar, Name & Bio */}
          <div className="bg-cinema-card/50 backdrop-blur-sm border border-cinema-border rounded-2xl p-6">
            <div className="flex items-center gap-6 mb-6">
              <div className="relative group">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-cinema-accent to-cinema-secondary flex items-center justify-center overflow-hidden ring-2 ring-cinema-border">
                  {profile?.avatar_url ? (
                    <Image src={profile.avatar_url} alt="Avatar" width={80} height={80} className="object-cover" />
                  ) : (
                    <User className="w-8 h-8 text-cinema-bg" />
                  )}
                </div>
                <label className="absolute inset-0 rounded-2xl bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity">
                  <Camera className="w-5 h-5 text-white" />
                  <input type="file" accept=".jpg,.jpeg,.png,.webp" onChange={handleAvatarUpload} className="hidden" />
                </label>
                {avatarUploading && (
                  <div className="absolute inset-0 rounded-2xl bg-black/50 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-cinema-accent border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>
              <div>
                <h2 className="font-display text-xl font-semibold text-cinema-text">
                  {profile?.first_name} {profile?.last_name}
                </h2>
                <p className="text-sm text-cinema-text-muted">Click avatar to change photo</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <Input id="firstName" label="First Name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              <Input id="lastName" label="Last Name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>

            {/* Bio */}
            <div className="mb-4 space-y-1.5">
              <label className="block text-sm font-medium text-cinema-text-muted">
                Bio <span className="text-cinema-text-dim font-normal">(optional)</span>
              </label>
              <textarea
                placeholder="Add a bio — tell your movie buddy a little about yourself..."
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                maxLength={200}
                className="w-full rounded-xl bg-cinema-card border border-cinema-border px-4 py-3 text-cinema-text placeholder:text-cinema-text-dim focus:outline-none focus:border-cinema-accent/50 focus:ring-2 focus:ring-cinema-accent/20 transition-all resize-none text-sm"
              />
              <p className="text-xs text-cinema-text-dim text-right">{bio.length}/200</p>
            </div>

            <Button onClick={handleSaveProfile} loading={saving} icon={<Save className="w-4 h-4" />}>
              Save Changes
            </Button>
          </div>

          {/* Change Password */}
          <div className="bg-cinema-card/50 backdrop-blur-sm border border-cinema-border rounded-2xl p-6">
            <h3 className="font-display text-lg font-semibold text-cinema-text flex items-center gap-2 mb-4">
              <Lock className="w-5 h-5 text-cinema-secondary" />
              Change Password
            </h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="relative">
                <Input id="newPassword" label="New Password" type={showNewPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="absolute right-3 top-9 text-cinema-text-dim hover:text-cinema-text transition-colors">
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className="relative">
                <Input id="confirmPassword" label="Confirm Password" type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-9 text-cinema-text-dim hover:text-cinema-text transition-colors">
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {passwordError && <p className="text-sm text-cinema-error mb-3">{passwordError}</p>}
            <Button onClick={handleChangePassword} loading={passwordSaving} variant="secondary" icon={<Lock className="w-4 h-4" />} disabled={!newPassword || !confirmPassword}>
              Update Password
            </Button>
          </div>

          {/* Friends */}
          <div className="bg-cinema-card/50 backdrop-blur-sm border border-cinema-border rounded-2xl p-6">
            <h3 className="font-display text-lg font-semibold text-cinema-text flex items-center gap-2 mb-4">
              <Users className="w-5 h-5 text-cinema-accent" />
              Friends
              {friends.length > 0 && <span className="text-sm font-normal text-cinema-text-muted">({friends.length})</span>}
            </h3>
            {friends.length === 0 ? (
              <p className="text-cinema-text-dim text-sm py-2 text-center">
                No friends yet.{' '}
                <a href="/friends" className="text-cinema-accent hover:underline">Add some!</a>
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {friends.map((f) => {
                  const fp = f.friendProfile;
                  const online = isOnline(fp.last_seen_at);
                  return (
                    <Link key={f.id} href={`/user/${fp.user_id}`} className="flex items-center gap-3 p-3 rounded-xl bg-cinema-surface/60 border border-cinema-border/50 hover:border-cinema-accent/30 hover:bg-cinema-surface transition-all">
                      <div className="relative flex-shrink-0">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cinema-accent to-cinema-secondary flex items-center justify-center overflow-hidden">
                          {fp.avatar_url ? (
                            <Image src={fp.avatar_url} alt="" width={40} height={40} className="object-cover" />
                          ) : (
                            <span className="text-xs font-bold text-cinema-bg">{fp.first_name.charAt(0)}{fp.last_name.charAt(0)}</span>
                          )}
                        </div>
                        <div className={cn('absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-cinema-surface', online ? 'bg-cinema-success' : 'bg-cinema-text-dim')} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-cinema-text truncate">{fp.first_name} {fp.last_name}</p>
                        <p className="text-[10px] text-cinema-text-dim truncate">
                          {online ? <span className="text-cinema-success">Online</span> : fp.last_seen_at ? formatRelativeTime(fp.last_seen_at) : 'Offline'}
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Postcards */}
          <div className="bg-cinema-card/50 backdrop-blur-sm border border-cinema-border rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display text-lg font-semibold text-cinema-text flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-cinema-warm" />
                  Your Postcards
                </h3>
                <p className="text-sm text-cinema-text-muted mt-1">{postcards.length}/{MAX_POSTCARDS} — These float on the home page!</p>
              </div>
              {postcards.length < MAX_POSTCARDS && (
                <Button variant="secondary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setShowPostcardForm(!showPostcardForm)}>Add</Button>
              )}
            </div>

            {showPostcardForm && (
              <div className="mb-4 p-4 rounded-xl bg-cinema-surface border border-cinema-border space-y-3">
                <Input id="caption" placeholder="Caption (optional)" value={postcardCaption} onChange={(e) => setPostcardCaption(e.target.value)} />
                <label className="block">
                  <Button variant="warm" size="sm" loading={postcardUploading} icon={<ImageIcon className="w-4 h-4" />} className="cursor-pointer" onClick={() => document.getElementById('postcardInput')?.click()}>
                    Choose Image
                  </Button>
                  <input id="postcardInput" type="file" accept=".jpg,.jpeg,.png,.webp" onChange={handlePostcardUpload} className="hidden" />
                </label>
              </div>
            )}

            {postcards.length === 0 ? (
              <p className="text-cinema-text-dim text-sm py-4 text-center">No postcards yet. Add some cute photos that will float on the home page!</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                {postcards.map((pc) => (
                  <div key={pc.id} className="relative group rounded-lg overflow-hidden aspect-[3/4] bg-cinema-surface cursor-pointer" onClick={() => setSelectedPostcard(pc)}>
                    <Image src={pc.image_url} alt={pc.caption || 'Postcard'} fill className="object-cover" sizes="120px" />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeletePostcard(pc.id); }}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-cinema-error"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* My Movies */}
          <div className="bg-cinema-card/50 backdrop-blur-sm border border-cinema-border rounded-2xl p-6">
            <h3 className="font-display text-lg font-semibold text-cinema-text flex items-center gap-2 mb-4">
              <Film className="w-5 h-5 text-cinema-accent" />
              Your Uploaded Movies
            </h3>
            {myMovies.length === 0 ? (
              <p className="text-cinema-text-dim text-sm py-4 text-center">You haven&apos;t uploaded any movies yet.</p>
            ) : (
              <div className="space-y-2">
                {myMovies.map((m) => (
                  <a key={m.id} href={`/movie/${m.id}`} className="flex items-center gap-3 p-3 rounded-xl hover:bg-cinema-surface transition-colors">
                    <div className="w-10 h-14 rounded-lg bg-cinema-surface flex-shrink-0 overflow-hidden">
                      {m.poster_url ? (
                        <AzurePosterImage posterUrl={m.poster_url} alt="" width={40} height={56} className="object-cover w-full h-full" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-lg">🎬</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-cinema-text truncate">{m.title}</p>
                      <p className="text-xs text-cinema-text-dim">{formatFileSize(m.file_size)} · {formatRelativeTime(m.created_at)}</p>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Watch History */}
          <div className="bg-cinema-card/50 backdrop-blur-sm border border-cinema-border rounded-2xl p-6">
            <h3 className="font-display text-lg font-semibold text-cinema-text flex items-center gap-2 mb-4">
              <History className="w-5 h-5 text-cinema-secondary" />
              Watch History
            </h3>
            {watchHistory.length === 0 ? (
              <p className="text-cinema-text-dim text-sm py-4 text-center">No watch history yet. Start watching!</p>
            ) : (
              <div className="space-y-2">
                {watchHistory.map((h) => (
                  <div key={h.id} className="flex items-center gap-3 p-3 rounded-xl bg-cinema-surface/50">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-cinema-text truncate">{(h as any).movie?.title || 'Unknown Movie'}</p>
                      <div className="flex items-center gap-2 text-xs text-cinema-text-dim">
                        <span>{new Date(h.watched_at).toLocaleDateString()}</span>
                        {h.completed && <span className="text-cinema-success">Completed</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Danger Zone */}
          <div className="bg-cinema-card/50 backdrop-blur-sm border border-cinema-error/20 rounded-2xl p-6">
            <h3 className="font-display text-lg font-semibold text-cinema-error flex items-center gap-2 mb-1">
              <Trash2 className="w-5 h-5" />
              Danger Zone
            </h3>
            <p className="text-sm text-cinema-text-muted mb-4">Permanently delete your account and all your data. This cannot be undone.</p>

            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="px-4 py-2 rounded-xl border border-cinema-error/30 text-cinema-error text-sm font-medium hover:bg-cinema-error/10 transition-colors"
              >
                Delete My Account
              </button>
            ) : (
              <div className="space-y-3 p-4 rounded-xl bg-cinema-error/5 border border-cinema-error/20">
                <p className="text-sm text-cinema-text">
                  Type <span className="font-mono font-bold text-cinema-error">DELETE</span> to confirm
                </p>
                <input
                  type="text"
                  value={deleteInput}
                  onChange={(e) => setDeleteInput(e.target.value)}
                  placeholder="Type DELETE"
                  className="w-full rounded-xl bg-cinema-card border border-cinema-border px-4 py-2.5 text-cinema-text placeholder:text-cinema-text-dim focus:outline-none focus:border-cinema-error/50 focus:ring-2 focus:ring-cinema-error/20 transition-all text-sm"
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}
                    className="flex-1 px-4 py-2 rounded-xl border border-cinema-border text-cinema-text-muted text-sm hover:bg-cinema-surface transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleteInput !== 'DELETE' || deleting}
                    className="flex-1 px-4 py-2 rounded-xl bg-cinema-error text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-cinema-error/80 transition-colors flex items-center justify-center gap-2"
                  >
                    {deleting ? (
                      <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Deleting...</>
                    ) : (
                      <><Trash2 className="w-4 h-4" /> Confirm Delete</>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      </main>

      {selectedPostcard && (
        <PostcardModal postcard={selectedPostcard} onClose={() => setSelectedPostcard(null)} />
      )}
    </div>
  );
}