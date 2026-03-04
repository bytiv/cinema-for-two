'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { X } from 'lucide-react';
import { Postcard } from '@/types';
import { createPortal } from 'react-dom';

export default function PostcardModal({ postcard, onClose }: { postcard: Postcard; onClose: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 300);
  }

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{
        zIndex: 9999,
        background: visible ? 'rgba(10, 6, 20, 0.88)' : 'rgba(10, 6, 20, 0)',
        backdropFilter: `blur(${visible ? 12 : 0}px)`,
        transition: 'background 0.3s ease, backdrop-filter 0.3s ease',
      }}
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'scale(1) rotate(-1deg)' : 'scale(0.8) rotate(-6deg)',
          transition: 'opacity 0.35s cubic-bezier(0.34,1.4,0.64,1), transform 0.35s cubic-bezier(0.34,1.4,0.64,1)',
        }}
        className="relative w-80"
      >
        {/* Outer glow */}
        <div
          className="absolute inset-0 rounded-sm pointer-events-none"
          style={{
            boxShadow: visible
              ? '0 0 60px rgba(232,160,191,0.15), 0 0 120px rgba(167,139,250,0.08)'
              : 'none',
            transition: 'box-shadow 0.5s ease',
          }}
        />

        {/* Dark vintage frame */}
        <div
          className="rounded-sm p-3"
          style={{
            background: 'linear-gradient(160deg, #1e1530 0%, #160f24 60%, #1a1226 100%)',
            border: '1px solid rgba(232,160,191,0.15)',
            boxShadow: '0 40px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(167,139,250,0.08), inset 0 1px 0 rgba(232,160,191,0.08)',
          }}
        >
          <div className="relative w-full overflow-hidden" style={{ aspectRatio: '4/5' }}>
            <Image
              src={postcard.image_url}
              alt={postcard.caption || 'Memory'}
              fill
              className="object-cover"
              sizes="320px"
            />
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'radial-gradient(ellipse at center, transparent 50%, rgba(15,10,26,0.35) 100%), linear-gradient(180deg, rgba(232,160,191,0.04) 0%, rgba(167,139,250,0.06) 100%)',
                mixBlendMode: 'multiply',
              }}
            />
            <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 20px rgba(0,0,0,0.4)' }} />
          </div>

          {postcard.caption && (
            <div className="pt-3 pb-1 px-2 text-center" style={{ borderTop: '1px solid rgba(232,160,191,0.08)', marginTop: '12px' }}>
              <div className="w-8 h-px mx-auto mb-2" style={{ background: 'linear-gradient(90deg, transparent, rgba(232,160,191,0.4), transparent)' }} />
              <p style={{ fontFamily: '"Playfair Display", serif', fontSize: '0.95rem', color: '#e8a0bf', letterSpacing: '0.01em', lineHeight: 1.5, textShadow: '0 0 20px rgba(232,160,191,0.3)' }}>
                {postcard.caption}
              </p>
            </div>
          )}
        </div>

        {/* Corner dots */}
        {['top-1 left-1', 'top-1 right-1', 'bottom-1 left-1', 'bottom-1 right-1'].map((pos) => (
          <div key={pos} className={`absolute ${pos} w-2 h-2 rounded-full pointer-events-none`} style={{ background: 'rgba(232,160,191,0.25)' }} />
        ))}

        <button
          onClick={handleClose}
          className="absolute -top-3 -right-3 w-8 h-8 rounded-full flex items-center justify-center transition-all hover:scale-110"
          style={{ background: 'rgba(35, 27, 51, 0.95)', border: '1px solid rgba(232,160,191,0.25)', boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}
        >
          <X className="w-3.5 h-3.5" style={{ color: '#e8a0bf' }} />
        </button>
      </div>
    </div>,
    document.body
  );
}