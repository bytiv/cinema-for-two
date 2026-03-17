import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
import { randomBytes }               from 'crypto';
import { startIngestJob }            from '@/lib/ingest-api';
import { createJobContainer, getContainerIP } from '@/lib/azure-arm';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const POLL_INTERVAL_MS   = 3_000;
const STARTUP_TIMEOUT_MS = 120_000;  // 2 minutes for container to come up

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function getAuthenticatedUser() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

async function waitForHealth(ip: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${ip}:8000/health`, { cache: 'no-store' });
      if (res.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
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

    // 2. Generate per-job HMAC secret and container name
    const hmacSecret    = randomBytes(32).toString('hex');
    const shortId       = randomBytes(4).toString('hex'); // 8 chars
    const containerName = `ingest-${shortId}`;

    // 3. Persist job as 'pending' with container info
    const { data: job, error: insertError } = await supabaseAdmin
      .from('ingest_jobs')
      .insert({
        user_id:        user.id,
        hash,
        movie_name,
        status:         'pending',
        metadata:       metadata ?? {},
        container_name: containerName,
        container_rg:   process.env.AZURE_RESOURCE_GROUP ?? 'cinema-ingest-rg',
        hmac_secret:    hmacSecret,
      })
      .select('id')
      .single();

    if (insertError || !job) {
      return NextResponse.json({ error: 'Failed to create job record' }, { status: 500 });
    }

    // 4. Create a dedicated container for this job
    try {
      await createJobContainer(
        containerName,
        hmacSecret,
        process.env.AZURE_STORAGE_ACCOUNT_NAME!,
        process.env.AZURE_STORAGE_ACCOUNT_KEY!,
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      );
    } catch (err: any) {
      // Container failed to create — clean up the pending job
      await supabaseAdmin.from('ingest_jobs').delete().eq('id', job.id);
      return NextResponse.json(
        { error: err.message ?? 'Failed to create ingest container. Please try again.' },
        { status: 503 },
      );
    }

    // 5. Poll for IP
    let ip: string | null = null;
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      ip = await getContainerIP(containerName);
      if (ip) break;
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }

    if (!ip) {
      await supabaseAdmin.from('ingest_jobs').delete().eq('id', job.id);
      return NextResponse.json(
        { error: 'Container started but no IP assigned. Please try again.' },
        { status: 503 },
      );
    }

    // 6. Wait for container health
    const healthy = await waitForHealth(ip, STARTUP_TIMEOUT_MS);
    if (!healthy) {
      await supabaseAdmin.from('ingest_jobs').delete().eq('id', job.id);
      return NextResponse.json(
        { error: 'Container health check timed out. Please try again.' },
        { status: 503 },
      );
    }

    // 7. Store IP in the job row
    await supabaseAdmin
      .from('ingest_jobs')
      .update({ container_ip: ip })
      .eq('id', job.id);

    // 8. Submit job to Python container
    try {
      await startIngestJob(ip, hmacSecret, {
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
      // Python rejected it — clean up
      await supabaseAdmin
        .from('ingest_jobs')
        .update({
          status: 'failed',
          error: err.message ?? 'Failed to submit job to ingest service',
          finished_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      return NextResponse.json(
        { error: err.message ?? 'Failed to submit job to ingest service' },
        { status: 502 },
      );
    }

    // 9. Mark as submitted
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