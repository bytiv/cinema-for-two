/**
 * POST /api/ingest/start
 *
 * Submits a torrent hash/magnet to the Python ingest API.
 *
 * Instead of pre-generating a SAS URL (which requires knowing the file
 * extension upfront), we pass a sas_callback_url to the container.
 * Once the container has downloaded the file and knows its extension,
 * it calls that URL to get a fresh SAS signed for the correct blob name
 * (base + ext). This ensures blobs are always stored with the right extension.
 *
 * Body: {
 *   hash:        string
 *   name:        string   — slug (no extension)
 *   title:       string
 *   description? string
 *   quality?     '480p' | '720p' | '1080p' | '4K'
 *   posterUrl?   string
 *   trackers?    string[]
 * }
 *
 * Returns: { jobId, stage, meta }
 */

import { NextResponse }                    from 'next/server';
import { createServerSupabaseClient,
         createServiceRoleClient }         from '@/lib/supabase/server';
import { startIngestJob }                  from '@/lib/ingest-api';

export async function POST(request: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { hash, name, title, description, quality, posterUrl, trackers } = body;

    if (!hash?.trim())  return NextResponse.json({ error: 'hash is required'  }, { status: 400 });
    if (!name?.trim())  return NextResponse.json({ error: 'name is required'  }, { status: 400 });
    if (!title?.trim()) return NextResponse.json({ error: 'title is required' }, { status: 400 });

    // Build blob base name — no extension yet, container discovers it after download
    const timestamp    = Date.now();
    const sanitized    = name.trim().replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 50);
    const blobBaseName = `${user.id}/${timestamp}-${sanitized}`;

    // Callback URL: container calls this with { blobBaseName, ext } once it
    // knows the extension, and gets back a SAS signed for the correct full path
    const appUrl         = process.env.NEXT_PUBLIC_APP_URL
                           ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    const sasCallbackUrl = `${appUrl}/api/upload/ingest-sas`;

    const { job_id, stage } = await startIngestJob({
      hash:             hash.trim(),
      name:             sanitized,
      blob_base_name:   blobBaseName,
      sas_callback_url: sasCallbackUrl,
      trackers:         trackers ?? undefined,
    });

    const service = createServiceRoleClient();
    const { error: rpcError } = await service.rpc('upsert_torrent_job', {
      p_job_id:       job_id,
      p_requested_by: user.id,
      p_info_hash:    hash.trim(),
      p_stage:        stage,
      p_notification: 'Job queued',
    });
    if (rpcError) console.error('[ingest/start] upsert_torrent_job:', rpcError.message);

    return NextResponse.json({ jobId: job_id, stage, meta: { title, description, quality, posterUrl } });

  } catch (err: any) {
    console.error('[ingest/start]', err);
    return NextResponse.json({ error: err.message ?? 'Failed to start ingest job' }, { status: 502 });
  }
}