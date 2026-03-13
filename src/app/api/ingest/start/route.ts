/**
 * POST /api/ingest/start
 *
 * Submits a torrent hash/magnet to the Python ingest container.
 *
 * The container receives:
 *   - The torrent hash/magnet
 *   - A blob_base_name: {userId}/{timestamp}-{slug}  (no extension)
 *   - Azure storage credentials (account, key, container)
 *
 * After downloading, the container discovers the real file extension,
 * builds the full blob name (base + ext), and uploads directly to Azure.
 * It returns the clean blob_url with extension already included.
 *
 * No SAS callback needed — the container handles the upload itself.
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

import { NextResponse }                from 'next/server';
import { createServerSupabaseClient,
         createServiceRoleClient }     from '@/lib/supabase/server';
import { startIngestJob }              from '@/lib/ingest-api';
import { CONTAINERS }                  from '@/lib/azure-blob';

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

    // Validate storage env vars are present before sending to container
    const storageAccount = process.env.AZURE_STORAGE_ACCOUNT_NAME;
    const storageKey     = process.env.AZURE_STORAGE_ACCOUNT_KEY;
    if (!storageAccount || !storageKey) {
      console.error('[ingest/start] Missing Azure storage env vars');
      return NextResponse.json({ error: 'Storage not configured' }, { status: 500 });
    }

    // Build blob base name — no extension, container appends it after download
    const timestamp    = Date.now();
    const sanitized    = name.trim().replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 50);
    const blobBaseName = `${user.id}/${timestamp}-${sanitized}`;

    const { job_id, stage } = await startIngestJob({
      hash:            hash.trim(),
      name:            sanitized,
      blob_base_name:  blobBaseName,
      storage_account: storageAccount,
      storage_key:     storageKey,
      container_name:  CONTAINERS.movies,
      trackers:        trackers ?? undefined,
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