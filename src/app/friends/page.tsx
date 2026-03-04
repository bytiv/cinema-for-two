'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Profile, Friendship, Postcard } from '@/types';
import Navbar from '@/components/layout/Navbar';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Image from 'next/image';
import Link from 'next/link';
import {
  UserPlus, Users, Mail, Check, X, Clock, Heart,
  ChevronDown, ChevronUp, Inbox, Send as SendIcon
} from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';

type Tab = 'friends' | 'requests' | 'sent';

export default function FriendsPage() {
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [friends, setFriends] = useState<(Friendship & { friendProfile: Profile })[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<(Friendship & { friendProfile: Profile })[]>([]);
  const [sentRequests, setSentRequests] = useState<(Friendship & { friendProfile: Profile })[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('friends');
  const [email, setEmail] = useState('');
  const [sendLoading, setSendLoading] = useState(false);
  const [sendResult, setSendResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [expandedFriend, setExpandedFriend] = useState<string | null>(null);
  const [friendPostcards, setFriendPostcards] = useState<Record<string, Postcard[]>>({});
  const [selectedPostcard, setSelectedPostcard] = useState<Postcard | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    // Update last_seen
    await supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('user_id', user.id);

    // Get all friendships involving this user
    const { data: friendships } = await supabase
      .from('friendships')
      .select('*, requester:profiles!friendships_requester_id_fkey(*), addressee:profiles!friendships_addressee_id_fkey(*)')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

    if (friendships) {
      const accepted: (Friendship & { friendProfile: Profile })[] = [];
      const incoming: (Friendship & { friendProfile: Profile })[] = [];
      const sent: (Friendship & { friendProfile: Profile })[] = [];

      for (const f of friendships) {
        const isRequester = f.requester_id === user.id;
        const friendProfile = isRequester ? f.addressee : f.requester;

        const enriched = { ...f, friendProfile } as Friendship & { friendProfile: Profile };

        if (f.status === 'accepted') {
          accepted.push(enriched);
        } else if (f.status === 'pending') {
          if (isRequester) {
            sent.push(enriched);
          } else {
            incoming.push(enriched);
          }
        }
      }

      setFriends(accepted);
      setIncomingRequests(incoming);
      setSentRequests(sent);
    }

    setLoading(false);
  }

  async function handleSendRequest() {
    if (!email.trim() || !userId) return;
    setSendLoading(true);
    setSendResult(null);

    // Find user by email via auth — we'll look up profiles
    // Since we can't query auth.users directly, we look for a profile
    // We need a workaround: check if any profile's user has that email
    // We'll use an API route or RPC, but for simplicity, look up profiles
    // Actually, supabase client can't query auth.users. We need to search by email differently.
    // Workaround: we'll search profiles and match — but profiles don't store email.
    // Best approach: use the Supabase admin API or create an RPC.
    // For now, let's use the friends API route.

    try {
      const res = await fetch('/api/friends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await res.json();
      if (res.ok) {
        setSendResult({ type: 'success', message: `Friend request sent to ${email}!` });
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

  async function loadFriendPostcards(friendUserId: string) {
    if (friendPostcards[friendUserId]) {
      setExpandedFriend(expandedFriend === friendUserId ? null : friendUserId);
      return;
    }

    const { data } = await supabase
      .from('postcards')
      .select('*')
      .eq('user_id', friendUserId)
      .order('created_at');

    if (data) {
      setFriendPostcards((prev) => ({ ...prev, [friendUserId]: data }));
    }
    setExpandedFriend(friendUserId);
  }

  function isOnline(lastSeen: string | null): boolean {
    if (!lastSeen) return false;
    const diff = Date.now() - new Date(lastSeen).getTime();
    return diff < 30 * 60 * 1000; // 30 minutes
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
            <Button
              onClick={handleSendRequest}
              loading={sendLoading}
              disabled={!email.trim()}
              icon={<Heart className="w-4 h-4" />}
            >
              Send
            </Button>
          </div>
          {sendResult && (
            <p className={cn(
              'text-sm mt-3 px-3 py-2 rounded-xl',
              sendResult.type === 'success'
                ? 'bg-cinema-success/10 text-cinema-success'
                : 'bg-cinema-error/10 text-cinema-error'
            )}>
              {sendResult.message}
            </p>
          )}
        </div>

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
                <span className={cn(
                  'text-xs px-1.5 py-0.5 rounded-full',
                  tab === key ? 'bg-cinema-accent/20' : 'bg-cinema-card'
                )}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
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
                    const online = isOnline(fp.last_seen_at);
                    const isExpanded = expandedFriend === fp.user_id;
                    const postcards = friendPostcards[fp.user_id] || [];

                    return (
                      <div key={f.id} className="bg-cinema-card/50 border border-cinema-border rounded-2xl overflow-hidden">
                        <div
                          className="flex items-center justify-between p-4 cursor-pointer hover:bg-cinema-surface/30 transition-colors"
                          onClick={() => loadFriendPostcards(fp.user_id)}
                        >
                          <div className="flex items-center gap-3">
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
                              {/* Online indicator */}
                              <div className={cn(
                                'absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-cinema-card',
                                online ? 'bg-cinema-success' : 'bg-cinema-text-dim'
                              )} />
                            </div>
                            <div>
                              <Link
                            href={`/user/${fp.user_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-medium text-cinema-text hover:text-cinema-accent transition-colors"
                          >
                            {fp.first_name} {fp.last_name}
                          </Link>
                              <p className="text-xs text-cinema-text-dim">
                                {online ? (
                                  <span className="text-cinema-success">Online now</span>
                                ) : fp.last_seen_at ? (
                                  `Last seen ${formatRelativeTime(fp.last_seen_at)}`
                                ) : (
                                  'Never seen'
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-cinema-text-dim">Postcards</span>
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-cinema-text-muted" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-cinema-text-muted" />
                            )}
                          </div>
                        </div>

                        {/* Expanded postcards */}
                        {isExpanded && (
                          <div className="px-4 pb-4 border-t border-cinema-border/50 pt-3">
                            {postcards.length === 0 ? (
                              <p className="text-sm text-cinema-text-dim text-center py-4">
                                No postcards yet
                              </p>
                            ) : (
                              <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                                {postcards.map((pc) => (
                                  <div
                                    key={pc.id}
                                    className="relative rounded-lg overflow-hidden aspect-[3/4] bg-cinema-surface cursor-pointer group transition-transform duration-300 hover:scale-105 hover:z-10 hover:shadow-2xl hover:shadow-cinema-accent/20"
                                    onClick={() => setSelectedPostcard(pc)}
                                  >
                                    <Image
                                      src={pc.image_url}
                                      alt={pc.caption || 'Postcard'}
                                      fill
                                      className="object-cover transition-transform duration-300 group-hover:scale-110"
                                      sizes="120px"
                                    />
                                    {pc.caption && (
                                      <div className="absolute bottom-0 left-0 right-0 bg-white/90 py-1 px-1.5">
                                        <p className="text-[8px] text-gray-600 text-center truncate">
                                          {pc.caption}
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
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
                          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-cinema-accent to-cinema-secondary flex items-center justify-center">
                            <span className="text-sm font-bold text-cinema-bg">
                              {fp.first_name.charAt(0)}{fp.last_name.charAt(0)}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-cinema-text">{fp.first_name} {fp.last_name}</p>
                            <p className="text-xs text-cinema-text-dim">
                              Sent {formatRelativeTime(f.created_at)}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleAccept(f.id)}
                            className="w-9 h-9 rounded-lg bg-cinema-success/10 hover:bg-cinema-success/20 flex items-center justify-center transition-colors"
                            title="Accept"
                          >
                            <Check className="w-4 h-4 text-cinema-success" />
                          </button>
                          <button
                            onClick={() => handleDeny(f.id)}
                            className="w-9 h-9 rounded-lg bg-cinema-error/10 hover:bg-cinema-error/20 flex items-center justify-center transition-colors"
                            title="Deny"
                          >
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
                          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-cinema-warm to-cinema-accent flex items-center justify-center">
                            <span className="text-sm font-bold text-cinema-bg">
                              {fp.first_name.charAt(0)}{fp.last_name.charAt(0)}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-cinema-text">{fp.first_name} {fp.last_name}</p>
                            <p className="text-xs text-cinema-text-dim flex items-center gap-1">
                              <Clock className="w-3 h-3" /> Pending
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeny(f.id)}
                          className="text-xs text-cinema-text-dim hover:text-cinema-error transition-colors"
                        >
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

      {/* Postcard full-view modal */}
      {selectedPostcard && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedPostcard(null)}
        >
          <div
            className="relative max-w-lg w-full animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
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
                  <p className="text-sm text-gray-700 text-center font-body">
                    {selectedPostcard.caption}
                  </p>
                </div>
              )}
            </div>
            <button
              onClick={() => setSelectedPostcard(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-cinema-card border border-cinema-border flex items-center justify-center hover:bg-cinema-error transition-colors"
            >
              <X className="w-4 h-4 text-cinema-text" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}