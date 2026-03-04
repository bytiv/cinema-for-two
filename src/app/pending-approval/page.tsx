'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { Clock, LogOut, RefreshCw, XCircle } from 'lucide-react';
import Button from '@/components/ui/Button';

export default function PendingApprovalPage() {
  const supabase = createClient();
  const router = useRouter();
  const [status, setStatus] = useState<'pending' | 'denied' | 'approved' | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    checkStatus();
  }, []);

  async function checkStatus() {
    setChecking(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/auth/login');
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('status')
      .eq('user_id', user.id)
      .single();

    if (profile) {
      setStatus(profile.status);
      if (profile.status === 'approved') {
        router.push('/browse');
      }
    }
    setChecking(false);
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="fixed inset-0 z-0">
        <div className="absolute top-[20%] left-[30%] w-[40%] h-[40%] rounded-full bg-cinema-accent/5 blur-[120px]" />
        <div className="absolute bottom-[20%] right-[20%] w-[30%] h-[30%] rounded-full bg-cinema-warm/5 blur-[100px]" />
      </div>

      <div className="relative z-10 text-center max-w-md">
        {status === 'denied' ? (
          <>
            <div className="w-20 h-20 rounded-2xl bg-cinema-error/10 flex items-center justify-center mx-auto mb-6">
              <XCircle className="w-10 h-10 text-cinema-error" />
            </div>
            <h1 className="font-display text-3xl font-bold text-cinema-text mb-3">
              Access Denied
            </h1>
            <p className="text-cinema-text-muted mb-8">
              Your account request has been denied. If you believe this is a mistake, 
              please contact the admin.
            </p>
          </>
        ) : (
          <>
            <div className="w-20 h-20 rounded-2xl bg-cinema-warm/10 flex items-center justify-center mx-auto mb-6">
              <Clock className="w-10 h-10 text-cinema-warm" />
            </div>
            <h1 className="font-display text-3xl font-bold text-cinema-text mb-3">
              Waiting for Approval
            </h1>
            <p className="text-cinema-text-muted mb-2">
              Your account is pending admin approval. You&apos;ll get access once an admin approves your request.
            </p>
            <p className="text-cinema-text-dim text-sm mb-8">
              Hang tight — this usually doesn&apos;t take long! 💜
            </p>
            <Button
              variant="secondary"
              icon={<RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />}
              onClick={checkStatus}
              loading={checking}
              className="mb-3"
            >
              Check Again
            </Button>
          </>
        )}
        <div>
          <Button variant="ghost" icon={<LogOut className="w-4 h-4" />} onClick={handleSignOut}>
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
}
