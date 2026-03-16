import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
import { getIngestJobStatus }        from '@/lib/ingest-api';

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

export async function GET(
  _req: NextRequest,
  { params }: { params: { jobId: string } },
) {
  const ip = await getLiveIP();
  if (!ip) {
    return NextResponse.json({ error: 'Ingest service is not running' }, { status: 503 });
  }
  try {
    const status = await getIngestJobStatus(ip, params.jobId);
    return NextResponse.json(status);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}