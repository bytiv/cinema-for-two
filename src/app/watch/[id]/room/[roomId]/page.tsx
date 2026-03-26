'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Movie, Profile, PlaybackEvent, QualityVariant } from '@/types';
import VideoPlayer from '@/components/watch/VideoPlayer';
import ChatPanel from '@/components/watch/ChatPanel';
import Button from '@/components/ui/Button';
import { useWatchRoom } from '@/hooks/useWatchRoom';
import { ArrowLeft, Copy, Check, Users, Power, UserPlus, MessageCircle, X } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import InviteFriendModal from '@/components/watch/InviteFriendModal';

export default function WatchRoomPage() {
  const params   = useParams();
  const router   = useRouter();
  const supabase = createClient();
  const movieId  = params.id as string;
  const roomId   = params.roomId as string;
  const isSolo   = roomId === 'solo';

  const [movie,           setMovie]           = useState<Movie | null>(null);
  const [currentUser,     setCurrentUser]     = useState<{ id: string; profile: Profile } | null>(null);
  const [videoUrl,        setVideoUrl]        = useState<string | null>(null);
  const [videoVariants,   setVideoVariants]   = useState<{ quality: string; url: string }[] | null>(null);
  const [hlsMasterUrl,    setHlsMasterUrl]    = useState<string | null>(null);
  const [loading,         setLoading]         = useState(true);
  const [chatOpen,        setChatOpen]        = useState(false);   // mobile: drawer closed by default
  const [desktopChat,     setDesktopChat]     = useState(true);    // desktop sidebar
  const [copied,          setCopied]          = useState(false);
  const [externalControl, setExternalControl] = useState<{ type: 'play' | 'pause' | 'seek'; timestamp: number } | null>(null);
  const [showEndConfirm,  setShowEndConfirm]  = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [isMobile,        setIsMobile]        = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => { loadData(); }, [movieId]);

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [movieRes, profileRes] = await Promise.all([
      supabase.from('movies').select('*').eq('id', movieId).single(),
      supabase.from('profiles').select('*').eq('user_id', user.id).single(),
    ]);

    if (!isSolo && roomId) {
      await supabase.from('watch_room_participants').upsert(
        { room_id: roomId, user_id: user.id },
        { onConflict: 'room_id,user_id', ignoreDuplicates: true }
      );
    }

    if (movieRes.data) {
      setMovie(movieRes.data);
      const hasVariants = movieRes.data.quality_variants && movieRes.data.quality_variants.length > 0;

      if (hasVariants) {
        // Multi-quality: use movieId-based streaming API
        const res = await fetch(`/api/movies/stream?movieId=${encodeURIComponent(movieRes.data.id)}`);
        if (res.ok) {
          const data = await res.json();
          setVideoUrl(data.url);
          if (data.variants) setVideoVariants(data.variants);
          if (data.hlsMasterUrl) setHlsMasterUrl(data.hlsMasterUrl);
        }
      } else {
        // Legacy single-quality: use blobName
        const res = await fetch(`/api/movies/stream?blobName=${encodeURIComponent(movieRes.data.blob_name)}`);
        if (res.ok) { const { url } = await res.json(); setVideoUrl(url); }
      }
    }
    if (profileRes.data) setCurrentUser({ id: user.id, profile: profileRes.data });
    setLoading(false);
  }

  const watchRoom = useWatchRoom({
    roomId,
    userId:    currentUser?.id || '',
    userName:  currentUser ? `${currentUser.profile.first_name} ${currentUser.profile.last_name}` : '',
    avatarUrl: currentUser?.profile.avatar_url || null,
    enabled:   !isSolo && !!currentUser,
  });

  const isWatchTogether = !isSolo && !!currentUser;

  useEffect(() => {
    if (isSolo) return;
    const channel = supabase
      .channel('room-status-' + roomId)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'watch_rooms', filter: `id=eq.${roomId}` }, (payload) => {
        if (payload.new.is_active === false) router.push('/browse');
      })
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [roomId, isSolo]);

  useEffect(() => {
    if (!isWatchTogether || !watchRoom.lastPlaybackEvent) return;
    const evt = watchRoom.lastPlaybackEvent;
    setExternalControl({ type: evt.type as 'play' | 'pause' | 'seek', timestamp: evt.timestamp });
  }, [watchRoom.lastPlaybackEvent, isWatchTogether]);

  const handlePlaybackEvent = (event: { type: 'play' | 'pause' | 'seek'; timestamp: number }) => {
    if (isWatchTogether) watchRoom.sendPlaybackEvent({ type: event.type, timestamp: event.timestamp });
    if (currentUser && movie && event.type === 'pause') {
      supabase.from('watch_history').upsert({
        user_id: currentUser.id, movie_id: movie.id,
        progress_seconds: Math.floor(event.timestamp), completed: false, watched_at: new Date().toISOString(),
      }, { onConflict: 'user_id,movie_id' }).then(() => {});
    }
  };

  const copyRoomLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/watch/${movieId}/room/${roomId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEndSession = async () => {
    await supabase.from('watch_rooms').update({ is_active: false }).eq('id', roomId);
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

  // ── Unread badge ─────────────────────────────────────────────────────────
  const unreadCount = !chatOpen && isWatchTogether ? watchRoom.messages.filter(m => m.user_id !== currentUser?.id).slice(-1).length : 0;

  return (
    <div className="h-[100dvh] flex flex-col bg-black overflow-hidden">

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 bg-cinema-bg/95 backdrop-blur-sm border-b border-cinema-border/30 z-20 flex-shrink-0">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <Link href={`/movie/${movieId}`} className="text-cinema-text-muted hover:text-cinema-text transition-colors flex-shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="font-display text-sm sm:text-lg font-semibold text-cinema-text truncate max-w-[140px] sm:max-w-xs md:max-w-md">
              {movie.title}
            </h1>
            {!isSolo && (
              <div className="flex items-center gap-1.5 text-xs text-cinema-text-muted">
                <Users className="w-3 h-3 text-cinema-warm flex-shrink-0" />
                <span className="hidden sm:inline">Watching Together</span>
                {watchRoom.presence && (
                  <span className="text-cinema-accent">
                    ({watchRoom.presence.length} {watchRoom.presence.length === 1 ? 'person' : 'people'})
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {!isSolo && (
            <>
              {/* Desktop-only buttons */}
              <div className="hidden sm:flex items-center gap-2">
                <Button variant="ghost" size="sm" icon={copied ? <Check className="w-4 h-4 text-cinema-success" /> : <Copy className="w-4 h-4" />} onClick={copyRoomLink}>
                  {copied ? 'Copied!' : 'Share'}
                </Button>
                <Button variant="secondary" size="sm" icon={<UserPlus className="w-4 h-4" />} onClick={() => setShowInviteModal(true)}>
                  Invite
                </Button>
              </div>
              {/* Mobile: just copy + invite icons */}
              <button
                onClick={copyRoomLink}
                className="sm:hidden w-8 h-8 rounded-lg flex items-center justify-center bg-cinema-surface border border-cinema-border text-cinema-text-muted hover:text-cinema-text transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-cinema-success" /> : <Copy className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setShowInviteModal(true)}
                className="sm:hidden w-8 h-8 rounded-lg flex items-center justify-center bg-cinema-surface border border-cinema-border text-cinema-text-muted hover:text-cinema-text transition-colors"
              >
                <UserPlus className="w-4 h-4" />
              </button>

              {/* Chat toggle button — mobile only */}
              <button
                onClick={() => setChatOpen(v => !v)}
                className="md:hidden relative w-8 h-8 rounded-lg flex items-center justify-center bg-cinema-surface border border-cinema-border text-cinema-text-muted hover:text-cinema-text transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-cinema-accent text-cinema-bg text-[9px] font-bold flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </button>

              <Button variant="danger" size="sm" icon={<Power className="w-3.5 h-3.5 sm:w-4 sm:h-4" />} onClick={() => setShowEndConfirm(true)}>
                <span className="hidden sm:inline">End Session</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Main content area ── */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">

        {/* Video */}
        <div className="relative bg-black flex-1 min-h-0">
          <VideoPlayer
            src={videoUrl}
            subtitles={(movie as any).subtitles || []}
            initialTime={isWatchTogether ? watchRoom.savedTime : 0}
            onPlaybackEvent={handlePlaybackEvent}
            externalControl={externalControl}
            qualityVariants={videoVariants}
            hlsMasterUrl={hlsMasterUrl}
            className="w-full h-full"
          />
        </div>

        {/* Desktop sidebar chat */}
        {isWatchTogether && currentUser && (
          <div className="hidden md:flex">
            <ChatPanel
              messages={watchRoom.messages}
              presence={watchRoom.presence}
              onSendMessage={watchRoom.sendMessage}
              currentUserId={currentUser.id}
              isOpen={desktopChat}
              onToggle={() => setDesktopChat(v => !v)}
            />
          </div>
        )}
      </div>

      {/* ── Mobile chat drawer ── */}
      {isWatchTogether && currentUser && (
        <>
          {/* Backdrop */}
          {chatOpen && (
            <div
              className="md:hidden fixed inset-0 bg-black/60 z-40"
              onClick={() => setChatOpen(false)}
            />
          )}
          {/* Drawer — slides up from bottom */}
          <div
            className={cn(
              'md:hidden fixed bottom-0 left-0 right-0 z-50 flex flex-col',
              'bg-cinema-surface border-t border-cinema-border rounded-t-2xl',
              'transition-transform duration-300 ease-in-out',
              chatOpen ? 'translate-y-0' : 'translate-y-full'
            )}
            style={{ height: '70dvh' }}
          >
            {/* Drawer handle + close */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-cinema-border flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-10 h-1 rounded-full bg-cinema-border mx-auto" />
              </div>
              <span className="font-display font-semibold text-cinema-text text-sm">Chat</span>
              <button onClick={() => setChatOpen(false)} className="text-cinema-text-muted hover:text-cinema-text transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Reuse ChatPanel without its own header toggle */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <ChatPanel
                messages={watchRoom.messages}
                presence={watchRoom.presence}
                onSendMessage={watchRoom.sendMessage}
                currentUserId={currentUser.id}
                isOpen={true}
                onToggle={() => setChatOpen(false)}
                hideSidebarToggle
              />
            </div>
          </div>
        </>
      )}

      {/* ── End session confirm ── */}
      {showEndConfirm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowEndConfirm(false)}>
          <div className="bg-cinema-card border border-cinema-border rounded-2xl p-6 max-w-sm w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-cinema-error/10 flex items-center justify-center mx-auto mb-4">
                <Power className="w-7 h-7 text-cinema-error" />
              </div>
              <h3 className="font-display text-xl font-semibold text-cinema-text mb-2">End Session?</h3>
              <p className="text-cinema-text-muted text-sm">This will end the watch session for everyone. Your progress will be saved.</p>
            </div>
            <div className="flex gap-3">
              <Button variant="ghost" className="flex-1" onClick={() => setShowEndConfirm(false)}>Cancel</Button>
              <Button variant="danger" className="flex-1" onClick={handleEndSession}>End Session</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Invite modal ── */}
      {showInviteModal && movie && (
        <InviteFriendModal roomId={roomId} movieId={movieId} movieTitle={movie.title} onClose={() => setShowInviteModal(false)} />
      )}
    </div>
  );
}