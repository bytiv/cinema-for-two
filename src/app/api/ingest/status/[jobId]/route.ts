import { NextRequest, NextResponse } from 'next/server';
import { getIngestJobStatus, getJobContainerInfo } from '@/lib/ingest-api';

export async function GET(
  _req: NextRequest,
  { params }: { params: { jobId: string } },
) {
  const info = await getJobContainerInfo(params.jobId);
  if (!info) {
    return NextResponse.json({ error: 'Ingest container is not running for this job' }, { status: 503 });
  }
  try {
    const status = await getIngestJobStatus(info.ip, info.hmacSecret, params.jobId);
    return NextResponse.json(status);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}