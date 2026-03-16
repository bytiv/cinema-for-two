import { NextResponse }                              from 'next/server';
import { createClient }                              from '@supabase/supabase-js';
import { randomBytes }                               from 'crypto';
import { getContainerState, startContainer, createContainer, getContainerIP, deleteContainer } from '@/lib/azure-arm';

const POLL_INTERVAL_MS = 3_000;
const STARTUP_TIMEOUT_MS = 90_000;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

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

async function waitForStarting(timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const { data } = await supabaseAdmin
      .from('container_state')
      .select('container_ip, container_starting')
      .eq('id', 1)
      .single();
    if (data && !data.container_starting && data.container_ip) {
      return data.container_ip;
    }
  }
  return null;
}

export async function POST() {
  try {
    // 1. Read current state from Supabase
    const { data: state } = await supabaseAdmin
      .from('container_state')
      .select('container_ip, container_starting, hmac_secret')
      .eq('id', 1)
      .single();

    // 2. Someone else is already starting it — wait for them
    if (state?.container_starting) {
      const ip = await waitForStarting(STARTUP_TIMEOUT_MS);
      if (!ip) return NextResponse.json({ error: 'Service failed to start' }, { status: 503 });
      return NextResponse.json({ ip });
    }

    // 3. We have an IP — check if container is actually healthy
    if (state?.container_ip) {
      const healthy = await waitForHealth(state.container_ip, POLL_INTERVAL_MS * 2);
      if (healthy) return NextResponse.json({ ip: state.container_ip });
    }

    // 4. Container is unreachable or no IP — we need to start it
    // Acquire the lock
    await supabaseAdmin
      .from('container_state')
      .update({ container_starting: true, updated_at: new Date().toISOString() })
      .eq('id', 1);

    try {
      const azureState = await getContainerState();

      if (azureState.exists && !azureState.running && state?.hmac_secret) {
        // Container exists but stopped — start it (reuses existing secret)
        await startContainer();
      } else {
        // Container doesn't exist or no stored secret — delete if stale, then create fresh
        if (azureState.exists) {
          await deleteContainer();
        }

        // Generate a fresh HMAC secret
        const hmacSecret = randomBytes(32).toString('hex');

        await createContainer(
          hmacSecret,
          process.env.AZURE_STORAGE_ACCOUNT_NAME!,
          process.env.AZURE_STORAGE_ACCOUNT_KEY!,
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
        );

        // Store the secret so ingest-api.ts can use it for signing
        await supabaseAdmin
          .from('container_state')
          .update({ hmac_secret: hmacSecret })
          .eq('id', 1);
      }

      // Poll ARM for IP
      let ip: string | null = null;
      const deadline = Date.now() + STARTUP_TIMEOUT_MS;
      while (Date.now() < deadline) {
        ip = await getContainerIP();
        if (ip) break;
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      }

      if (!ip) throw new Error('Container started but no IP assigned');

      // Wait for health
      const healthy = await waitForHealth(ip, STARTUP_TIMEOUT_MS);
      if (!healthy) throw new Error('Container IP found but health check timed out');

      // Store IP, release lock
      await supabaseAdmin
        .from('container_state')
        .update({ container_ip: ip, container_starting: false, updated_at: new Date().toISOString() })
        .eq('id', 1);

      return NextResponse.json({ ip });

    } catch (err: any) {
      // Release lock on failure
      await supabaseAdmin
        .from('container_state')
        .update({ container_ip: null, container_starting: false, updated_at: new Date().toISOString() })
        .eq('id', 1);
      throw err;
    }

  } catch (err: any) {
    console.error('[ensure-container]', err);
    return NextResponse.json({ error: err.message ?? 'Unknown error' }, { status: 503 });
  }
}