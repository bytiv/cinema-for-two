'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PlaybackEvent, ChatMessage, PresenceState } from '@/types';
import { v4 as uuidv4 } from 'uuid';
import { formatDuration } from '@/lib/utils';

interface UseWatchRoomProps {
  roomId: string;
  userId: string;
  userName: string;
  avatarUrl: string | null;
  enabled?: boolean;
}

export function useWatchRoom({ roomId, userId, userName, avatarUrl, enabled = true }: UseWatchRoomProps) {
  const supabase = createClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [presence, setPresence] = useState<PresenceState[]>([]);
  const [lastPlaybackEvent, setLastPlaybackEvent] = useState<PlaybackEvent | null>(null);
  const [savedTime, setSavedTime] = useState<number>(0);
  const [savedIsPlaying, setSavedIsPlaying] = useState<boolean>(false);
  const channelRef = useRef<any>(null);
  const activityIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!enabled) return;
    async function loadRoomState() {
      const { data } = await supabase
        .from('watch_rooms')
        .select('current_time_seconds, is_playing')
        .eq('id', roomId)
        .single();
      if (data) {
        setSavedTime(data.current_time_seconds || 0);
        setSavedIsPlaying(data.is_playing || false);
      }
    }
    loadRoomState();
  }, [roomId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase.channel(`watch-room:${roomId}`, {
      config: {
        broadcast: { self: false }, // we never receive our own broadcasts
        presence: { key: userId },
      },
    });

    // Playback events from the OTHER user — add system message here only
    channel.on('broadcast', { event: 'playback' }, ({ payload }) => {
      if (payload.user_id !== userId) {
        setLastPlaybackEvent(payload as PlaybackEvent);
        let text = '';
        if (payload.type === 'play') text = `${payload.user_name} played`;
        else if (payload.type === 'pause') text = `${payload.user_name} paused`;
        else if (payload.type === 'seek') text = `${payload.user_name} skipped to ${formatDuration(payload.timestamp)}`;
        if (text) {
          setMessages((prev) => [...prev, {
            id: uuidv4(), user_id: 'system', user_name: 'System',
            avatar_url: null, message: text, type: 'system', sent_at: Date.now(),
          } as ChatMessage]);
        }
      }
    });

    // Chat messages from others
    channel.on('broadcast', { event: 'chat' }, ({ payload }) => {
      setMessages((prev) => [...prev, payload as ChatMessage]);
    });

    // Presence — join/leave
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const users: PresenceState[] = [];
        for (const key of Object.keys(state)) {
          const presences = state[key] as any[];
          if (presences.length > 0) users.push(presences[0] as PresenceState);
        }
        setPresence(users);
      })
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        const joined = newPresences?.[0] as any;
        if (joined?.user_id && joined.user_id !== userId) {
          setMessages((prev) => [...prev, {
            id: uuidv4(), user_id: 'system', user_name: 'System',
            avatar_url: null, message: `${joined.user_name} joined`,
            type: 'system', sent_at: Date.now(),
          } as ChatMessage]);
        }
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        const left = leftPresences?.[0] as any;
        if (left?.user_id && left.user_id !== userId) {
          setMessages((prev) => [...prev, {
            id: uuidv4(), user_id: 'system', user_name: 'System',
            avatar_url: null, message: `${left.user_name} left`,
            type: 'system', sent_at: Date.now(),
          } as ChatMessage]);
        }
      });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          user_id: userId,
          user_name: userName,
          avatar_url: avatarUrl,
          online_at: new Date().toISOString(),
        });
      }
    });

    channelRef.current = channel;

    activityIntervalRef.current = setInterval(() => {
      supabase.from('watch_rooms').update({ last_activity_at: new Date().toISOString() }).eq('id', roomId).then(() => {});
    }, 60_000);

    return () => {
      channel.unsubscribe();
      if (activityIntervalRef.current) clearInterval(activityIntervalRef.current);
    };
  }, [roomId, userId, userName, avatarUrl, enabled]);

  const persistStateRef = useRef<NodeJS.Timeout | null>(null);
  const pendingStateRef = useRef<{ current_time_seconds?: number; is_playing?: boolean }>({});

  const persistState = useCallback(
    (updates: { current_time_seconds?: number; is_playing?: boolean }) => {
      pendingStateRef.current = { ...pendingStateRef.current, ...updates };
      if (persistStateRef.current) clearTimeout(persistStateRef.current);
      persistStateRef.current = setTimeout(() => {
        const toSave = { ...pendingStateRef.current, last_activity_at: new Date().toISOString() };
        pendingStateRef.current = {};
        supabase.from('watch_rooms').update(toSave).eq('id', roomId).then(() => {});
      }, 500);
    },
    [roomId]
  );

  const addSystemMessage = useCallback((text: string) => {
    const sysMsg: ChatMessage = {
      id: uuidv4(), user_id: 'system', user_name: 'System',
      avatar_url: null, message: text, type: 'system', sent_at: Date.now(),
    };
    setMessages((prev) => [...prev, sysMsg]);
    // Broadcast to others as a chat event so they see it too
    channelRef.current?.send({ type: 'broadcast', event: 'chat', payload: sysMsg });
  }, []);

  const sendPlaybackEvent = useCallback(
    (event: Omit<PlaybackEvent, 'user_id' | 'server_time'>) => {
      const fullEvent = { ...event, user_id: userId, user_name: userName, server_time: Date.now() };

      channelRef.current?.send({ type: 'broadcast', event: 'playback', payload: fullEvent });

      // Add system message locally only (other user gets it via broadcast handler above)
      if (event.type === 'play') {
        persistState({ current_time_seconds: event.timestamp, is_playing: true });
        addSystemMessage(`${userName} played`);
      } else if (event.type === 'pause') {
        persistState({ current_time_seconds: event.timestamp, is_playing: false });
        addSystemMessage(`${userName} paused`);
      } else if (event.type === 'seek') {
        persistState({ current_time_seconds: event.timestamp });
        addSystemMessage(`${userName} skipped to ${formatDuration(event.timestamp)}`);
      }
    },
    [userId, userName, persistState, addSystemMessage]
  );

  const sendMessage = useCallback(
    (message: string) => {
      const chatMsg: ChatMessage = {
        id: uuidv4(), user_id: userId, user_name: userName,
        avatar_url: avatarUrl, message, type: 'chat', sent_at: Date.now(),
      };
      channelRef.current?.send({ type: 'broadcast', event: 'chat', payload: chatMsg });
      setMessages((prev) => [...prev, chatMsg]);
    },
    [userId, userName, avatarUrl]
  );

  return { messages, presence, lastPlaybackEvent, savedTime, savedIsPlaying, sendPlaybackEvent, sendMessage };
}