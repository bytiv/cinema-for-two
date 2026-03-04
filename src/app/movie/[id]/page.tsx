'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Movie, Profile, WatchHistory, WatchRoom } from '@/types';
import Navbar from '@/components/layout/Navbar';
import Button from '@/components/ui/Button';
import Image from 'next/image';
import AzurePosterImage from '@/components/movie/AzurePosterImage';
import Link from 'next/link';
import { Play, Users, Clock, HardDrive, Calendar, Trash2, ArrowLeft, History, RefreshCw } from 'lucide-react';
import { formatDuration, formatFileSize, formatRelativeTime } from '@/lib/utils';
import { v4 as uuidv4 } from 'uuid';

export default function MovieDetailPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const movieId = params.id as string;

  const [movie, setMovie] = useState<Movie | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string; profile: Profile } | null>(null);
  const [watchHistory, setWatchHistory] = useState<WatchHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeRoom, setActiveRoom] = useState<WatchRoom | null>(null);

  useEffect(() => {
    loadData();
  }, [movieId]);

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    // Trigger cleanup of stale rooms (fire-and-forget)
    fetch('/api/rooms/cleanup').catch(() => {});

    const [movieRes, profileRes, historyRes] = await Promise.all([
      supabase.from('movies').select('*').eq('id', movieId).single(),
      supabase.from('profiles').select('*').eq('user_id', user.id).single(),
      supabase.from('watch_history').select('*').eq('movie_id', movieId).eq('user_id', user.id).order('watched_at', { ascending: false }).limit(5),
    ]);

    // Check for existing active room for this movie by this user
    const { data: existingRooms } = await supabase
      .from('watch_rooms')
      .select('*')
      .eq('movie_id', movieId)
      .eq('host_user_id', user.id)
      .eq('is_active', true)
      .is('suspended_at', null)
      .order('created_at', { ascending: false })
      .limit(1);

    if (existingRooms && existingRooms.length > 0) {
      setActiveRoom(existingRooms[0]);
    }

    if (movieRes.data) {
      // Check access: must be uploader or a friend of the uploader
      const uploaderId = movieRes.data.uploaded_by;
      if (uploaderId !== user.id) {
        const [{ data: reqRow }, { data: addrRow }] = await Promise.all([
          supabase.from('friendships').select('id').eq('requester_id', user.id).eq('addressee_id', uploaderId).eq('status', 'accepted').maybeSingle(),
          supabase.from('friendships').select('id').eq('requester_id', uploaderId).eq('addressee_id', user.id).eq('status', 'accepted').maybeSingle(),
        ]);
        if (!reqRow && !addrRow) {
          setAccessDenied(true);
          setLoading(false);
          return;
        }
      }

      // Fetch uploader profile separately
      const { data: uploaderProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', movieRes.data.uploaded_by)
        .single();
      setMovie({ ...movieRes.data, uploader: uploaderProfile || undefined });
    }
    if (profileRes.data) setCurrentUser({ id: user.id, profile: profileRes.data });
    if (historyRes.data) setWatchHistory(historyRes.data);
    setLoading(false);
  }

  async function handleWatchTogether() {
    if (!currentUser || !movie) return;
    setCreatingRoom(true);

    const roomId = uuidv4();
    const { error } = await supabase.from('watch_rooms').insert({
      id: roomId,
      movie_id: movie.id,
      host_user_id: currentUser.id,
      is_active: true,
    });

    if (!error) {
      router.push(`/watch/${movie.id}/room/${roomId}`);
    }
    setCreatingRoom(false);
  }

  async function handleDelete() {
    if (!movie) return;
    setDeleting(true);
    await supabase.from('movies').delete().eq('id', movie.id);
    router.push('/browse');
    router.refresh();
  }

  if (loading) {
    return (
      <div className="min-h-screen">
        <Navbar />
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
  }

  if (accessDenied) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <div className="pt-24 px-4 max-w-5xl mx-auto text-center py-20">
          <div className="w-20 h-20 rounded-2xl bg-cinema-error/10 flex items-center justify-center mx-auto mb-6">
            <span className="text-4xl">🔒</span>
          </div>
          <h1 className="font-display text-3xl font-bold text-cinema-text mb-3">Friends Only</h1>
          <p className="text-cinema-text-muted mb-6 max-w-sm mx-auto">
            You need to be friends with the uploader to watch this movie.
          </p>
          <div className="flex gap-3 justify-center">
            <Link href="/browse"><Button variant="secondary">Back to Browse</Button></Link>
            <Link href="/friends"><Button>Add Friends</Button></Link>
          </div>
        </div>
      </div>
    );
  }

  if (!movie) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <div className="pt-24 px-4 max-w-5xl mx-auto text-center py-20">
          <h1 className="font-display text-3xl font-bold text-cinema-text mb-4">Movie not found</h1>
          <Link href="/browse"><Button variant="secondary">Back to Browse</Button></Link>
        </div>
      </div>
    );
  }

  const isUploader = currentUser?.id === movie.uploaded_by;

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
                <AzurePosterImage
                  posterUrl={movie.poster_url}
                  alt={movie.title}
                  fill
                  className="object-cover"
                  sizes="300px"
                  fallback={
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-cinema-accent/10 to-cinema-secondary/10">
                      <span className="text-6xl">🎬</span>
                    </div>
                  }
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-cinema-accent/10 to-cinema-secondary/10">
                  <span className="text-6xl">🎬</span>
                </div>
              )}
            </div>
          </div>

          {/* Info */}
          <div className="flex-1 space-y-6">
            <div>
              <h1 className="font-display text-3xl sm:text-4xl font-bold text-cinema-text mb-3">{movie.title}</h1>
              {movie.description && (
                <p className="text-cinema-text-muted leading-relaxed">{movie.description}</p>
              )}
            </div>

            {/* Meta */}
            <div className="flex flex-wrap gap-4">
              {movie.duration && (
                <div className="flex items-center gap-2 text-sm text-cinema-text-muted">
                  <Clock className="w-4 h-4 text-cinema-accent" />
                  {formatDuration(movie.duration)}
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
            </div>

            {/* Uploader */}
            {movie.uploader && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-cinema-card/50 border border-cinema-border w-fit">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cinema-accent to-cinema-secondary flex items-center justify-center overflow-hidden">
                  {movie.uploader.avatar_url ? (
                    <Image src={movie.uploader.avatar_url} alt="" width={32} height={32} className="object-cover" />
                  ) : (
                    <span className="text-xs font-bold text-cinema-bg">
                      {movie.uploader.first_name.charAt(0)}
                    </span>
                  )}
                </div>
                <p className="text-sm text-cinema-text">
                  Uploaded by {movie.uploader.first_name} {movie.uploader.last_name}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-3">
              <Link href={`/watch/${movie.id}/room/solo`}>
                <Button size="lg" icon={<Play className="w-5 h-5" />}>
                  Watch Solo
                </Button>
              </Link>
              {activeRoom ? (
                <Link href={`/watch/${movie.id}/room/${activeRoom.id}`}>
                  <Button
                    size="lg"
                    variant="warm"
                    icon={<RefreshCw className="w-5 h-5" />}
                  >
                    Resume Session
                  </Button>
                </Link>
              ) : (
                <Button
                  size="lg"
                  variant="warm"
                  icon={<Users className="w-5 h-5" />}
                  onClick={handleWatchTogether}
                  loading={creatingRoom}
                >
                  Watch Together
                </Button>
              )}
              {isUploader && (
                <>
                  {showDeleteConfirm ? (
                    <div className="flex items-center gap-2">
                      <Button variant="danger" onClick={handleDelete} loading={deleting}>
                        Confirm Delete
                      </Button>
                      <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="danger"
                      icon={<Trash2 className="w-4 h-4" />}
                      onClick={() => setShowDeleteConfirm(true)}
                    >
                      Delete
                    </Button>
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
                      <span className="text-cinema-text-dim">
                        {new Date(h.watched_at).toLocaleDateString()}
                      </span>
                      {h.completed && (
                        <span className="text-cinema-success text-xs px-2 py-0.5 rounded-full bg-cinema-success/10">
                          Completed
                        </span>
                      )}
                      {!h.completed && h.progress_seconds > 0 && (
                        <span className="text-cinema-warm text-xs">
                          Stopped at {formatDuration(h.progress_seconds)}
                        </span>
                      )}
                      {h.partner && (
                        <span className="text-cinema-accent text-xs px-2 py-0.5 rounded-full bg-cinema-accent/10">
                          with {h.partner.first_name}
                        </span>
                      )}
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
              <div className="w-14 h-14 rounded-full bg-cinema-error/10 flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-7 h-7 text-cinema-error" />
              </div>
              <h3 className="font-display text-xl font-semibold text-cinema-text mb-2">Delete Movie?</h3>
              <p className="text-cinema-text-muted text-sm">
                This will remove &quot;{movie.title}&quot; from the collection. This action cannot be undone.
              </p>
            </div>
            <div className="flex gap-3">
              <Button variant="ghost" className="flex-1" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </Button>
              <Button variant="danger" className="flex-1" onClick={handleDelete} loading={deleting}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}