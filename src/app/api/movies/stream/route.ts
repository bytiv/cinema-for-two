/**
 * GET /api/movies/stream
 *
 * Returns a short-lived SAS streaming URL for a movie blob.
 * Called by the watch page to get a playable URL for the video player.
 *
 * Query params:
 *   blobName  string  — the blob_name stored on the movie row
 *
 * Returns: { url: string }
 */

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateReadSasUrl, CONTAINERS } from '@/lib/azure-blob';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const blobName = searchParams.get('blobName');

    if (!blobName) {
      return NextResponse.json({ error: 'blobName is required' }, { status: 400 });
    }

    // Generate a 4-hour SAS URL for streaming
    const url = generateReadSasUrl(CONTAINERS.movies, blobName, 4);

    return NextResponse.json({ url });
  } catch (err: any) {
    console.error('[movies/stream] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}