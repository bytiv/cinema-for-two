/**
 * POST /api/ingest/finalize
 *
 * Called by the client after a torrent job reaches "Ready" and the client
 * has finished uploading poster + subtitles to Azure.
 *
 * Creates the movie row in Supabase.
 *
 * Body: {
 *   job_id:      string
 *   blob_url:    string
 *   title:       string
 *   description?: string
 *   quality?:    string
 *   poster_url?: string
 *   subtitles?:  { label: string; lang: string; url: string }[]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateReadSasUrl, CONTAINERS } from '@/lib/azure-blob';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { job_id, blob_url, title, description, quality, poster_url, subtitles,
            tmdb_id, release_date, rating, genres, runtime } = body;

    if (!job_id || !blob_url || !title) {
      return NextResponse.json({ error: 'job_id, blob_url, and title are required' }, { status: 400 });
    }

    // Verify the job belongs to this user
    const { data: job } = await supabaseAdmin
      .from('ingest_jobs')
      .select('user_id, hash, status')
      .eq('id', job_id)
      .single();

    if (!job || job.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Derive blob_name from blob_url
    const containerName = process.env.AZURE_STORAGE_CONTAINER_MOVIES ?? 'movies';
    const afterContainer = blob_url.split(`/${containerName}/`)[1];
    if (!afterContainer) {
      return NextResponse.json({ error: 'Invalid blob_url format' }, { status: 400 });
    }

    const blobName = afterContainer;
    const ext      = blobName.split('.').pop()?.toLowerCase() ?? 'mp4';
    const format   = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'm4v', 'ts'].includes(ext) ? ext : 'mp4';

    // Probe file size via SAS URL
    let fileSize = 0;
    try {
      const sasUrl = generateReadSasUrl(CONTAINERS.movies, blobName, 1);
      const head = await fetch(sasUrl, { method: 'HEAD' });
      const cl = parseInt(head.headers.get('content-length') ?? '0', 10);
      if (!isNaN(cl)) fileSize = cl;
    } catch {}

    // Insert movie row
    const { data: movie, error: movieError } = await supabaseAdmin
      .from('movies')
      .insert({
        title:         title.trim(),
        description:   description?.trim() ?? null,
        blob_url,
        blob_name:     blobName,
        poster_url:    poster_url ?? null,
        file_size:     fileSize,
        format,
        quality:       quality ?? null,
        duration:      null, // will be probed client-side later
        subtitles:     subtitles ?? [],
        ingest_method: 'torrent',
        info_hash:     job.hash,
        ingest_job_id: job_id,
        uploaded_by:   user.id,
        // TMDB metadata
        tmdb_id:       tmdb_id ?? null,
        release_date:  release_date ?? null,
        rating:        rating ?? null,
        genres:        genres ?? null,
        runtime:       runtime ?? null,
      })
      .select('id')
      .single();

    if (movieError || !movie) {
      return NextResponse.json(
        { error: `Failed to create movie: ${movieError?.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ movie_id: movie.id });
  } catch (err: any) {
    console.error('[ingest/finalize]', err);
    return NextResponse.json({ error: err.message ?? 'Unexpected error' }, { status: 500 });
  }
}