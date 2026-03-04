'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Film, Upload, User, LogOut, Home, Search, Users, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Profile } from '@/types';
import Button from '@/components/ui/Button';

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    async function getProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('user_id', user.id)
          .single();
        if (data) setProfile(data);
      }
    }
    getProfile();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  };

  const navLinks = [
    { href: '/browse', label: 'Browse', icon: Film },
    { href: '/upload', label: 'Upload', icon: Upload },
    { href: '/friends', label: 'Friends', icon: Users },
    { href: '/profile', label: 'Profile', icon: User },
    ...(profile?.role === 'admin' ? [{ href: '/admin', label: 'Admin', icon: Shield }] : []),
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-cinema-bg/80 backdrop-blur-xl border-b border-cinema-border/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/browse" className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cinema-accent to-cinema-secondary flex items-center justify-center shadow-lg group-hover:shadow-cinema-accent/30 transition-shadow">
              <span className="text-lg">🎬</span>
            </div>
            <span className="font-display text-xl font-semibold text-cinema-text hidden sm:block">
              Cinema<span className="text-cinema-accent">ForTwo</span>
            </span>
          </Link>

          {/* Nav Links */}
          <div className="flex items-center gap-1">
            {navLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300',
                  pathname === href || pathname.startsWith(href + '/')
                    ? 'bg-cinema-accent/15 text-cinema-accent'
                    : 'text-cinema-text-muted hover:text-cinema-text hover:bg-cinema-card/50'
                )}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:block">{label}</span>
              </Link>
            ))}
          </div>

          {/* User Menu */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-cinema-card/50 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cinema-accent to-cinema-secondary flex items-center justify-center overflow-hidden ring-2 ring-cinema-border">
                {profile?.avatar_url ? (
                  <Image
                    src={profile.avatar_url}
                    alt="Avatar"
                    width={32}
                    height={32}
                    className="object-cover"
                  />
                ) : (
                  <User className="w-4 h-4 text-cinema-bg" />
                )}
              </div>
            </button>

            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-full mt-2 w-56 bg-cinema-card border border-cinema-border rounded-xl shadow-2xl shadow-cinema-bg/50 z-20 overflow-hidden">
                  {profile && (
                    <div className="px-4 py-3 border-b border-cinema-border">
                      <p className="text-sm font-medium text-cinema-text">
                        {profile.first_name} {profile.last_name}
                      </p>
                    </div>
                  )}
                  <Link
                    href="/profile"
                    onClick={() => setShowMenu(false)}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-cinema-text-muted hover:text-cinema-text hover:bg-cinema-surface transition-colors"
                  >
                    <User className="w-4 h-4" />
                    Profile
                  </Link>
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-cinema-error hover:bg-cinema-surface transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
