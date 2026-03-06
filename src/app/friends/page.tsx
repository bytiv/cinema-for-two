'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Profile, Friendship } from '@/types';
import Navbar from '@/components/layout/Navbar';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Image from 'next/image';
import Link from 'next/link';
import {
  UserPlus, Users, Mail, Check, X, Clock, Heart,
  Inbox, Send as SendIcon, UserMinus, Film, Play
} from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';

type Tab = 'friends' | 'requests' | 'sent';

export default function FriendsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [friends, setFriends] = useState<(Friendship & { friendProfile: Profile })[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<(Friendship & { friendProfile: Profile })[]>([]);
  const [sentRequests, setSentRequests] = useState<(Friendship & { friendProfile: Profile })[]>([]);
  const [watchInvites, setWatchInvites] = useState<{ id: string; room_id: string; movie_id: string; from_user_id: string; fromName: string; movieTitle: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('friends');
  const [email, setEmail] = useState('');
  const [sendLoading, setSendLoading] = useState(false);
  const [sendResult, setSendResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmUnfriend, setConfirmUnfriend] = useState<string | null>(null);

  useEffect(() => {
    loadData();

    let channel: any;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      channel = supabase
        .channel('friends-watch-invites-' + user.id)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'watch_invites',
          filter: `to_user_id=eq.${user.id}`,
        }, () => loadData())
        .subscribe();
    });

    return () => { channel?.unsubscribe(); };
  }, []);

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    await supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('user_id', user.id);

    const [{ data: asRequester }, { data: asAddressee }] = await Promise.all([
      supabase.from('friendships').select('id, requester_id, addressee_id, status, created_at, updated_at').eq('requester_id', user.id),
      supabase.from('friendships').select('id, requester_id, addressee_id, status, created_at, updated_at').eq('addressee_id', user.id),
    ]);

    const profileIds = new Set<string>();
    asRequester?.forEach((f) => profileIds.add(f.addressee_id));
    asAddressee?.forEach((f) => profileIds.add(f.requester_id));

    let profileMap = new Map<string, Profile>();
    if (profileIds.size > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('user_id', Array.from(profileIds));
      if (profiles) profiles.forEach((p) => profileMap.set(p.user_id, p));
    }

    const accepted: (Friendship & { friendProfile: Profile })[] = [];
    const incoming: (Friendship & { friendProfile: Profile })[] = [];
    const sent: (Friendship & { friendProfile: Profile })[] = [];

    asRequester?.forEach((f) => {
      const fp = profileMap.get(f.addressee_id);
      if (!fp) return;
      const enriched = { ...f, friendProfile: fp } as Friendship & { friendProfile: Profile };
      if (f.status === 'accepted') accepted.push(enriched);
      else if (f.status === 'pending') sent.push(enriched);
    });

    asAddressee?.forEach((f) => {
      const fp = profileMap.get(f.requester_id);
      if (!fp) return;
      const enriched = { ...f, friendProfile: fp } as Friendship & { friendProfile: Profile };
      if (f.status === 'accepted') accepted.push(enriched);
      else if (f.status === 'pending') incoming.push(enriched);
    });

    setFriends(accepted);
    setIncomingRequests(incoming);
    setSentRequests(sent);
    setLoading(false);

    const { data: inviteData } = await supabase
      .from('watch_invites')
      .select('*')
      .eq('to_user_id', user.id)
      .eq('status', 'pending');

    if (inviteData && inviteData.length > 0) {
      const enriched = await Promise.all(inviteData.map(async (inv) => {
        const [{ data: profile }, { data: movie }] = await Promise.all([
          supabase.from('profiles').select('first_name, last_name').eq('user_id', inv.from_user_id).single(),
          supabase.from('movies').select('title').eq('id', inv.movie_id).single(),
        ]);
        return {
          id: inv.id,
          room_id: inv.room_id,
          movie_id: inv.movie_id,
          from_user_id: inv.from_user_id,
          fromName: profile ? `${profile.first_name} ${profile.last_name}` : 'Someone',
          movieTitle: movie?.title || 'a movie',
        };
      }));
      setWatchInvites(enriched);
    } else {
      setWatchInvites([]);
    }
  }

  async function handleSendRequest() {
    if (!email.trim() || !userId) return;
    setSendLoading(true);
    setSendResult(null);

    try {
      const res = await fetch('/api/friends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await res.json();
      if (res.ok) {
        const msg = data.autoAccepted
          ? `You're now friends! They had already sent you a request.`
          : `Friend request sent to ${email}!`;
        setSendResult({ type: 'success', message: msg });
        setEmail('');
        loadData();
      } else {
        setSendResult({ type: 'error', message: data.error || 'Failed to send request' });
      }
    } catch {
      setSendResult({ type: 'error', message: 'Something went wrong' });
    }

    setSendLoading(false);
    setTimeout(() => setSendResult(null), 5000);
  }

  async function handleAccept(friendshipId: string) {
    await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId);
    loadData();
  }

  async function handleDeny(friendshipId: string) {
    await supabase.from('friendships').delete().eq('id', friendshipId);
    loadData();
  }

  function isOnline(lastSeen: string | null, hideOnline?: boolean): boolean {
    if (hideOnline) return false;
    if (!lastSeen) return false;
    return Date.now() - new Date(lastSeen).getTime() < 60 * 1000;
  }

  async function handleAcceptInvite(inviteId: string, movieId: string, roomId: string) {
    await supabase.from('watch_invites').update({ status: 'accepted' }).eq('id', inviteId);
    router.push(`/watch/${movieId}/room/${roomId}`);
  }

  async function handleDeclineInvite(inviteId: string) {
    await supabase.from('watch_invites').update({ status: 'declined' }).eq('id', inviteId);
    setWatchInvites((prev) => prev.filter((i) => i.id !== inviteId));
  }

  const tabs: { key: Tab; label: string; icon: any; count?: number }[] = [
    { key: 'friends', label: 'Friends', icon: Users, count: friends.length },
    { key: 'requests', label: 'Requests', icon: Inbox, count: incomingRequests.length },
    { key: 'sent', label: 'Sent', icon: SendIcon, count: sentRequests.length },
  ];

  return (
    <div className="min-h-screen">
      <Navbar />

      <main className="relative z-10 pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold text-cinema-text mb-2">
            Friends <span className="text-cinema-accent">💜</span>
          </h1>
          <p className="text-cinema-text-muted">Connect with your movie buddies</p>
        </div>

        {/* Send friend request */}
        <div className="bg-cinema-card/50 backdrop-blur-sm border border-cinema-border rounded-2xl p-5 mb-6">
          <h3 className="font-display text-lg font-semibold text-cinema-text flex items-center gap-2 mb-4">
            <UserPlus className="w-5 h-5 text-cinema-accent" />
            Send Friend Request
          </h3>
          <div className="flex gap-3">
            <div className="flex-1">
              <Input
                id="friendEmail"
                type="email"
                placeholder="Enter their email address"
                icon={<Mail className="w-4 h-4" />}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendRequest()}
              />
            </div>
            <Button onClick={handleSendRequest} loading={sendLoading} disabled={!email.trim()} icon={<Heart className="w-4 h-4" />}>
              Send
            </Button>
          </div>
          {sendResult && (
            <p className={cn('text-sm mt-3 px-3 py-2 rounded-xl', sendResult.type === 'success' ? 'bg-cinema-success/10 text-cinema-success' : 'bg-cinema-error/10 text-cinema-error')}>
              {sendResult.message}
            </p>
          )}
        </div>

        {/* Watch invites */}
        {watchInvites.length > 0 && (
          <div className="mb-6 space-y-2">
            <p className="text-xs font-semibold text-cinema-text-muted uppercase tracking-wider flex items-center gap-1.5 px-1">
              <Film className="w-3.5 h-3.5 text-cinema-accent" /> Watch Invitations
            </p>
            {watchInvites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between p-4 rounded-2xl border border-cinema-accent/25"
                style={{ background: 'linear-gradient(135deg, rgba(232,160,191,0.07) 0%, rgba(167,139,250,0.05) 100%)' }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-cinema-accent/15 flex items-center justify-center flex-shrink-0">
                    <Film className="w-5 h-5 text-cinema-accent" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-cinema-text">
                      <span className="text-cinema-accent">{inv.fromName}</span> is inviting you to watch
                    </p>
                    <p className="text-xs text-cinema-text-dim mt-0.5">🎬 {inv.movieTitle}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleAcceptInvite(inv.id, inv.movie_id, inv.room_id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-cinema-accent/20 text-cinema-accent hover:bg-cinema-accent/30 border border-cinema-accent/25 transition-colors"
                  >
                    <Play className="w-3 h-3" /> Join
                  </button>
                  <button
                    onClick={() => handleDeclineInvite(inv.id)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-cinema-text-dim hover:text-cinema-error hover:bg-cinema-error/10 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {tabs.map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all',
                tab === key
                  ? 'bg-cinema-accent/15 text-cinema-accent border border-cinema-accent/30'
                  : 'bg-cinema-card border border-cinema-border text-cinema-text-muted hover:text-cinema-text'
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
              {count !== undefined && count > 0 && (
                <span className={cn('text-xs px-1.5 py-0.5 rounded-full', tab === key ? 'bg-cinema-accent/20' : 'bg-cinema-card')}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-20 shimmer rounded-2xl" />)}
          </div>
        ) : (
          <>
            {/* Friends list */}
            {tab === 'friends' && (
              <div className="space-y-3">
                {friends.length === 0 ? (
                  <div className="text-center py-16">
                    <Users className="w-12 h-12 text-cinema-text-dim mx-auto mb-4" />
                    <p className="text-cinema-text-muted">No friends yet. Send a request above!</p>
                  </div>
                ) : (
                  friends.map((f) => {
                    const fp = f.friendProfile;
                    const online = isOnline(fp.last_seen_at, fp.hide_online_status);

                    return (
                      <div key={f.id} className="bg-cinema-card/50 border border-cinema-border rounded-2xl">
                        <div className="flex items-center justify-between p-4">
                          <Link href={`/user/${fp.user_id}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                            <div className="relative">
                              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-cinema-accent to-cinema-secondary flex items-center justify-center overflow-hidden">
                                {fp.avatar_url ? (
                                  <Image src={fp.avatar_url} alt="" width={44} height={44} className="object-cover" />
                                ) : (
                                  <span className="text-sm font-bold text-cinema-bg">
                                    {fp.first_name.charAt(0)}{fp.last_name.charAt(0)}
                                  </span>
                                )}
                              </div>
                              <div className={cn('absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-cinema-card', online ? 'bg-cinema-success' : 'bg-cinema-text-dim')} />
                            </div>
                            <div>
                              <p className="font-medium text-cinema-text">{fp.first_name} {fp.last_name}</p>
                              <p className="text-xs text-cinema-text-dim">
                                {online ? <span className="text-cinema-success">Online now</span> : fp.last_seen_at ? `Last seen ${formatRelativeTime(fp.last_seen_at)}` : 'Never seen'}
                              </p>
                            </div>
                          </Link>
                          {/* Unfriend */}
                          {confirmUnfriend === f.id ? (
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => { handleDeny(f.id); setConfirmUnfriend(null); }} className="text-xs px-2 py-1 rounded-lg bg-cinema-error/15 text-cinema-error hover:bg-cinema-error/25 transition-colors">
                                Unfriend
                              </button>
                              <button onClick={() => setConfirmUnfriend(null)} className="text-xs px-2 py-1 rounded-lg bg-cinema-card text-cinema-text-muted hover:text-cinema-text transition-colors">
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmUnfriend(f.id)} className="w-7 h-7 rounded-lg flex items-center justify-center text-cinema-text-dim hover:text-cinema-error hover:bg-cinema-error/10 transition-colors" title="Unfriend">
                              <UserMinus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Incoming requests */}
            {tab === 'requests' && (
              <div className="space-y-3">
                {incomingRequests.length === 0 ? (
                  <div className="text-center py-16">
                    <Inbox className="w-12 h-12 text-cinema-text-dim mx-auto mb-4" />
                    <p className="text-cinema-text-muted">No pending requests</p>
                  </div>
                ) : (
                  incomingRequests.map((f) => {
                    const fp = f.friendProfile;
                    return (
                      <div key={f.id} className="flex items-center justify-between p-4 bg-cinema-card/50 border border-cinema-border rounded-2xl">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-cinema-accent to-cinema-secondary flex items-center justify-center overflow-hidden">
                            {fp.avatar_url ? (
                              <Image src={fp.avatar_url} alt="" width={44} height={44} className="object-cover" />
                            ) : (
                              <span className="text-sm font-bold text-cinema-bg">{fp.first_name.charAt(0)}{fp.last_name.charAt(0)}</span>
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-cinema-text">{fp.first_name} {fp.last_name}</p>
                            <p className="text-xs text-cinema-text-dim">Sent {formatRelativeTime(f.created_at)}</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => handleAccept(f.id)} className="w-9 h-9 rounded-lg bg-cinema-success/10 hover:bg-cinema-success/20 flex items-center justify-center transition-colors" title="Accept">
                            <Check className="w-4 h-4 text-cinema-success" />
                          </button>
                          <button onClick={() => handleDeny(f.id)} className="w-9 h-9 rounded-lg bg-cinema-error/10 hover:bg-cinema-error/20 flex items-center justify-center transition-colors" title="Deny">
                            <X className="w-4 h-4 text-cinema-error" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Sent requests */}
            {tab === 'sent' && (
              <div className="space-y-3">
                {sentRequests.length === 0 ? (
                  <div className="text-center py-16">
                    <SendIcon className="w-12 h-12 text-cinema-text-dim mx-auto mb-4" />
                    <p className="text-cinema-text-muted">No sent requests</p>
                  </div>
                ) : (
                  sentRequests.map((f) => {
                    const fp = f.friendProfile;
                    return (
                      <div key={f.id} className="flex items-center justify-between p-4 bg-cinema-card/50 border border-cinema-border rounded-2xl">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-cinema-warm to-cinema-accent flex items-center justify-center overflow-hidden">
                            {fp.avatar_url ? (
                              <Image src={fp.avatar_url} alt="" width={44} height={44} className="object-cover" />
                            ) : (
                              <span className="text-sm font-bold text-cinema-bg">{fp.first_name.charAt(0)}{fp.last_name.charAt(0)}</span>
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-cinema-text">{fp.first_name} {fp.last_name}</p>
                            <p className="text-xs text-cinema-text-dim flex items-center gap-1"><Clock className="w-3 h-3" /> Pending</p>
                          </div>
                        </div>
                        <button onClick={() => handleDeny(f.id)} className="text-xs text-cinema-text-dim hover:text-cinema-error transition-colors">
                          Cancel
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}