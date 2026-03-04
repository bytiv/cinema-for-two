'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, MessageCircle, X, Smile, ChevronLeft } from 'lucide-react';
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

  // Determine if a message is the first in a group (different user from previous)
  const isFirstInGroup = (idx: number): boolean => {
    if (idx === 0) return true;
    return messages[idx].user_id !== messages[idx - 1].user_id;
  };

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="fixed top-1/2 -translate-y-1/2 right-0 z-30 flex items-center justify-center w-6 h-16 rounded-l-xl bg-cinema-surface/90 border border-r-0 border-cinema-border backdrop-blur-sm hover:bg-cinema-card transition-colors"
        title="Open chat"
      >
        {messages.length > 0 && (
          <span className="absolute -top-2 left-0 w-4 h-4 rounded-full bg-cinema-accent text-cinema-bg text-[8px] font-bold flex items-center justify-center leading-none">
            {messages.length > 9 ? '9+' : messages.length}
          </span>
        )}
        <ChevronLeft className="w-3.5 h-3.5 text-cinema-accent" />
      </button>
    );
  }

  return (
    <div className="w-80 h-full flex flex-col bg-cinema-surface border-l border-cinema-border">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-cinema-border">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-cinema-accent" />
          <span className="font-display font-semibold text-cinema-text">Chat</span>
        </div>
        <div className="flex items-center gap-2">
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
          <button onClick={onToggle} className="text-cinema-text-muted hover:text-cinema-text">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Messages - all left aligned */}
      <div className="flex-1 overflow-y-auto p-4 space-y-0.5">
        {messages.length === 0 && (
          <div className="text-center text-cinema-text-dim text-sm py-8">
            <span className="text-2xl mb-2 block">💬</span>
            No messages yet. Say hi!
          </div>
        )}
        {messages.map((msg, idx) => {
          const isMe = msg.user_id === currentUserId;
          const isEmoji = /^[\p{Emoji}]+$/u.test(msg.message) && msg.message.length <= 8;
          const isSystem = msg.type === 'system';
          const firstInGroup = isFirstInGroup(idx);

          // System messages (seek, play, pause events)
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
            <div key={msg.id} className={cn('flex gap-2', firstInGroup ? 'mt-3' : 'mt-0.5')}>
              {/* Avatar column - only show avatar on first message in group */}
              <div className="w-7 flex-shrink-0">
                {firstInGroup && (
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

              {/* Message content */}
              <div className="flex-1 min-w-0">
                {firstInGroup && (
                  <p className="text-[10px] text-cinema-text-dim mb-0.5 ml-1">
                    {isMe ? 'You' : msg.user_name}
                  </p>
                )}
                {isEmoji ? (
                  <span className="text-3xl ml-1">{msg.message}</span>
                ) : (
                  <div
                    className={cn(
                      'inline-block px-3 py-2 rounded-2xl text-sm max-w-[85%]',
                      isMe
                        ? 'bg-cinema-accent text-cinema-bg rounded-bl-sm'
                        : 'bg-cinema-card text-cinema-text rounded-bl-sm'
                    )}
                  >
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
      <div className="p-3 border-t border-cinema-border">
        {/* Quick reactions */}
        {showReactions && (
          <div className="flex gap-1 mb-2 p-2 bg-cinema-card rounded-xl">
            {REACTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleReaction(emoji)}
                className="text-xl hover:scale-125 transition-transform p-1"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => setShowReactions(!showReactions)}
            className="text-cinema-text-muted hover:text-cinema-accent transition-colors"
          >
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
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="text-cinema-accent hover:text-cinema-accent-light disabled:text-cinema-text-dim transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}