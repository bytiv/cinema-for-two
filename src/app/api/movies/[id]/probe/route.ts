/**
 * GET  /api/movies/[id]/probe
 *   Returns a short-lived SAS URL for the movie blob so the client can
 *   probe duration via a <video> element. Also returns current file_size
 *   so the client knows whether a back-fill is needed.
 *
 * POST /api/movies/[id]/probe
 *   Body: { duration?: number; file_size?: number }
 *   Back-fills duration and/or file_size on the movie row after the client
 *   has probed them. Only updates fields that are currently null.
 */

import { NextResponse }    from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { generateReadSasUrl, CONTAINERS } from '@/lib/azure-blob';

interface Params { params: { id: string } }

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(_req: Request, { params }: Params) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: movie } = await supabase
      .from('movies')
      .select('blob_name, file_size, duration, uploaded_by')
      .eq('id', params.id)
      .single();

    if (!movie) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (movie.uploaded_by !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Generate a 1-hour SAS URL the client can hand to a <video> element
    const sasUrl = generateReadSasUrl(CONTAINERS.movies, movie.blob_name, 1);

    return NextResponse.json({
      sasUrl,
      file_size: movie.file_size,
      duration:  movie.duration,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: Request, { params }: Params) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body: { duration?: number; file_size?: number } = await req.json();

    // Verify ownership and check which fields actually need updating
    const { data: movie } = await supabase
      .from('movies')
      .select('uploaded_by, duration, file_size')
      .eq('id', params.id)
      .single();

    if (!movie) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (movie.uploaded_by !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const patch: Record<string, unknown> = {};

    // Only back-fill fields that are currently null/zero
    if (body.duration != null && body.duration > 0 && !movie.duration) {
      patch.duration = Math.round(body.duration);
    }
    if (body.file_size != null && body.file_size > 0 && !movie.file_size) {
      patch.file_size = body.file_size;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ updated: false, reason: 'Nothing to update' });
    }

    const service = createServiceRoleClient();
    const { error } = await service
      .from('movies')
      .update(patch)
      .eq('id', params.id);

    if (error) throw new Error(error.message);

    return NextResponse.json({ updated: true, patch });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}