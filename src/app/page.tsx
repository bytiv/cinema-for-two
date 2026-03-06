'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Film, Heart, Popcorn, Sparkles } from 'lucide-react';
import Button from '@/components/ui/Button';
import FloatingPostcards from '@/components/postcards/FloatingPostcards';

export default function HomePage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsLoggedIn(!!user);
    });
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Ambient background gradients */}
      <div className="fixed inset-0 z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-cinema-accent/5 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-cinema-secondary/5 blur-[120px]" />
        <div className="absolute top-[40%] left-[50%] w-[40%] h-[40%] rounded-full bg-cinema-warm/3 blur-[100px]" />
      </div>

      {/* Floating postcards */}
      <FloatingPostcards />

      {/* Content */}
      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4">
        {/* Logo & Title */}
        <div className="text-center mb-12 animate-fade-in">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cinema-accent via-cinema-secondary to-cinema-warm flex items-center justify-center shadow-2xl shadow-cinema-accent/20">
              <span className="text-3xl">🎬</span>
            </div>
          </div>
          <h1 className="font-display text-5xl sm:text-7xl font-bold mb-4">
            <span className="text-cinema-text">Cinema</span>
            <span className="text-cinema-accent">ForTwo</span>
          </h1>
          <p className="text-cinema-text-muted text-lg sm:text-xl max-w-md mx-auto leading-relaxed">
            Your cozy little cinema, made for just the two of you
          </p>
        </div>

        {/* Feature highlights */}
        <div className="flex flex-wrap justify-center gap-4 mb-12 animate-slide-up" style={{ animationDelay: '0.2s' }}>
          {[
            { icon: Film, label: 'Upload & Stream', color: 'text-cinema-accent' },
            { icon: Heart, label: 'Watch Together', color: 'text-cinema-error' },
            { icon: Sparkles, label: 'Stay in Sync', color: 'text-cinema-secondary' },
          ].map(({ icon: Icon, label, color }) => (
            <div
              key={label}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-cinema-card/50 border border-cinema-border backdrop-blur-sm"
            >
              <Icon className={`w-4 h-4 ${color}`} />
              <span className="text-sm text-cinema-text-muted">{label}</span>
            </div>
          ))}
        </div>

        {/* CTA buttons */}
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 w-full max-w-xs sm:max-w-none sm:w-auto animate-slide-up" style={{ animationDelay: '0.4s' }}>
          {isLoggedIn ? (
            <Link href="/browse" className="w-full sm:w-auto">
              <Button size="lg" icon={<Popcorn className="w-5 h-5" />} className="w-full sm:w-auto">
                Browse Movies
              </Button>
            </Link>
          ) : (
            <>
              <Link href="/auth/signup" className="w-full sm:w-auto">
                <Button size="lg" icon={<Heart className="w-5 h-5" />} className="w-full sm:w-auto">
                  Get Started
                </Button>
              </Link>
              <Link href="/auth/login" className="w-full sm:w-auto">
                <Button variant="secondary" size="lg" className="w-full sm:w-auto">
                  Sign In
                </Button>
              </Link>
            </>
          )}
        </div>

        {/* Decorative film strip */}
        <div className="absolute bottom-8 left-0 right-0 flex justify-center gap-2 opacity-20">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="w-8 h-6 rounded-sm border border-cinema-accent/30"
              style={{ opacity: 0.3 + Math.sin(i * 0.5) * 0.3 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}