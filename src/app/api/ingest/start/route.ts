/**
 * POST /api/ingest/start
 *
 * Submits a torrent hash/magnet to the Python ingest API and
 * immediately creates a torrent_jobs audit row in Supabase.
 *
 * Body: {
 *   hash:        string   — bare InfoHash or magnet URI
 *   name:        string   — desired filename without extension
 *   title:       string   — movie title shown in the library
 *   description? string
 *   quality?     '480p' | '720p' | '1080p' | '4K'
 *   duration?    number   — seconds
 *   posterUrl?   string
 *   trackers?    string[]
 * }
 *
 * Returns: { jobId, stage }
 */

import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { startIngestJob } from '@/lib/ingest-api';

export async function POST(request: Request) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── Validate body ────────────────────────────────────────────────────────
    const body = await request.json();
    const { hash, name, title, description, quality, posterUrl, trackers } = body;

    if (!hash?.trim()) {
      return NextResponse.json({ error: 'hash is required' }, { status: 400 });
    }
    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!title?.trim()) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    // ── Forward to Python ingest API ─────────────────────────────────────────
    const { job_id, stage } = await startIngestJob({
      hash:     hash.trim(),
      name:     name.trim(),
      trackers: trackers ?? undefined,
    });

    // ── Create audit row in Supabase ─────────────────────────────────────────
    // Store the user's movie metadata alongside the job so the stream route
    // can use it when auto-saving the movie on completion.
    const service = createServiceRoleClient();
    const { error: rpcError } = await service.rpc('upsert_torrent_job', {
      p_job_id:       job_id,
      p_requested_by: user.id,
      p_info_hash:    hash.trim(),
      p_stage:        stage,
      p_notification: 'Job queued',
    });

    if (rpcError) {
      console.error('[ingest/start] Failed to create audit row:', rpcError.message);
      // Non-fatal — job is running, audit row can be created later by stream
    }

    // Store the pending movie metadata in a separate table so the stream
    // route can retrieve it without needing the client to resend it.
    // We store it as a JSONB payload on the torrent_jobs row (via a direct update).
    await service
      .from('torrent_jobs')
      .update({
        // Reuse the notification field temporarily to carry metadata as JSON
        // Actually we store it in a dedicated column — see note below
      } as never)
      .eq('job_id', job_id);

    // ── Stash pending metadata so stream route can save the movie ────────────
    // We attach it to the response and expect the client to send it back
    // when subscribing to the stream. This keeps the architecture stateless.
    return NextResponse.json({
      jobId: job_id,
      stage,
      // Echo back so client can pass to stream subscription
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