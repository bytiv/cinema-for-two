'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Mail, Lock, User, Heart, Eye, EyeOff, Sparkles } from 'lucide-react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      setLoading(false);
      return;
    }

    const { data, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
        },
      },
    });

    if (signupError) {
      setError(signupError.message);
      setLoading(false);
      return;
    }

    // If email confirmation is required
    if (data.user && !data.session) {
      setSuccess(true);
      setLoading(false);
      return;
    }

    // If auto-confirmed, create profile and redirect to pending
    if (data.user && data.session) {
      await supabase.from('profiles').upsert({
        user_id: data.user.id,
        first_name: firstName,
        last_name: lastName,
      });
      router.push('/pending-approval');
      router.refresh();
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 rounded-2xl bg-cinema-success/10 flex items-center justify-center mx-auto mb-6">
            <Sparkles className="w-10 h-10 text-cinema-success" />
          </div>
          <h1 className="font-display text-3xl font-bold text-cinema-text mb-3">Check Your Email!</h1>
          <p className="text-cinema-text-muted mb-6">
            We sent a confirmation link to <strong className="text-cinema-text">{email}</strong>. 
            Click the link to activate your account.
          </p>
          <Link href="/auth/login">
            <Button variant="secondary">Back to Login</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      {/* Background effects */}
      <div className="fixed inset-0 z-0">
        <div className="absolute top-[10%] right-[20%] w-[40%] h-[40%] rounded-full bg-cinema-accent/5 blur-[120px]" />
        <div className="absolute bottom-[10%] left-[20%] w-[35%] h-[35%] rounded-full bg-cinema-warm/5 blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-6">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cinema-accent to-cinema-warm flex items-center justify-center shadow-xl mx-auto">
              <span className="text-2xl">🎬</span>
            </div>
          </Link>
          <h1 className="font-display text-3xl font-bold text-cinema-text mb-2">Join CinemaForTwo</h1>
          <p className="text-cinema-text-muted">Create your account & start watching together</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSignup} className="space-y-4">
          <div className="bg-cinema-card/50 backdrop-blur-sm border border-cinema-border rounded-2xl p-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input
                id="firstName"
                label="First Name"
                placeholder="Your name"
                icon={<User className="w-4 h-4" />}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
              <Input
                id="lastName"
                label="Last Name"
                placeholder="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>

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

            {error && (
              <div className="p-3 rounded-xl bg-cinema-error/10 border border-cinema-error/20 text-cinema-error text-sm">
                {error}
              </div>
            )}

            <Button type="submit" loading={loading} className="w-full" size="lg" icon={<Heart className="w-4 h-4" />}>
              Create Account
            </Button>
          </div>
        </form>

        <p className="text-center text-cinema-text-muted text-sm mt-6">
          Already have an account?{' '}
          <Link href="/auth/login" className="text-cinema-accent hover:text-cinema-accent-light transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
