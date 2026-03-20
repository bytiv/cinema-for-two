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

/**
 * Map a file extension (or stored format value) to a browser-friendly MIME type.
 * Torrent-ingested blobs may have been uploaded without a Content-Type header,
 * causing Azure to default to application/octet-stream.  When the browser
 * receives that generic type it often fails to initialise the audio decoder,
 * which is why some movies play without sound.
 *
 * By setting the correct Content-Type via the SAS `rsct` parameter we ensure
 * the browser always knows how to demux the container — audio included.
 */
function videoMimeType(blobName: string, format?: string | null): string {
  const ext = (format || blobName.split('.').pop() || '').toLowerCase();
  const map: Record<string, string> = {
    mp4:  'video/mp4',
    m4v:  'video/mp4',
    webm: 'video/webm',
    mkv:  'video/x-matroska',
    avi:  'video/x-msvideo',
    mov:  'video/quicktime',
    wmv:  'video/x-ms-wmv',
    ts:   'video/mp2t',
    flv:  'video/x-flv',
  };
  return map[ext] || 'video/mp4';
}

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

    // Look up the movie's stored format so we can set the correct Content-Type
    const { data: movie } = await supabase
      .from('movies')
      .select('format')
      .eq('blob_name', blobName)
      .single();

    const contentType = videoMimeType(blobName, movie?.format);

    // Generate a 4-hour SAS URL for streaming, with the correct Content-Type
    const url = generateReadSasUrl(CONTAINERS.movies, blobName, 4, contentType);

    return NextResponse.json({ url });
  } catch (err: any) {
    console.error('[movies/stream] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}