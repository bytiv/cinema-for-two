'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, MessageCircle, X, Smile, ChevronRight, ChevronLeft } from 'lucide-react';
import { ChatMessage, PresenceState } from '@/types';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface ChatPanelProps {
  messages: ChatMessage[];
  presence: PresenceState[];
  onSendMessage: (message: string) => void;
  currentUserId: string;
  isOpen: boolean;
  onToggle: () => void;
}

const REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '👏'];

export default function ChatPanel({
  messages,
  presence,
  onSendMessage,
  currentUserId,
  isOpen,
  onToggle,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [showReactions, setShowReactions] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    onSendMessage(input.trim());
    setInput('');
    inputRef.current?.focus();
  };

  const handleReaction = (emoji: string) => {
    onSendMessage(emoji);
    setShowReactions(false);
  };

  const isFirstInGroup = (idx: number): boolean => {
    if (idx === 0) return true;
    return messages[idx].user_id !== messages[idx - 1].user_id;
  };

  return (
    <div className="relative flex h-full">

      {/* ── Arrow tab — always visible on the left edge of chat panel ── */}
      <button
        onClick={onToggle}
        className={cn(
          'absolute left-0 top-1/2 -translate-x-full -translate-y-1/2 z-40',
          'flex flex-col items-center justify-center gap-1',
          'w-5 py-6 rounded-l-xl border-l border-t border-b transition-all duration-200',
          isOpen
            ? 'bg-cinema-surface border-cinema-border text-cinema-text-muted hover:text-cinema-accent hover:border-cinema-accent/40'
            : 'bg-cinema-accent/90 border-cinema-accent text-cinema-bg hover:bg-cinema-accent'
        )}
        title={isOpen ? 'Hide chat' : 'Show chat'}
      >
        {isOpen ? (
          <ChevronRight className="w-3.5 h-3.5" />
        ) : (
          <ChevronLeft className="w-3.5 h-3.5" />
        )}
      </button>

      {/* ── Chat panel ── */}
      <div className={cn(
        'h-full flex flex-col bg-cinema-surface border-l border-cinema-border transition-all duration-300 overflow-hidden',
        isOpen ? 'w-80' : 'w-0'
      )}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-cinema-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-cinema-accent" />
            <span className="font-display font-semibold text-cinema-text">Chat</span>
          </div>
          {/* Presence indicators */}
          <div className="flex -space-x-2">
            {presence.map((p) => (
              <div
                key={p.user_id}
                className="w-7 h-7 rounded-full border-2 border-cinema-surface bg-gradient-to-br from-cinema-accent to-cinema-secondary flex items-center justify-center overflow-hidden"
                title={p.user_name}
              >
                {p.avatar_url ? (
                  <Image src={p.avatar_url} alt={p.user_name} width={28} height={28} className="object-cover" />
                ) : (
                  <span className="text-[10px] font-bold text-cinema-bg">
                    {p.user_name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-0.5">
          {messages.length === 0 && (
            <div className="text-center text-cinema-text-dim text-sm py-8">
              <span className="text-2xl mb-2 block">💬</span>
              No messages yet. Say hi!
            </div>
          )}
          {messages.map((msg, idx) => {
            const isMe = msg.user_id === currentUserId;
            const isEmoji = msg.message.length <= 8 && !msg.message.match(/[a-zA-Z0-9]/);
            const isSystem = msg.type === 'system';
            const firstInGroup = isFirstInGroup(idx);

            if (isSystem) {
              return (
                <div key={msg.id} className="flex justify-center py-1.5">
                  <span className="text-[11px] text-cinema-text-dim bg-cinema-card/50 px-3 py-1 rounded-full">
                    {msg.message}
                  </span>
                </div>
              );
            }

            return (
              <div key={msg.id} className={cn('flex gap-2', isMe ? 'flex-row-reverse' : 'flex-row', firstInGroup ? 'mt-3' : 'mt-0.5')}>
                {/* Avatar — only theirs, only on first in group */}
                <div className="w-7 flex-shrink-0">
                  {firstInGroup && !isMe && (
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cinema-secondary to-cinema-accent flex items-center justify-center overflow-hidden">
                      {msg.avatar_url ? (
                        <Image src={msg.avatar_url} alt="" width={28} height={28} className="object-cover" />
                      ) : (
                        <span className="text-[10px] font-bold text-cinema-bg">
                          {msg.user_name.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Bubble */}
                <div className={cn('flex-1 min-w-0 flex flex-col', isMe ? 'items-end' : 'items-start')}>
                  {firstInGroup && (
                    <p className="text-[10px] text-cinema-text-dim mb-0.5 mx-1">
                      {isMe ? 'You' : msg.user_name}
                    </p>
                  )}
                  {isEmoji ? (
                    <span className="text-3xl mx-1">{msg.message}</span>
                  ) : (
                    <div className={cn(
                      'inline-block px-3 py-2 text-sm max-w-[85%]',
                      isMe
                        ? 'bg-cinema-accent text-cinema-bg rounded-2xl rounded-br-sm'
                        : 'bg-cinema-card text-cinema-text rounded-2xl rounded-bl-sm'
                    )}>
                      {msg.message}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t border-cinema-border flex-shrink-0">
          {showReactions && (
            <div className="flex gap-1 mb-2 p-2 bg-cinema-card rounded-xl">
              {REACTIONS.map((emoji) => (
                <button key={emoji} onClick={() => handleReaction(emoji)} className="text-xl hover:scale-125 transition-transform p-1">
                  {emoji}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => setShowReactions(!showReactions)} className="text-cinema-text-muted hover:text-cinema-accent transition-colors">
              <Smile className="w-5 h-5" />
            </button>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Type a message..."
              className="flex-1 bg-cinema-card border border-cinema-border rounded-xl px-3 py-2 text-sm text-cinema-text placeholder:text-cinema-text-dim focus:outline-none focus:border-cinema-accent/50"
            />
            <button onClick={handleSend} disabled={!input.trim()} className="text-cinema-accent hover:text-cinema-accent-light disabled:text-cinema-text-dim transition-colors">
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}