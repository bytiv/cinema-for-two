import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
import { cancelIngestJob, getJobContainerInfo } from '@/lib/ingest-api';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { jobId: string } },
) {
  const info = await getJobContainerInfo(params.jobId);
  if (!info) {
    // Container may already be gone — just mark cancelled in DB
    await supabaseAdmin
      .from('ingest_jobs')
      .update({ status: 'cancelled', finished_at: new Date().toISOString() })
      .eq('id', params.jobId);
    return NextResponse.json({ stage: 'Cancelled', notification: 'Job cancelled (container already stopped).' });
  }
  try {
    const result = await cancelIngestJob(info.ip, info.hmacSecret, params.jobId);

    await supabaseAdmin
      .from('ingest_jobs')
      .update({ status: 'cancelled', finished_at: new Date().toISOString() })
      .eq('id', params.jobId);

    return NextResponse.json(result);
  } catch (err: any) {
    // If the container is unreachable, still mark cancelled
    await supabaseAdmin
      .from('ingest_jobs')
      .update({ status: 'cancelled', finished_at: new Date().toISOString() })
      .eq('id', params.jobId);
    return NextResponse.json({ stage: 'Cancelled', notification: 'Job cancelled.' });
  }
}