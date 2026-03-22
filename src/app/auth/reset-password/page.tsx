'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Lock, Eye, EyeOff, Heart, Sparkles } from 'lucide-react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    // Supabase automatically picks up the token from the URL hash
    // and establishes a session. We listen for that event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setSessionReady(true);
      }
    });

    // Also check if we already have a session (in case the event fired before mount)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSessionReady(true);
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase.auth]);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="fixed inset-0 z-0">
          <div className="absolute top-[20%] left-[30%] w-[40%] h-[40%] rounded-full bg-cinema-accent/5 blur-[120px]" />
          <div className="absolute bottom-[20%] right-[20%] w-[30%] h-[30%] rounded-full bg-cinema-secondary/5 blur-[100px]" />
        </div>
        <div className="relative z-10 text-center max-w-md">
          <div className="w-20 h-20 rounded-2xl bg-cinema-success/10 flex items-center justify-center mx-auto mb-6">
            <Sparkles className="w-10 h-10 text-cinema-success" />
          </div>
          <h1 className="font-display text-3xl font-bold text-cinema-text mb-3">Password Updated!</h1>
          <p className="text-cinema-text-muted mb-6">
            Your password has been reset successfully. You can now sign in with your new password.
          </p>
          <Link href="/auth/login">
            <Button icon={<Heart className="w-4 h-4" />}>Sign In</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!sessionReady) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="fixed inset-0 z-0">
          <div className="absolute top-[20%] left-[30%] w-[40%] h-[40%] rounded-full bg-cinema-accent/5 blur-[120px]" />
          <div className="absolute bottom-[20%] right-[20%] w-[30%] h-[30%] rounded-full bg-cinema-secondary/5 blur-[100px]" />
        </div>
        <div className="relative z-10 text-center max-w-md">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cinema-accent to-cinema-secondary flex items-center justify-center shadow-xl mx-auto mb-6 animate-pulse">
            <span className="text-2xl">🎬</span>
          </div>
          <p className="text-cinema-text-muted">Verifying your reset link...</p>
        </div>
      </div>
    );
  }

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
          <h1 className="font-display text-3xl font-bold text-cinema-text mb-2">Set New Password</h1>
          <p className="text-cinema-text-muted">Choose a new password for your account</p>
        </div>

        {/* Form */}
        <form onSubmit={handleReset} className="space-y-4">
          <div className="bg-cinema-card/50 backdrop-blur-sm border border-cinema-border rounded-2xl p-6 space-y-4">
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                label="New Password"
                placeholder="At least 6 characters"
                icon={<Lock className="w-4 h-4" />}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-[38px] text-cinema-text-dim hover:text-cinema-text-muted transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <div className="relative">
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                label="Confirm Password"
                placeholder="Re-enter your password"
                icon={<Lock className="w-4 h-4" />}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-[38px] text-cinema-text-dim hover:text-cinema-text-muted transition-colors"
              >
                {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-cinema-error/10 border border-cinema-error/20 text-cinema-error text-sm">
                {error}
              </div>
            )}

            <Button type="submit" loading={loading} className="w-full" size="lg" icon={<Lock className="w-4 h-4" />}>
              Reset Password
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}