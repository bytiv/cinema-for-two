/**
 * GET /api/ingest/[jobId]/status
 *
 * Returns a single status snapshot for a job.
 * Useful for polling or for re-hydrating the UI after a page reload.
 */

import { NextResponse }                   from 'next/server';
import { createServerSupabaseClient }     from '@/lib/supabase/server';
import { getIngestJobStatus }             from '@/lib/ingest-api';

interface Params { params: { jobId: string } }

export async function GET(_req: Request, { params }: Params) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { jobId } = params;
    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    // ── Verify job belongs to this user (check Supabase audit row) ─────────
    const { data: auditRow } = await supabase
      .from('torrent_jobs')
      .select('requested_by')
      .eq('job_id', jobId)
      .single();

    // If there's an audit row and it belongs to someone else, reject.
    // If there's no audit row yet (race condition on job start), allow through.
    if (auditRow && auditRow.requested_by !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ── Proxy to Python API ────────────────────────────────────────────────
    const job = await getIngestJobStatus(jobId);

    return NextResponse.json(job);

  } catch (err: any) {
    console.error('[ingest/status]', err);
    return NextResponse.json(
      { error: err.message ?? 'Failed to fetch job status' },
      { status: 502 },
    );
  }
}