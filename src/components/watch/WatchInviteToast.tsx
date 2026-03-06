'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Film, X, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Invite {
  id: string;
  room_id: string;
  movie_id: string;
  from_user_id: string;
  fromName: string;
  movieTitle: string;
}

export default function WatchInviteToast() {
  const supabase = createClient();
  const router = useRouter();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel>;

    async function setup() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      // Load existing pending invites on mount
      await loadPendingInvites(user.id);

      // Subscribe to new invites in real-time
      channel = supabase
        .channel('watch-invites-' + user.id)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'watch_invites',
          filter: `to_user_id=eq.${user.id}`,
        }, async (payload) => {
          const invite = payload.new as any;
          const enriched = await enrichInvite(invite);
          if (enriched) {
            setInvites((prev) => [...prev.filter(i => i.id !== enriched.id), enriched]);
            // Auto-dismiss after 15 seconds
            setTimeout(() => dismissInvite(enriched.id), 15000);
          }
        })
        .subscribe();
    }

    setup();
    return () => { channel?.unsubscribe(); };
  }, []);

  async function loadPendingInvites(uid: string) {
    const { data } = await supabase
      .from('watch_invites')
      .select('*')
      .eq('to_user_id', uid)
      .eq('status', 'pending');

    if (!data) return;

    const enriched = await Promise.all(data.map(enrichInvite));
    const valid = enriched.filter(Boolean) as Invite[];
    setInvites(valid);

    // Auto-dismiss each after 15s
    valid.forEach((inv) => setTimeout(() => dismissInvite(inv.id), 15000));
  }

  async function enrichInvite(invite: any): Promise<Invite | null> {
    const [{ data: profile }, { data: movie }] = await Promise.all([
      supabase.from('profiles').select('first_name, last_name').eq('user_id', invite.from_user_id).single(),
      supabase.from('movies').select('title').eq('id', invite.movie_id).single(),
    ]);
    if (!profile || !movie) return null;
    return {
      id: invite.id,
      room_id: invite.room_id,
      movie_id: invite.movie_id,
      from_user_id: invite.from_user_id,
      fromName: `${profile.first_name} ${profile.last_name}`,
      movieTitle: movie.title,
    };
  }

  function dismissInvite(id: string) {
    setInvites((prev) => prev.filter((i) => i.id !== id));
  }

  async function handleAccept(invite: Invite) {
    // Wait for DB to confirm before navigating so stream access check passes
    const { error } = await supabase
      .from('watch_invites')
      .update({ status: 'accepted' })
      .eq('id', invite.id);
    if (error) {
      console.error('Failed to accept invite', error);
      return;
    }
    dismissInvite(invite.id);
    router.push(`/watch/${invite.movie_id}/room/${invite.room_id}`);
  }

  async function handleDecline(invite: Invite) {
    await supabase.from('watch_invites').update({ status: 'declined' }).eq('id', invite.id);
    dismissInvite(invite.id);
  }

  if (invites.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 max-w-sm w-full">
      {invites.map((invite) => (
        <div
          key={invite.id}
          className="rounded-2xl border border-cinema-accent/20 p-4 shadow-2xl animate-slide-up"
          style={{
            background: 'linear-gradient(135deg, #1e1530 0%, #160f24 100%)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(232,160,191,0.1)',
          }}
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-cinema-accent/15 flex items-center justify-center flex-shrink-0">
              <Film className="w-5 h-5 text-cinema-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-cinema-text">
                <span className="text-cinema-accent">{invite.fromName}</span> invited you to watch
              </p>
              <p className="text-xs text-cinema-text-muted truncate mt-0.5">
                🎬 {invite.movieTitle}
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => handleAccept(invite)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-cinema-accent/20 text-cinema-accent hover:bg-cinema-accent/30 border border-cinema-accent/25 transition-colors"
                >
                  <Play className="w-3 h-3" /> Join now
                </button>
                <button
                  onClick={() => handleDecline(invite)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-cinema-text-muted hover:text-cinema-text transition-colors"
                >
                  Decline
                </button>
              </div>
            </div>
            <button
              onClick={() => dismissInvite(invite.id)}
              className="text-cinema-text-dim hover:text-cinema-text transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}