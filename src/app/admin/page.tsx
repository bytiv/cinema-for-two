'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Profile } from '@/types';
import Navbar from '@/components/layout/Navbar';
import Button from '@/components/ui/Button';
import { CheckCircle, XCircle, Clock, Shield, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

type FilterTab = 'pending' | 'approved' | 'denied' | 'all';

export default function AdminPage() {
  const supabase = createClient();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>('pending');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    loadProfiles();
  }, []);

  async function loadProfiles() {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) setProfiles(data);
    setLoading(false);
  }

  async function handleAction(profile: Profile, action: 'approved' | 'denied') {
    setActionLoading(profile.id);
    const { error } = await supabase
      .from('profiles')
      .update({ status: action })
      .eq('id', profile.id);

    if (!error) {
      setProfiles((prev) =>
        prev.map((p) => (p.id === profile.id ? { ...p, status: action } : p))
      );
    }
    setActionLoading(null);
  }

  const filteredProfiles = profiles.filter((p) => {
    if (filter === 'all') return true;
    return p.status === filter;
  });

  const pendingCount = profiles.filter((p) => p.status === 'pending').length;

  const tabs: { key: FilterTab; label: string; icon: any }[] = [
    { key: 'pending', label: `Pending (${pendingCount})`, icon: Clock },
    { key: 'approved', label: 'Approved', icon: CheckCircle },
    { key: 'denied', label: 'Denied', icon: XCircle },
    { key: 'all', label: 'All', icon: Users },
  ];

  return (
    <div className="min-h-screen">
      <Navbar />

      <main className="relative z-10 pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-cinema-accent/10 flex items-center justify-center">
            <Shield className="w-5 h-5 text-cinema-accent" />
          </div>
          <div>
            <h1 className="font-display text-3xl font-bold text-cinema-text">Admin Panel</h1>
            <p className="text-cinema-text-muted text-sm">Manage user access requests</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all',
                filter === key
                  ? 'bg-cinema-accent/15 text-cinema-accent border border-cinema-accent/30'
                  : 'bg-cinema-card border border-cinema-border text-cinema-text-muted hover:text-cinema-text'
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* User list */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 shimmer rounded-2xl" />
            ))}
          </div>
        ) : filteredProfiles.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-cinema-text-muted">No users in this category.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredProfiles.map((profile) => (
              <div
                key={profile.id}
                className="flex items-center justify-between p-4 bg-cinema-card/50 border border-cinema-border rounded-2xl"
              >
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-cinema-accent to-cinema-secondary flex items-center justify-center">
                    <span className="text-sm font-bold text-cinema-bg">
                      {profile.first_name.charAt(0)}{profile.last_name.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-cinema-text">
                      {profile.first_name} {profile.last_name}
                      {profile.role === 'admin' && (
                        <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-cinema-accent/20 text-cinema-accent">
                          Admin
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-cinema-text-dim">
                      Joined {new Date(profile.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Status badge */}
                  <span
                    className={cn(
                      'text-xs px-3 py-1 rounded-full',
                      profile.status === 'approved' && 'bg-cinema-success/10 text-cinema-success',
                      profile.status === 'pending' && 'bg-cinema-warm/10 text-cinema-warm',
                      profile.status === 'denied' && 'bg-cinema-error/10 text-cinema-error'
                    )}
                  >
                    {profile.status}
                  </span>

                  {/* Actions (not for admins) */}
                  {profile.role !== 'admin' && (
                    <div className="flex gap-1.5 ml-2">
                      {profile.status !== 'approved' && (
                        <button
                          onClick={() => handleAction(profile, 'approved')}
                          disabled={actionLoading === profile.id}
                          className="w-8 h-8 rounded-lg bg-cinema-success/10 hover:bg-cinema-success/20 flex items-center justify-center transition-colors"
                          title="Approve"
                        >
                          <CheckCircle className="w-4 h-4 text-cinema-success" />
                        </button>
                      )}
                      {profile.status !== 'denied' && (
                        <button
                          onClick={() => handleAction(profile, 'denied')}
                          disabled={actionLoading === profile.id}
                          className="w-8 h-8 rounded-lg bg-cinema-error/10 hover:bg-cinema-error/20 flex items-center justify-center transition-colors"
                          title="Deny"
                        >
                          <XCircle className="w-4 h-4 text-cinema-error" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
