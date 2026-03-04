'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Postcard } from '@/types';

interface PostcardViewerProps {
  postcards: Postcard[];
  initialIndex: number;
  onClose: () => void;
}

export default function PostcardViewer({ postcards, initialIndex, onClose }: PostcardViewerProps) {
  const [index, setIndex] = useState(initialIndex);
  const [animating, setAnimating] = useState(false);
  const [direction, setDirection] = useState<'left' | 'right' | null>(null);
  const [visible, setVisible] = useState(false);

  const current = postcards[index];
  const hasMultiple = postcards.length > 1;

  // Entrance animation
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
      if (e.key === 'ArrowRight') navigate('right');
      if (e.key === 'ArrowLeft') navigate('left');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [index, animating]);

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 250);
  }

  function navigate(dir: 'left' | 'right') {
    if (animating) return;
    const next = dir === 'right'
      ? (index + 1) % postcards.length
      : (index - 1 + postcards.length) % postcards.length;
    setDirection(dir);
    setAnimating(true);
    setTimeout(() => {
      setIndex(next);
      setDirection(null);
      setAnimating(false);
    }, 250);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: `rgba(0,0,0,${visible ? 0.75 : 0})`,
        backdropFilter: `blur(${visible ? 8 : 0}px)`,
        transition: 'background 0.25s ease, backdrop-filter 0.25s ease',
      }}
      onClick={handleClose}
    >
      {/* Polaroid card */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'scale(1) rotate(0deg)' : 'scale(0.7) rotate(-8deg)',
          transition: 'opacity 0.3s cubic-bezier(0.34,1.56,0.64,1), transform 0.3s cubic-bezier(0.34,1.56,0.64,1)',
        }}
        className="relative max-w-sm w-full"
      >
        {/* Polaroid frame */}
        <div className="bg-white rounded-sm shadow-2xl shadow-black/60 p-3 pb-10"
          style={{ boxShadow: '0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)' }}
        >
          {/* Image */}
          <div
            className="relative w-full overflow-hidden bg-gray-100"
            style={{
              aspectRatio: '4/5',
              opacity: animating ? 0 : 1,
              transform: animating
                ? `translateX(${direction === 'right' ? '-30px' : '30px'})`
                : 'translateX(0)',
              transition: 'opacity 0.2s ease, transform 0.2s ease',
            }}
          >
            <Image
              src={current.image_url}
              alt={current.caption || 'Postcard'}
              fill
              className="object-cover"
              sizes="400px"
            />
          </div>

          {/* Caption area — polaroid bottom */}
          <div className="pt-3 pb-1 px-1 text-center min-h-[2.5rem] flex items-center justify-center">
            {current.caption ? (
              <p
                className="text-gray-700 text-sm leading-snug"
                style={{ fontFamily: "'Caveat', 'Segoe UI', cursive", fontSize: '1rem' }}
              >
                {current.caption}
              </p>
            ) : (
              <p className="text-gray-300 text-xs italic">no caption</p>
            )}
          </div>
        </div>

        {/* Dot indicators */}
        {hasMultiple && (
          <div className="flex justify-center gap-1.5 mt-4">
            {postcards.map((_, i) => (
              <button
                key={i}
                onClick={() => {
                  if (i !== index) navigate(i > index ? 'right' : 'left');
                }}
                className="w-1.5 h-1.5 rounded-full transition-all duration-200"
                style={{
                  background: i === index ? 'white' : 'rgba(255,255,255,0.3)',
                  transform: i === index ? 'scale(1.4)' : 'scale(1)',
                }}
              />
            ))}
          </div>
        )}

        {/* Nav arrows */}
        {hasMultiple && (
          <>
            <button
              onClick={() => navigate('left')}
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-12 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-white" />
            </button>
            <button
              onClick={() => navigate('right')}
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-12 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center transition-colors"
            >
              <ChevronRight className="w-5 h-5 text-white" />
            </button>
          </>
        )}

        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white/10 hover:bg-white/25 border border-white/20 flex items-center justify-center transition-colors backdrop-blur-sm"
        >
          <X className="w-4 h-4 text-white" />
        </button>

        {/* Counter */}
        {hasMultiple && (
          <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 text-white/40 text-xs">
            {index + 1} / {postcards.length}
          </div>
        )}
      </div>
    </div>
  );
}