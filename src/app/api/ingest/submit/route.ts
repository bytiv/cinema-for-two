import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
import { randomBytes }               from 'crypto';
import { startIngestJob }            from '@/lib/ingest-api';
import { createJobContainer, getContainerIP, getContainerState } from '@/lib/azure-arm';
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

/**
 * Try to find an existing running container for this user.
 * Looks for a recent job with a healthy container.
 */
async function findExistingContainer(userId: string): Promise<{
  containerName: string;
  containerIp: string;
  hmacSecret: string;
} | null> {
  // Find recent jobs for this user that have container info
  const { data: recentJobs } = await supabaseAdmin
    .from('ingest_jobs')
    .select('container_name, container_ip, hmac_secret, status')
    .eq('user_id', userId)
    .not('container_name', 'is', null)
    .not('container_ip', 'is', null)
    .not('hmac_secret', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5);

  if (!recentJobs || recentJobs.length === 0) return null;

  // Check each one to find a container that's still running and healthy
  for (const job of recentJobs) {
    if (!job.container_name || !job.container_ip || !job.hmac_secret) continue;

    try {
      // Quick health check — if it responds, container is alive
      const res = await fetch(`http://${job.container_ip}:8000/health`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000), // 5s timeout
      });
      if (res.ok) {
        return {
          containerName: job.container_name,
          containerIp:   job.container_ip,
          hmacSecret:    job.hmac_secret,
        };
      }
    } catch {
      // Container is gone or unreachable — skip it
      continue;
    }
  }

  return null;
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

    // 2. Try to reuse an existing running container for this user
    const existing = await findExistingContainer(user.id);

    let containerName: string;
    let ip: string;
    let hmacSecret: string;

    if (existing) {
      // ── Reuse existing container ──────────────────────────────────
      containerName = existing.containerName;
      ip            = existing.containerIp;
      hmacSecret    = existing.hmacSecret;
      console.log(`[ingest/submit] Reusing container ${containerName} at ${ip} for user ${user.id}`);
    } else {
      // ── Create a new container ────────────────────────────────────
      hmacSecret    = randomBytes(32).toString('hex');
      const shortId = randomBytes(4).toString('hex');
      containerName = `ingest-${shortId}`;
      console.log(`[ingest/submit] Creating new container ${containerName} for user ${user.id}`);

      // Create the ACI container
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
        return NextResponse.json(
          { error: err.message ?? 'Failed to create ingest container. Please try again.' },
          { status: 503 },
        );
      }

      // Poll for IP
      let foundIp: string | null = null;
      const deadline = Date.now() + STARTUP_TIMEOUT_MS;
      while (Date.now() < deadline) {
        foundIp = await getContainerIP(containerName);
        if (foundIp) break;
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      }

      if (!foundIp) {
        return NextResponse.json(
          { error: 'Container started but no IP assigned. Please try again.' },
          { status: 503 },
        );
      }

      // Wait for health
      const healthy = await waitForHealth(foundIp, STARTUP_TIMEOUT_MS);
      if (!healthy) {
        return NextResponse.json(
          { error: 'Container health check timed out. Please try again.' },
          { status: 503 },
        );
      }

      ip = foundIp;
    }

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
        container_ip:   ip,
        container_rg:   process.env.AZURE_RESOURCE_GROUP ?? 'cinema-ingest-rg',
        hmac_secret:    hmacSecret,
      })
      .select('id')
      .single();

    if (insertError || !job) {
      return NextResponse.json({ error: 'Failed to create job record' }, { status: 500 });
    }

    // 4. Submit job to Python container
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
      // Python rejected it — mark failed
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

    // 5. Mark as submitted
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