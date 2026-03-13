/**
 * POST /api/ingest/start
 *
 * Submits a torrent hash/magnet to the Python ingest API.
 *
 * This route is the ONLY place that touches Azure storage details.
 * It generates a blob name matching the normal upload convention
 * ({userId}/{timestamp}-{name}) and a write-scoped SAS URL for that
 * exact blob, then passes both to the container.  The container never
 * sees the account name, key, or container name — only the SAS URL.
 *
 * Body: {
 *   hash:        string   — bare InfoHash or magnet URI
 *   name:        string   — desired filename without extension (slug)
 *   title:       string   — movie title shown in the library
 *   description? string
 *   quality?     '480p' | '720p' | '1080p' | '4K'
 *   posterUrl?   string
 *   trackers?    string[]
 * }
 *
 * Returns: { jobId, stage, meta }
 */

import { NextResponse }                                   from 'next/server';
import { createServerSupabaseClient,
         createServiceRoleClient }                        from '@/lib/supabase/server';
import { generateUploadSasUrl, CONTAINERS }               from '@/lib/azure-blob';
import { startIngestJob }                                 from '@/lib/ingest-api';

export async function POST(request: Request) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── Validate body ─────────────────────────────────────────────────────────
    const body = await request.json();
    const { hash, name, title, description, quality, posterUrl, trackers } = body;

    if (!hash?.trim())  return NextResponse.json({ error: 'hash is required'  }, { status: 400 });
    if (!name?.trim())  return NextResponse.json({ error: 'name is required'  }, { status: 400 });
    if (!title?.trim()) return NextResponse.json({ error: 'title is required' }, { status: 400 });

    // ── Build blob name matching the normal upload convention ─────────────────
    //
    //   Normal upload:  {userId}/{timestamp}-{sanitizedFileName}.{ext}
    //   Ingest upload:  {userId}/{timestamp}-{sanitizedName}          ← no ext yet
    //
    // The container appends the real extension once it knows the downloaded
    // file's type (e.g. .mkv, .mp4).  We therefore create the SAS URL
    // without an extension — Azure Blob Storage will create the blob at
    // exactly the path in the SAS, so the container must use this name
    // verbatim and append the extension itself when uploading.
    //
    // We store blobBaseName in Supabase so save-ingest-movie.ts can
    // reconstruct the final blob_name once the extension is known.

    const timestamp    = Date.now();
    const sanitized    = name.trim()
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .slice(0, 50);
    const blobBaseName = `${user.id}/${timestamp}-${sanitized}`;

    // ── Generate write-scoped SAS URL ─────────────────────────────────────────
    //
    // Expires in 6 hours — enough for a long download + upload.
    // Permissions: r (read) + c (create) + w (write) — same as normal upload SAS.
    // The container does a single PUT to this URL; it cannot list or delete.
    //
    // NOTE: We pass blobBaseName (no extension) to generateUploadSasUrl.
    //       The container MUST upload to this exact blob name (appending its
    //       own extension).  The SAS is locked to blobBaseName; if the container
    //       tries to write to a different path, Azure will reject the request.
    //       This is intentional — it prevents the container from writing
    //       anywhere other than the pre-approved path.

    const sasUrl = generateUploadSasUrl(CONTAINERS.movies, blobBaseName, 6);

    // ── Forward to Python ingest API ──────────────────────────────────────────
    const { job_id, stage } = await startIngestJob({
      hash:          hash.trim(),
      name:          sanitized,          // slug only — container appends extension
      blob_base_name: blobBaseName,      // full path without extension
      sas_url:       sasUrl,             // write SAS — no account key ever sent
      trackers:      trackers ?? undefined,
    });

    // ── Create Supabase audit row ─────────────────────────────────────────────
    const service = createServiceRoleClient();
    const { error: rpcError } = await service.rpc('upsert_torrent_job', {
      p_job_id:       job_id,
      p_requested_by: user.id,
      p_info_hash:    hash.trim(),
      p_stage:        stage,
      p_notification: 'Job queued',
    });
    if (rpcError) {
      console.error('[ingest/start] upsert_torrent_job:', rpcError.message);
    }

    return NextResponse.json({
      jobId: job_id,
      stage,
      meta: { title, description, quality, posterUrl },
    });

  } catch (err: any) {
    console.error('[ingest/start]', err);
    return NextResponse.json(
      { error: err.message ?? 'Failed to start ingest job' },
      { status: 502 },
    );
  }
}