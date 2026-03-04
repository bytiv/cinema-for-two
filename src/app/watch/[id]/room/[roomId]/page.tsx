'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Movie, Profile, PlaybackEvent } from '@/types';
import Navbar from '@/components/layout/Navbar';
import VideoPlayer from '@/components/watch/VideoPlayer';
import ChatPanel from '@/components/watch/ChatPanel';
import Button from '@/components/ui/Button';
import { useWatchRoom } from '@/hooks/useWatchRoom';
import { ArrowLeft, Copy, Check, Users, Crown, Power, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import InviteFriendModal from '@/components/watch/InviteFriendModal';

export default function WatchRoomPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const movieId = params.id as string;
  const roomId = params.roomId as string;
  const isSolo = roomId === 'solo';

  const [movie, setMovie] = useState<Movie | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string; profile: Profile } | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [chatOpen, setChatOpen] = useState(!isSolo);
  const [copied, setCopied] = useState(false);
  const [externalControl, setExternalControl] = useState<{ type: 'play' | 'pause' | 'seek'; timestamp: number } | null>(null);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);

  useEffect(() => {
    loadData();
  }, [movieId]);

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [movieRes, profileRes] = await Promise.all([
      supabase.from('movies').select('*').eq('id', movieId).single(),
      supabase.from('profiles').select('*').eq('user_id', user.id).single(),
    ]);

    if (movieRes.data) {
      setMovie(movieRes.data);
      const res = await fetch(`/api/movies/stream?blobName=${encodeURIComponent(movieRes.data.blob_name)}`);
      if (res.ok) {
        const { url } = await res.json();
        setVideoUrl(url);
      }
    }
    if (profileRes.data) setCurrentUser({ id: user.id, profile: profileRes.data });
    setLoading(false);
  }

  // Watch room hook (always called, but disabled for solo rooms)
  const watchRoom = useWatchRoom({
    roomId,
    userId: currentUser?.id || '',
    userName: currentUser ? `${currentUser.profile.first_name} ${currentUser.profile.last_name}` : '',
    avatarUrl: currentUser?.profile.avatar_url || null,
    enabled: !isSolo && !!currentUser,
  });

  const isWatchTogether = !isSolo && !!currentUser;

  // Subscribe to room status — redirect everyone when host ends session
  useEffect(() => {
    if (isSolo) return;
    const channel = supabase
      .channel('room-status-' + roomId)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'watch_rooms',
        filter: `id=eq.${roomId}`,
      }, (payload) => {
        if (payload.new.is_active === false) {
          router.push('/browse');
        }
      })
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [roomId, isSolo]);

  // Handle incoming playback events from the room
  useEffect(() => {
    if (!isWatchTogether || !watchRoom.lastPlaybackEvent) return;
    const evt = watchRoom.lastPlaybackEvent;
    setExternalControl({ type: evt.type as 'play' | 'pause' | 'seek', timestamp: evt.timestamp });
  }, [watchRoom.lastPlaybackEvent, isWatchTogether]);

  const handlePlaybackEvent = (event: { type: 'play' | 'pause' | 'seek'; timestamp: number }) => {
    if (isWatchTogether) {
      watchRoom.sendPlaybackEvent({
        type: event.type,
        timestamp: event.timestamp,
      });
    }

    // Record watch history progress
    if (currentUser && movie && event.type === 'pause') {
      supabase.from('watch_history').upsert({
        user_id: currentUser.id,
        movie_id: movie.id,
        progress_seconds: Math.floor(event.timestamp),
        completed: false,
        watched_at: new Date().toISOString(),
      }, { onConflict: 'user_id,movie_id' }).then(() => {});
    }
  };

  const copyRoomLink = () => {
    const url = `${window.location.origin}/watch/${movieId}/room/${roomId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEndSession = async () => {
    // Mark room inactive — triggers subscription above for all participants
    await supabase.from('watch_rooms').update({ is_active: false }).eq('id', roomId);
    // Clear all pending invites for this room
    await supabase.from('watch_invites').update({ status: 'declined' }).eq('room_id', roomId).eq('status', 'pending');
    router.push('/browse');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-cinema-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-cinema-accent/20 flex items-center justify-center mx-auto mb-4 animate-pulse">
            <span className="text-2xl">🎬</span>
          </div>
          <p className="text-cinema-text-muted">Loading your movie...</p>
        </div>
      </div>
    );
  }

  if (!movie || !videoUrl) {
    return (
      <div className="min-h-screen bg-cinema-bg flex items-center justify-center">
        <div className="text-center">
          <h1 className="font-display text-2xl font-bold text-cinema-text mb-4">Could not load movie</h1>
          <Link href="/browse"><Button variant="secondary">Back to Browse</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-black">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-cinema-bg/90 backdrop-blur-sm border-b border-cinema-border/30 z-20">
        <div className="flex items-center gap-4">
          <Link href={`/movie/${movieId}`} className="text-cinema-text-muted hover:text-cinema-text transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="font-display text-lg font-semibold text-cinema-text truncate max-w-xs sm:max-w-md">
              {movie.title}
            </h1>
            {!isSolo && (
              <div className="flex items-center gap-2 text-xs text-cinema-text-muted">
                <Users className="w-3 h-3 text-cinema-warm" />
                <span>Watching Together</span>
                {watchRoom.presence && (
                  <span className="text-cinema-accent">
                    ({watchRoom.presence.length} {watchRoom.presence.length === 1 ? 'person' : 'people'})
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isSolo && (
            <>
              <Button
                variant="ghost"
                size="sm"
                icon={copied ? <Check className="w-4 h-4 text-cinema-success" /> : <Copy className="w-4 h-4" />}
                onClick={copyRoomLink}
              >
                {copied ? 'Copied!' : 'Share Link'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<UserPlus className="w-4 h-4" />}
                onClick={() => setShowInviteModal(true)}
              >
                Invite Friend
              </Button>
              <Button
                variant="danger"
                size="sm"
                icon={<Power className="w-4 h-4" />}
                onClick={() => setShowEndConfirm(true)}
              >
                End Session
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Video area */}
        <div className="flex-1 relative bg-black">
          <VideoPlayer
            src={videoUrl}
            subtitles={(movie as any).subtitles || []}
            initialTime={isWatchTogether ? watchRoom.savedTime : 0}
            onPlaybackEvent={handlePlaybackEvent}
            externalControl={externalControl}
            className="w-full h-full"
          />
        </div>

        {/* Chat panel */}
        {isWatchTogether && currentUser && (
          <ChatPanel
            messages={watchRoom.messages}
            presence={watchRoom.presence}
            onSendMessage={watchRoom.sendMessage}
            currentUserId={currentUser.id}
            isOpen={chatOpen}
            onToggle={() => setChatOpen(!chatOpen)}
          />
        )}
      </div>

      {/* End session confirmation */}
      {showEndConfirm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowEndConfirm(false)}>
          <div className="bg-cinema-card border border-cinema-border rounded-2xl p-6 max-w-sm w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-cinema-error/10 flex items-center justify-center mx-auto mb-4">
                <Power className="w-7 h-7 text-cinema-error" />
              </div>
              <h3 className="font-display text-xl font-semibold text-cinema-text mb-2">End Session?</h3>
              <p className="text-cinema-text-muted text-sm">
                This will end the watch session for everyone. Your progress will be saved.
              </p>
            </div>
            <div className="flex gap-3">
              <Button variant="ghost" className="flex-1" onClick={() => setShowEndConfirm(false)}>
                Cancel
              </Button>
              <Button variant="danger" className="flex-1" onClick={handleEndSession}>
                End Session
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Invite friend modal */}
      {showInviteModal && movie && (
        <InviteFriendModal
          roomId={roomId}
          movieId={movieId}
          movieTitle={movie.title}
          onClose={() => setShowInviteModal(false)}
        />
      )}
    </div>
  );
}