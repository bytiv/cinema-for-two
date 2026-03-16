'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Movie, Profile, WatchHistory, WatchRoom, VideoQuality, SubtitleTrack } from '@/types';
import Navbar from '@/components/layout/Navbar';
import Button from '@/components/ui/Button';
import Image from 'next/image';
import AzurePosterImage from '@/components/movie/AzurePosterImage';
import Link from 'next/link';
import { Play, Users, Clock, HardDrive, Calendar, Trash2, ArrowLeft, History, RefreshCw, Pencil, X, Gauge, Globe, Plus, Save, AlertCircle, Image as ImageIcon, Upload } from 'lucide-react';
import { formatDuration, formatFileSize, formatRelativeTime } from '@/lib/utils';
import { v4 as uuidv4 } from 'uuid';
import { cn } from '@/lib/utils';
import DurationInput from '@/components/ui/DurationInput';
import { useAdminMode } from '@/contexts/AdminModeContext';

const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'Arabic' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ru', label: 'Russian' },
  { code: 'tr', label: 'Turkish' },
];

const QUALITY_OPTIONS: { value: VideoQuality; label: string; desc: string }[] = [
  { value: '480p',  label: '480p',  desc: 'SD' },
  { value: '720p',  label: '720p',  desc: 'HD' },
  { value: '1080p', label: '1080p', desc: 'Full HD' },
  { value: '4K',    label: '4K',    desc: 'Ultra HD' },
];

interface NewSubtitleEntry {
  id: string;
  file: File;
  lang: string;
  label: string;
}

// ─── Edit Modal ──────────────────────────────────────────────────────────────

function EditMovieModal({
  movie,
  onClose,
  onSaved,
}: {
  movie: Movie;
  onClose: () => void;
  onSaved: (updated: Movie) => void;
}) {
  const [title, setTitle] = useState(movie.title);
  const [description, setDescription] = useState(movie.description ?? '');
  const [quality, setQuality] = useState<VideoQuality | null>(movie.quality ?? null);
  const [duration, setDuration] = useState<number | null>(movie.duration ?? null);
  const [subtitles, setSubtitles] = useState<SubtitleTrack[]>(movie.subtitles ?? []);
  const [newEntries, setNewEntries] = useState<NewSubtitleEntry[]>([]);
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterPreview, setPosterPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const ACCEPTED_SUBTITLE = '.srt,.vtt';
  const ACCEPTED_IMAGE = '.jpg,.jpeg,.png,.webp,.gif';
  const MAX_POSTER_SIZE = 10 * 1024 * 1024;

  const handlePosterSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_POSTER_SIZE) { setError('Poster must be under 10MB'); return; }
    setPosterFile(file);
    setPosterPreview(URL.createObjectURL(file));
  };

  const srtToVtt = async (file: File): Promise<Blob> => {
    const text = await file.text();
    const vtt = 'WEBVTT\n\n' + text.replace(/\r\n/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    return new Blob([vtt], { type: 'text/vtt' });
  };

  const handleSubtitleAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const entries: NewSubtitleEntry[] = files.map((file) => {
      const parts = file.name.replace(/\.(srt|vtt)$/i, '').split('.');
      const lastPart = parts[parts.length - 1].toLowerCase();
      const detected = LANGUAGE_OPTIONS.find((l) => l.code === lastPart);
      return { id: Math.random().toString(36).slice(2), file, lang: detected?.code || 'en', label: detected?.label || 'English' };
    });
    setNewEntries((prev) => [...prev, ...entries]);
    e.target.value = '';
  };

  const updateNewLang = (id: string, lang: string) => {
    const opt = LANGUAGE_OPTIONS.find((l) => l.code === lang);
    setNewEntries((prev) => prev.map((s) => s.id === id ? { ...s, lang, label: opt?.label || lang } : s));
  };

  const uploadNewSubtitle = async (entry: NewSubtitleEntry, userId: string): Promise<SubtitleTrack> => {
    const baseName = entry.file.name.replace(/\.(srt|vtt)$/i, '');
    const blobName = `${userId}/${Date.now()}-${baseName}.vtt`;
    const sasRes = await fetch('/api/upload/sas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ container: 'subtitles', blobName, contentType: 'text/vtt' }),
    });
    if (!sasRes.ok) throw new Error('Failed to get subtitle upload URL');
    const { uploadUrl, readUrl } = await sasRes.json();
    const isSrt = entry.file.name.toLowerCase().endsWith('.srt');
    const body = isSrt ? await srtToVtt(entry.file) : entry.file;
    await fetch(uploadUrl, { method: 'PUT', headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'text/vtt' }, body });
    return { label: entry.label, lang: entry.lang, url: readUrl };
  };

  const handleSave = async () => {
    if (!title.trim()) { setError('Title is required'); return; }
    setSaving(true);
    setError('');
    try {
      const userId = movie.uploaded_by;

      // Upload new poster if selected
      let newPosterUrl: string | undefined;
      if (posterFile) {
        const posterName = `${userId}/${Date.now()}-${posterFile.name}`;
        const sasRes = await fetch('/api/upload/sas', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ container: 'posters', blobName: posterName, contentType: posterFile.type }),
        });
        if (!sasRes.ok) throw new Error('Failed to get poster upload URL');
        const { uploadUrl, readUrl } = await sasRes.json();
        await fetch(uploadUrl, { method: 'PUT', headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': posterFile.type }, body: posterFile });
        newPosterUrl = readUrl;
      }

      // Upload any new subtitle files
      let allSubtitles = [...subtitles];
      if (newEntries.length > 0) {
        const uploaded = await Promise.all(newEntries.map((e) => uploadNewSubtitle(e, userId)));
        allSubtitles = [...allSubtitles, ...uploaded];
      }

      const res = await fetch('/api/movies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: movie.id,
          title: title.trim(),
          description: description.trim() || null,
          quality: quality || null,
          duration: duration || null,
          subtitles: allSubtitles,
          ...(newPosterUrl ? { poster_url: newPosterUrl } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }

      const { movie: updated } = await res.json();
      onSaved(updated);
    } catch (err: any) {
      setError(err.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-cinema-card border border-cinema-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-cinema-border">
          <h2 className="font-display text-xl font-semibold text-cinema-text flex items-center gap-2">
            <Pencil className="w-5 h-5 text-cinema-accent" />
            Edit Movie Details
          </h2>
          <button onClick={onClose} className="text-cinema-text-dim hover:text-cinema-text transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Title */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-cinema-text-muted">Movie Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl bg-cinema-surface border border-cinema-border px-4 py-3 text-cinema-text placeholder:text-cinema-text-dim focus:outline-none focus:border-cinema-accent/50 focus:ring-2 focus:ring-cinema-accent/20 transition-all"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-cinema-text-muted">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-xl bg-cinema-surface border border-cinema-border px-4 py-3 text-cinema-text placeholder:text-cinema-text-dim focus:outline-none focus:border-cinema-accent/50 focus:ring-2 focus:ring-cinema-accent/20 transition-all resize-none"
              placeholder="What's this movie about?"
            />
          </div>

          {/* Poster */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-cinema-text-muted">
              <ImageIcon className="w-4 h-4 text-cinema-warm" />
              Poster Image
            </label>
            <div className="flex items-center gap-4">
              {/* Current / preview */}
              <div className="relative w-20 h-28 rounded-xl overflow-hidden bg-cinema-surface border border-cinema-border flex-shrink-0">
                {posterPreview ? (
                  <img src={posterPreview} alt="New poster" className="w-full h-full object-cover" />
                ) : movie.poster_url ? (
                  <AzurePosterImage posterUrl={movie.poster_url} alt="" fill className="object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-2xl">🎬</div>
                )}
                {posterPreview && (
                  <button
                    type="button"
                    onClick={() => { setPosterFile(null); setPosterPreview(null); }}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-cinema-accent/10 text-cinema-accent hover:bg-cinema-accent/20 border border-cinema-accent/20 transition-colors cursor-pointer w-fit">
                  <Upload className="w-3.5 h-3.5" />
                  {movie.poster_url ? 'Replace poster' : 'Upload poster'}
                  <input type="file" accept={ACCEPTED_IMAGE} onChange={handlePosterSelect} className="hidden" />
                </label>
                <p className="text-xs text-cinema-text-dim">JPG, PNG or WebP · max 10MB</p>
              </div>
            </div>
          </div>

          {/* Quality */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-cinema-text-muted">
              <Gauge className="w-4 h-4 text-cinema-accent" />
              Video Quality
            </label>
            <div className="grid grid-cols-4 gap-2">
              {QUALITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setQuality(quality === opt.value ? null : opt.value)}
                  className={cn(
                    'flex flex-col items-center py-2.5 px-3 rounded-xl border text-xs font-medium transition-all duration-200',
                    quality === opt.value
                      ? 'border-cinema-accent bg-cinema-accent/10 text-cinema-accent'
                      : 'border-cinema-border bg-cinema-surface text-cinema-text-muted hover:border-cinema-accent/40 hover:text-cinema-text'
                  )}
                >
                  <span className="text-sm font-bold">{opt.label}</span>
                  <span className="text-[10px] mt-0.5 opacity-70">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Duration */}
          <DurationInput value={duration} onChange={setDuration} />

          {/* Existing Subtitles */}
          <div className="space-y-2">
            <label className="flex items-center justify-between text-sm font-medium text-cinema-text-muted">
              <span className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-cinema-secondary" />
                Subtitles
              </span>
              <label className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-cinema-secondary/15 text-cinema-secondary hover:bg-cinema-secondary/25 border border-cinema-secondary/20 transition-colors cursor-pointer font-medium">
                <Plus className="w-3 h-3" /> Add
                <input type="file" accept={ACCEPTED_SUBTITLE} multiple onChange={handleSubtitleAdd} className="hidden" />
              </label>
            </label>

            {subtitles.length === 0 && newEntries.length === 0 ? (
              <p className="text-xs text-cinema-text-dim text-center py-3">No subtitles attached</p>
            ) : (
              <div className="space-y-1.5">
                {subtitles.map((sub, i) => (
                  <div key={i} className="flex items-center gap-2 p-2.5 rounded-xl bg-cinema-surface border border-cinema-border">
                    <Globe className="w-4 h-4 text-cinema-secondary flex-shrink-0" />
                    <span className="flex-1 text-sm text-cinema-text truncate">{sub.label} ({sub.lang})</span>
                    <span className="text-xs text-cinema-text-dim px-2 py-0.5 rounded bg-cinema-card">saved</span>
                    <button onClick={() => setSubtitles((prev) => prev.filter((_, idx) => idx !== i))} className="text-cinema-text-dim hover:text-cinema-error transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {newEntries.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-2 p-2.5 rounded-xl bg-cinema-success/5 border border-cinema-success/20">
                    <Globe className="w-4 h-4 text-cinema-success flex-shrink-0" />
                    <span className="flex-1 text-sm text-cinema-text truncate">{entry.file.name}</span>
                    <select
                      value={entry.lang}
                      onChange={(e) => updateNewLang(entry.id, e.target.value)}
                      className="text-xs rounded-lg bg-cinema-card border border-cinema-border px-2 py-1 text-cinema-text focus:outline-none cursor-pointer"
                    >
                      {LANGUAGE_OPTIONS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                    </select>
                    <button onClick={() => setNewEntries((prev) => prev.filter((e) => e.id !== entry.id))} className="text-cinema-text-dim hover:text-cinema-error transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-cinema-error/10 border border-cinema-error/20">
              <AlertCircle className="w-4 h-4 text-cinema-error flex-shrink-0" />
              <p className="text-sm text-cinema-error">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 pt-0">
          <Button variant="ghost" className="flex-1" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="flex-1" onClick={handleSave} loading={saving} icon={<Save className="w-4 h-4" />}>
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MovieDetailPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const movieId = params.id as string;

  const { adminMode } = useAdminMode();

  const [movie, setMovie] = useState<Movie | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string; profile: Profile } | null>(null);
  const [watchHistory, setWatchHistory] = useState<WatchHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeRoom, setActiveRoom] = useState<WatchRoom | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  useEffect(() => {
    loadData();
  }, [movieId]);

  // ── Background probe: detect duration + file_size via a hidden <video> element ──
  // Called only for torrent-ingested movies where these fields are null.
  // Fetches a short-lived SAS URL from the server, loads it silently in a
  // hidden <video> element to read metadata, then POSTs the result back.
  async function _probeMissingMeta(id: string, needDuration: boolean, needFileSize: boolean) {
    try {
      const res = await fetch(`/api/movies/${id}/probe`);
      if (!res.ok) return;
      const { sasUrl, file_size: existingSize, duration: existingDuration } = await res.json();

      // Determine what we still actually need
      const wantDuration  = needDuration  && !existingDuration;
      const wantFileSize  = needFileSize  && !existingSize;
      if (!wantDuration && !wantFileSize) return;

      const patch: { duration?: number; file_size?: number } = {};

      // Probe file_size via HEAD on the SAS URL
      if (wantFileSize) {
        try {
          const head = await fetch(sasUrl, { method: 'HEAD' });
          const cl   = parseInt(head.headers.get('content-length') ?? '0', 10);
          if (cl > 0) patch.file_size = cl;
        } catch {}
      }

      // Probe duration via a hidden <video> element
      if (wantDuration) {
        await new Promise<void>((resolve) => {
          const video = document.createElement('video');
          video.preload  = 'metadata';
          video.muted    = true;
          video.src      = sasUrl;
          const cleanup  = () => { video.src = ''; resolve(); };
          video.onloadedmetadata = () => {
            const secs = video.duration;
            if (isFinite(secs) && secs > 0) patch.duration = Math.round(secs);
            cleanup();
          };
          video.onerror = cleanup;
          // Timeout safety — if metadata never loads, give up after 30s
          setTimeout(cleanup, 30_000);
        });
      }

      if (Object.keys(patch).length === 0) return;

      // POST results back to the server
      const patchRes = await fetch(`/api/movies/${id}/probe`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(patch),
      });

      if (patchRes.ok) {
        const { updated } = await patchRes.json();
        if (updated) {
          // Refresh movie state so the UI reflects the new values
          setMovie((prev) => prev ? { ...prev, ...patch } : prev);
        }
      }
    } catch {
      // Non-fatal — silently ignore
    }
  }

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    fetch('/api/rooms/cleanup').catch(() => {});

    const [movieRes, profileRes, historyRes] = await Promise.all([
      supabase.from('movies').select('*').eq('id', movieId).single(),
      supabase.from('profiles').select('*').eq('user_id', user.id).single(),
      supabase.from('watch_history').select('*').eq('movie_id', movieId).eq('user_id', user.id).order('watched_at', { ascending: false }).limit(5),
    ]);

    const { data: existingRooms } = await supabase
      .from('watch_rooms').select('*').eq('movie_id', movieId).eq('host_user_id', user.id)
      .eq('is_active', true).is('suspended_at', null).order('created_at', { ascending: false }).limit(1);

    if (existingRooms && existingRooms.length > 0) setActiveRoom(existingRooms[0]);

    if (movieRes.data) {
      const uploaderId = movieRes.data.uploaded_by;
      let isFriendOfUploader = false;

      if (uploaderId !== user.id) {
        // Check direct friendship
        const [{ data: reqRow }, { data: addrRow }] = await Promise.all([
          supabase.from('friendships').select('id').eq('requester_id', user.id).eq('addressee_id', uploaderId).eq('status', 'accepted').maybeSingle(),
          supabase.from('friendships').select('id').eq('requester_id', uploaderId).eq('addressee_id', user.id).eq('status', 'accepted').maybeSingle(),
        ]);
        isFriendOfUploader = !!(reqRow || addrRow);

        // Check profile for admin role
        const isAdmin = profileRes.data?.role === 'admin';

        if (!isAdmin && !isFriendOfUploader) {
          // Check session-based invite access — user was invited to a room for this movie
          const { data: inviteRow } = await supabase
            .from('watch_invites')
            .select('id')
            .eq('movie_id', movieId)
            .eq('to_user_id', user.id)
            .eq('status', 'accepted')
            .maybeSingle();

          // Allow access if the movie is public, even without friendship
          const isPublicMovie = movieRes.data.is_public === true;

          if (!inviteRow && !isPublicMovie) {
            setAccessDenied(true);
            setLoading(false);
            return;
          }
        }
      } else {
        isFriendOfUploader = true; // you're always "friend" of yourself for display
      }

      // Only show uploader info if user is the uploader, a friend, or an admin
      const showUploader = uploaderId === user.id || isFriendOfUploader || profileRes.data?.role === 'admin';
      let uploaderProfile = undefined;
      if (showUploader) {
        const { data: up } = await supabase.from('profiles').select('*').eq('user_id', uploaderId).single();
        uploaderProfile = up || undefined;
      }
      setMovie({ ...movieRes.data, subtitles: movieRes.data.subtitles ?? [], uploader: uploaderProfile });

      // ── Background probe: back-fill duration + file_size for torrent-ingested movies ──
      // Runs for any ingest method when the movie is owned by this user and
      // duration or file_size are missing (torrent ffprobe may have failed,
      // or direct upload browser detection was skipped).
      const m = movieRes.data;
      if (m.uploaded_by === user.id && (!m.duration || !m.file_size)) {
        _probeMissingMeta(m.id, !m.duration, !m.file_size);
      }
    }
    if (profileRes.data) setCurrentUser({ id: user.id, profile: profileRes.data });
    if (historyRes.data) setWatchHistory(historyRes.data);
    setLoading(false);
  }

  async function handleWatchTogether() {
    if (!currentUser || !movie) return;
    setCreatingRoom(true);
    const roomId = uuidv4();
    const { error } = await supabase.from('watch_rooms').insert({ id: roomId, movie_id: movie.id, host_user_id: currentUser.id, is_active: true });
    if (!error) router.push(`/watch/${movie.id}/room/${roomId}`);
    setCreatingRoom(false);
  }

  async function handleDelete() {
    if (!movie) return;
    setDeleting(true);
    const res = await fetch(`/api/movies?id=${movie.id}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/browse');
      router.refresh();
    }
    setDeleting(false);
  }

  const [togglingPublic, setTogglingPublic] = useState(false);

  async function handleTogglePublic() {
    if (!movie) return;
    setTogglingPublic(true);
    try {
      const res = await fetch('/api/movies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: movie.id, is_public: !movie.is_public }),
      });
      if (res.ok) {
        const { movie: updated } = await res.json();
        setMovie((prev) => prev ? { ...prev, is_public: updated.is_public } : prev);
      }
    } catch {}
    setTogglingPublic(false);
  }

  if (loading) return (
    <div className="min-h-screen"><Navbar />
      <div className="pt-24 px-4 max-w-5xl mx-auto">
        <div className="flex flex-col md:flex-row gap-8">
          <div className="w-64 aspect-[2/3] shimmer rounded-2xl" />
          <div className="flex-1 space-y-4">
            <div className="h-8 w-1/2 shimmer rounded" />
            <div className="h-4 w-full shimmer rounded" />
            <div className="h-4 w-3/4 shimmer rounded" />
          </div>
        </div>
      </div>
    </div>
  );

  if (accessDenied) return (
    <div className="min-h-screen"><Navbar />
      <div className="pt-24 px-4 max-w-5xl mx-auto text-center py-20">
        <div className="w-20 h-20 rounded-2xl bg-cinema-error/10 flex items-center justify-center mx-auto mb-6"><span className="text-4xl">🔒</span></div>
        <h1 className="font-display text-3xl font-bold text-cinema-text mb-3">Friends Only</h1>
        <p className="text-cinema-text-muted mb-6 max-w-sm mx-auto">You need to be friends with the uploader to watch this movie.</p>
        <div className="flex gap-3 justify-center">
          <Link href="/browse"><Button variant="secondary">Back to Browse</Button></Link>
          <Link href="/friends"><Button>Add Friends</Button></Link>
        </div>
      </div>
    </div>
  );

  if (!movie) return (
    <div className="min-h-screen"><Navbar />
      <div className="pt-24 px-4 max-w-5xl mx-auto text-center py-20">
        <h1 className="font-display text-3xl font-bold text-cinema-text mb-4">Movie not found</h1>
        <Link href="/browse"><Button variant="secondary">Back to Browse</Button></Link>
      </div>
    </div>
  );

  const isUploader = currentUser?.id === movie.uploaded_by;
  const canEdit = isUploader || adminMode;

  return (
    <div className="min-h-screen">
      <Navbar />

      {movie.poster_url && (
        <div className="fixed inset-0 z-0 opacity-20">
          <AzurePosterImage posterUrl={movie.poster_url} alt="" fill className="object-cover blur-3xl" />
          <div className="absolute inset-0 bg-cinema-bg/80" />
        </div>
      )}

      <main className="relative z-10 pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto">
        <Link href="/browse" className="inline-flex items-center gap-2 text-cinema-text-muted hover:text-cinema-text mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Browse
        </Link>

        <div className="flex flex-col md:flex-row gap-8">
          {/* Poster */}
          <div className="w-full md:w-72 flex-shrink-0">
            <div className="relative aspect-[2/3] rounded-2xl overflow-hidden bg-cinema-card glow-border">
              {movie.poster_url ? (
                <AzurePosterImage posterUrl={movie.poster_url} alt={movie.title} fill className="object-cover" sizes="300px"
                  fallback={<div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-cinema-accent/10 to-cinema-secondary/10"><span className="text-6xl">🎬</span></div>}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-cinema-accent/10 to-cinema-secondary/10"><span className="text-6xl">🎬</span></div>
              )}
            </div>
          </div>

          {/* Info */}
          <div className="flex-1 space-y-6">
            <div>
              <div className="flex items-start justify-between gap-4">
                <h1 className="font-display text-3xl sm:text-4xl font-bold text-cinema-text mb-3">{movie.title}</h1>
                {canEdit && (
                  <button
                    onClick={() => setShowEditModal(true)}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-cinema-card border border-cinema-border text-cinema-text-muted hover:text-cinema-text hover:border-cinema-accent/40 transition-all"
                  >
                    <Pencil className="w-4 h-4" />
                    Edit
                  </button>
                )}
              </div>
              {movie.description && <p className="text-cinema-text-muted leading-relaxed">{movie.description}</p>}
            </div>

            {/* Meta */}
            <div className="flex flex-wrap gap-4">
              {movie.duration && (
                <div className="flex items-center gap-2 text-sm text-cinema-text-muted">
                  <Clock className="w-4 h-4 text-cinema-accent" />
                  {formatDuration(movie.duration)}
                </div>
              )}
              {movie.quality && (
                <div className="flex items-center gap-2 text-sm text-cinema-text-muted">
                  <Gauge className="w-4 h-4 text-cinema-accent" />
                  {movie.quality}
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-cinema-text-muted">
                <HardDrive className="w-4 h-4 text-cinema-secondary" />
                {formatFileSize(movie.file_size)}
              </div>
              <div className="flex items-center gap-2 text-sm text-cinema-text-muted">
                <Calendar className="w-4 h-4 text-cinema-warm" />
                {formatRelativeTime(movie.created_at)}
              </div>
              {movie.subtitles && movie.subtitles.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-cinema-text-muted">
                  <Globe className="w-4 h-4 text-cinema-secondary" />
                  {movie.subtitles.map((s) => s.label).join(', ')}
                </div>
              )}
            </div>

            {/* Uploader */}
            {movie.uploader && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-cinema-card/50 border border-cinema-border w-fit">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cinema-accent to-cinema-secondary flex items-center justify-center overflow-hidden">
                  {movie.uploader.avatar_url ? (
                    <Image src={movie.uploader.avatar_url} alt="" width={32} height={32} className="object-cover" />
                  ) : (
                    <span className="text-xs font-bold text-cinema-bg">{movie.uploader.first_name.charAt(0)}</span>
                  )}
                </div>
                <p className="text-sm text-cinema-text">Uploaded by {movie.uploader.first_name} {movie.uploader.last_name}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-3">
              <Link href={`/watch/${movie.id}/room/solo`}>
                <Button size="lg" icon={<Play className="w-5 h-5" />}>Watch Solo</Button>
              </Link>
              {activeRoom ? (
                <Link href={`/watch/${movie.id}/room/${activeRoom.id}`}>
                  <Button size="lg" variant="warm" icon={<RefreshCw className="w-5 h-5" />}>Resume Session</Button>
                </Link>
              ) : (
                <Button size="lg" variant="warm" icon={<Users className="w-5 h-5" />} onClick={handleWatchTogether} loading={creatingRoom}>
                  Watch Together
                </Button>
              )}
              {adminMode && (
                <Button
                  variant={movie.is_public ? 'primary' : 'secondary'}
                  icon={<Globe className="w-4 h-4" />}
                  onClick={handleTogglePublic}
                  loading={togglingPublic}
                >
                  {movie.is_public ? 'Public' : 'Publish'}
                </Button>
              )}
              {canEdit && (
                <>
                  {showDeleteConfirm ? (
                    <div className="flex items-center gap-2">
                      <Button variant="danger" onClick={handleDelete} loading={deleting}>Confirm Delete</Button>
                      <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
                    </div>
                  ) : (
                    <Button variant="danger" icon={<Trash2 className="w-4 h-4" />} onClick={() => setShowDeleteConfirm(true)}>Delete</Button>
                  )}
                </>
              )}
            </div>

            {/* Watch History */}
            {watchHistory.length > 0 && (
              <div className="space-y-3 pt-4 border-t border-cinema-border">
                <h3 className="flex items-center gap-2 text-sm font-medium text-cinema-text-muted">
                  <History className="w-4 h-4" />
                  Watch History
                </h3>
                <div className="space-y-2">
                  {watchHistory.map((h) => (
                    <div key={h.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-cinema-card/30 border border-cinema-border/50 text-sm">
                      <span className="text-cinema-text-dim">{new Date(h.watched_at).toLocaleDateString()}</span>
                      {h.completed && <span className="text-cinema-success text-xs px-2 py-0.5 rounded-full bg-cinema-success/10">Completed</span>}
                      {!h.completed && h.progress_seconds > 0 && <span className="text-cinema-warm text-xs">Stopped at {formatDuration(h.progress_seconds)}</span>}
                      {h.partner && <span className="text-cinema-accent text-xs px-2 py-0.5 rounded-full bg-cinema-accent/10">with {h.partner.first_name}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Delete confirmation overlay */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-cinema-card border border-cinema-border rounded-2xl p-6 max-w-sm w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-cinema-error/10 flex items-center justify-center mx-auto mb-4"><Trash2 className="w-7 h-7 text-cinema-error" /></div>
              <h3 className="font-display text-xl font-semibold text-cinema-text mb-2">Delete Movie?</h3>
              <p className="text-cinema-text-muted text-sm">This will remove &quot;{movie.title}&quot; from the collection. This action cannot be undone.</p>
            </div>
            <div className="flex gap-3">
              <Button variant="ghost" className="flex-1" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
              <Button variant="danger" className="flex-1" onClick={handleDelete} loading={deleting}>Delete</Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {showEditModal && movie && (
        <EditMovieModal
          movie={movie}
          onClose={() => setShowEditModal(false)}
          onSaved={(updated) => {
            setMovie({ ...updated, uploader: movie.uploader, subtitles: updated.subtitles ?? [] });
            setShowEditModal(false);
          }}
        />
      )}
    </div>
  );
}