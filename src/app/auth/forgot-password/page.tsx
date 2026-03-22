'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Mail, ArrowLeft, Sparkles } from 'lucide-react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

export default function ForgotPasswordPage() {
  const supabase = createClient();

  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });

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
          <h1 className="font-display text-3xl font-bold text-cinema-text mb-3">Check Your Email!</h1>
          <p className="text-cinema-text-muted mb-6">
            We sent a password reset link to <strong className="text-cinema-text">{email}</strong>.
            Click the link to set a new password.
          </p>
          <Link href="/auth/login">
            <Button variant="secondary" icon={<ArrowLeft className="w-4 h-4" />}>Back to Login</Button>
          </Link>
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
          <h1 className="font-display text-3xl font-bold text-cinema-text mb-2">Forgot Password?</h1>
          <p className="text-cinema-text-muted">No worries, we&apos;ll send you a reset link</p>
        </div>

        {/* Form */}
        <form onSubmit={handleResetRequest} className="space-y-4">
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

            {error && (
              <div className="p-3 rounded-xl bg-cinema-error/10 border border-cinema-error/20 text-cinema-error text-sm">
                {error}
              </div>
            )}

            <Button type="submit" loading={loading} className="w-full" size="lg" icon={<Mail className="w-4 h-4" />}>
              Send Reset Link
            </Button>
          </div>
        </form>

        <p className="text-center text-cinema-text-muted text-sm mt-6">
          <Link href="/auth/login" className="text-cinema-accent hover:text-cinema-accent-light transition-colors inline-flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" />
            Back to Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}