'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Mail, Lock, Heart, Eye, EyeOff } from 'lucide-react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

// Separated into its own component so useSearchParams can be wrapped in Suspense
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/browse';
  const supabase = createClient();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push(redirect);
    router.refresh();
  };

  return (
    <form onSubmit={handleLogin} className="space-y-4">
      <div className="bg-cinema-card/50 backdrop-blur-sm border border-cinema-border rounded-2xl p-6 space-y-4">
        <Input
          id="email"
          type="email"
          label="Email"
          placeholder="you@example.com"
          icon={<Mail className="w-4 h-4" />}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <div className="relative">
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            label="Password"
            placeholder="Your password"
            icon={<Lock className="w-4 h-4" />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-[38px] text-cinema-text-dim hover:text-cinema-text-muted transition-colors"
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-cinema-error/10 border border-cinema-error/20 text-cinema-error text-sm">
            {error}
          </div>
        )}

        <Button type="submit" loading={loading} className="w-full" size="lg" icon={<Heart className="w-4 h-4" />}>
          Sign In
        </Button>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      {/* Background effects */}
      <div className="fixed inset-0 z-0">
        <div className="absolute top-[20%] left-[30%] w-[40%] h-[40%] rounded-full bg-cinema-accent/5 blur-[120px]" />
        <div className="absolute bottom-[20%] right-[20%] w-[30%] h-[30%] rounded-full bg-cinema-secondary/5 blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-6">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cinema-accent to-cinema-secondary flex items-center justify-center shadow-xl mx-auto">
              <span className="text-2xl">🎬</span>
            </div>
          </Link>
          <h1 className="font-display text-3xl font-bold text-cinema-text mb-2">Welcome Back</h1>
          <p className="text-cinema-text-muted">Sign in to your cozy cinema</p>
        </div>

        {/* Suspense boundary required for useSearchParams in Next.js 14 */}
        <Suspense fallback={<div className="h-48 bg-cinema-card/50 rounded-2xl animate-pulse" />}>
          <LoginForm />
        </Suspense>

        <p className="text-center text-cinema-text-muted text-sm mt-6">
          Don&apos;t have an account?{' '}
          <Link href="/auth/signup" className="text-cinema-accent hover:text-cinema-accent-light transition-colors">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}