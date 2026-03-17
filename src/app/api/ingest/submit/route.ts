import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
import { startIngestJob }            from '@/lib/ingest-api';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const MAX_USER_JOBS = parseInt(process.env.MAX_USER_JOBS ?? '2', 10);

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function getAuthenticatedUser() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

async function ensureContainer(): Promise<string> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_APP_URL}/api/ingest/ensure-container`,
    { method: 'POST', cache: 'no-store' },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'Failed to start the service');
  }
  const { ip } = await res.json();
  return ip;
}

export async function POST(req: NextRequest) {
  try {
    // 1. Auth check
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { hash, movie_name, blob_base_name, trackers, metadata } = body;

    if (!hash || !movie_name || !blob_base_name) {
      return NextResponse.json(
        { error: 'hash, movie_name and blob_base_name are required' },
        { status: 400 },
      );
    }

    // 1b. Check torrent upload permission
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role, can_upload_torrent')
      .eq('user_id', user.id)
      .single();

    if (!profile || (profile.role !== 'admin' && !profile.can_upload_torrent)) {
      return NextResponse.json(
        { error: 'You don\'t have permission to upload via torrent.' },
        { status: 403 },
      );
    }

    // 2. Check user's active job count (pending/submitted/running/uploading)
    const { count } = await supabaseAdmin
      .from('ingest_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .in('status', ['pending', 'submitted', 'running', 'uploading']);

    if ((count ?? 0) >= MAX_USER_JOBS) {
      return NextResponse.json(
        {
          error: `You already have ${MAX_USER_JOBS} active jobs. Wait for one to finish before submitting.`,
        },
        { status: 429 },
      );
    }

    // 3. Persist job as 'pending' — source of truth from this point
    const { data: job, error: insertError } = await supabaseAdmin
      .from('ingest_jobs')
      .insert({
        user_id:    user.id,
        hash,
        movie_name,
        status:     'pending',
        metadata:   metadata ?? {},
      })
      .select('id')
      .single();

    if (insertError || !job) {
      return NextResponse.json({ error: 'Failed to create job record' }, { status: 500 });
    }

    // 4. Ensure container is running — get live IP
    let ip: string;
    try {
      ip = await ensureContainer();
    } catch (err: any) {
      // Container failed to start — delete the pending job, no trace left
      await supabaseAdmin.from('ingest_jobs').delete().eq('id', job.id);
      return NextResponse.json(
        { error: err.message ?? 'Failed to start the service. Please try again.' },
        { status: 503 },
      );
    }

    // 5. Submit job to Python container
    try {
      await startIngestJob(ip, {
        job_id:          job.id,
        hash,
        name:            movie_name,
        user_id:         user.id,
        blob_base_name,
        storage_account: process.env.AZURE_STORAGE_ACCOUNT_NAME!,
        storage_key:     process.env.AZURE_STORAGE_ACCOUNT_KEY!,
        container_name:  process.env.AZURE_STORAGE_CONTAINER_MOVIES!,
        trackers,
      });
    } catch (err: any) {
      // Python rejected it — delete pending job
      await supabaseAdmin.from('ingest_jobs').delete().eq('id', job.id);
      return NextResponse.json(
        { error: err.message ?? 'Failed to submit job to ingest service' },
        { status: 502 },
      );
    }

    // 6. Mark as submitted
    await supabaseAdmin
      .from('ingest_jobs')
      .update({ status: 'submitted' })
      .eq('id', job.id);

    return NextResponse.json({ job_id: job.id, status: 'submitted' });

  } catch (err: any) {
    console.error('[ingest/submit]', err);
    return NextResponse.json({ error: err.message ?? 'Unexpected error' }, { status: 500 });
  }
}