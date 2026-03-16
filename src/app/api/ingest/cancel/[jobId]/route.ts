import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
import { cancelIngestJob }           from '@/lib/ingest-api';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function getLiveIP(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('container_state')
    .select('container_ip')
    .eq('id', 1)
    .single();
  return data?.container_ip ?? null;
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { jobId: string } },
) {
  const ip = await getLiveIP();
  if (!ip) {
    return NextResponse.json({ error: 'Ingest service is not running' }, { status: 503 });
  }
  try {
    const result = await cancelIngestJob(ip, params.jobId);

    await supabaseAdmin
      .from('ingest_jobs')
      .update({ status: 'cancelled', finished_at: new Date().toISOString() })
      .eq('id', params.jobId);

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}