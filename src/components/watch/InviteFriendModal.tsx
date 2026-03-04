'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { X, UserPlus, Check, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Profile } from '@/types';

interface InviteFriendModalProps {
  roomId: string;
  movieId: string;
  movieTitle: string;
  onClose: () => void;
}

export default function InviteFriendModal({ roomId, movieId, movieTitle, onClose }: InviteFriendModalProps) {
  const supabase = createClient();
  const [friends, setFriends] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState<string | null>(null);
  const [invited, setInvited] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadFriends();
  }, []);

  async function loadFriends() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [{ data: asRequester }, { data: asAddressee }] = await Promise.all([
      supabase.from('friendships').select('addressee_id').eq('requester_id', user.id).eq('status', 'accepted'),
      supabase.from('friendships').select('requester_id').eq('addressee_id', user.id).eq('status', 'accepted'),
    ]);

    const friendIds: string[] = [];
    asRequester?.forEach((f) => friendIds.push(f.addressee_id));
    asAddressee?.forEach((f) => friendIds.push(f.requester_id));

    if (friendIds.length === 0) { setLoading(false); return; }

    const { data: profiles } = await supabase
      .from('profiles').select('*').in('user_id', friendIds);

    if (profiles) setFriends(profiles);

    // Check who already has a pending invite for this room
    const { data: existing } = await supabase
      .from('watch_invites')
      .select('to_user_id')
      .eq('room_id', roomId)
      .eq('status', 'pending');

    if (existing) {
      setInvited(new Set(existing.map((i) => i.to_user_id)));
    }

    setLoading(false);
  }

  async function handleInvite(friendId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setInviting(friendId);

    await supabase.from('watch_invites').upsert({
      room_id: roomId,
      movie_id: movieId,
      from_user_id: user.id,
      to_user_id: friendId,
      status: 'pending',
    }, { onConflict: 'room_id,to_user_id' });

    setInvited((prev) => new Set([...prev, friendId]));
    setInviting(null);
  }

  function isOnline(lastSeen: string | null) {
    if (!lastSeen) return false;
    return Date.now() - new Date(lastSeen).getTime() < 30 * 60 * 1000;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(8,4,16,0.8)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl border border-cinema-border"
        style={{ background: 'linear-gradient(160deg, #1e1530 0%, #160f24 100%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-cinema-border/50">
          <div>
            <h3 className="font-display text-lg font-semibold text-cinema-text flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-cinema-accent" />
              Invite a Friend
            </h3>
            <p className="text-xs text-cinema-text-dim mt-0.5 truncate max-w-[200px]">
              {movieTitle}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-cinema-text-dim hover:text-cinema-text hover:bg-cinema-surface transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Friends list */}
        <div className="p-3 space-y-1 max-h-80 overflow-y-auto">
          {loading ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="w-6 h-6 text-cinema-accent animate-spin" />
            </div>
          ) : friends.length === 0 ? (
            <div className="py-8 text-center text-cinema-text-muted text-sm">
              No friends yet. Add some friends first!
            </div>
          ) : (
            friends.map((friend) => {
              const online = isOnline(friend.last_seen_at);
              const isInvited = invited.has(friend.user_id);
              const isInviting = inviting === friend.user_id;

              return (
                <div
                  key={friend.user_id}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-cinema-surface/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cinema-accent to-cinema-secondary flex items-center justify-center overflow-hidden">
                        {friend.avatar_url ? (
                          <Image src={friend.avatar_url} alt="" width={36} height={36} className="object-cover" />
                        ) : (
                          <span className="text-xs font-bold text-cinema-bg">
                            {friend.first_name.charAt(0)}{friend.last_name.charAt(0)}
                          </span>
                        )}
                      </div>
                      <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-cinema-card ${online ? 'bg-cinema-success' : 'bg-cinema-text-dim'}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-cinema-text">
                        {friend.first_name} {friend.last_name}
                      </p>
                      <p className="text-xs text-cinema-text-dim">
                        {online ? <span className="text-cinema-success">Online now</span> : 'Offline'}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => !isInvited && handleInvite(friend.user_id)}
                    disabled={isInvited || isInviting}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isInvited
                        ? 'bg-cinema-success/10 text-cinema-success cursor-default'
                        : 'bg-cinema-accent/15 text-cinema-accent hover:bg-cinema-accent/25 border border-cinema-accent/20'
                    }`}
                  >
                    {isInviting ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : isInvited ? (
                      <><Check className="w-3 h-3" /> Invited</>
                    ) : (
                      <><UserPlus className="w-3 h-3" /> Invite</>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}