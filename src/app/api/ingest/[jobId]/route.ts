/**
 * DELETE /api/ingest/[jobId]
 *
 * Cancels a running ingest job.
 * Verifies the job belongs to the authenticated user before proxying
 * the cancel request to the Python API, then updates the audit row.
 */

import { NextResponse }                         from 'next/server';
import { createServerSupabaseClient,
         createServiceRoleClient }              from '@/lib/supabase/server';
import { cancelIngestJob }                      from '@/lib/ingest-api';

interface Params { params: { jobId: string } }

export async function DELETE(_req: Request, { params }: Params) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { jobId } = params;
    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    // ── Ownership check ──────────────────────────────────────────────────────
    const { data: auditRow } = await supabase
      .from('torrent_jobs')
      .select('requested_by, stage, info_hash')
      .eq('job_id', jobId)
      .single();

    if (!auditRow) {
      // No audit row means job was never recorded — still try to cancel it
      // in case it was created but the audit write failed
    } else if (auditRow.requested_by !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    } else if (['Ready', 'Failed', 'Cancelled'].includes(auditRow.stage)) {
      return NextResponse.json(
        { error: `Job already finished with stage: ${auditRow.stage}` },
        { status: 400 },
      );
    }

    // ── Cancel via Python API ────────────────────────────────────────────────
    const cancelledJob = await cancelIngestJob(jobId);

    // ── Update audit row ─────────────────────────────────────────────────────
    const service = createServiceRoleClient();
    await service.rpc('upsert_torrent_job', {
      p_job_id:       jobId,
      p_requested_by: user.id,
      p_info_hash:    auditRow?.info_hash ?? cancelledJob.info_hash ?? '',
      p_stage:        'Cancelled',
      p_notification: 'Job was cancelled by the user.',
    });

    return NextResponse.json(cancelledJob);

  } catch (err: any) {
    console.error('[ingest/cancel]', err);

    // Python API returns 400 when job is already finished
    if (err.message?.includes('400')) {
      return NextResponse.json(
        { error: 'Job is already finished and cannot be cancelled' },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: err.message ?? 'Failed to cancel job' },
      { status: 502 },
    );
  }
}