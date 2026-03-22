import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';

async function isUserAdmin(supabase: ReturnType<typeof createServerSupabaseClient>, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', userId)
    .single();
  return data?.role === 'admin';
}

export async function POST(request: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const movieData = await request.json();

    // Verify the uploader is the current user
    if (movieData.uploaded_by !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: movie, error } = await supabase
      .from('movies')
      .insert(movieData)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ movie });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id, ...updates } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Movie ID required' }, { status: 400 });
    }

    // Verify ownership (admins can edit any movie)
    const { data: existing } = await supabase
      .from('movies')
      .select('uploaded_by')
      .eq('id', id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Movie not found' }, { status: 404 });
    }

    const isOwner = existing.uploaded_by === user.id;
    const admin   = await isUserAdmin(supabase, user.id);

    if (!isOwner && !admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Only allow editing safe fields — never blob_url, blob_name, uploaded_by
    const allowed = ['title', 'description', 'quality', 'duration', 'subtitles', 'poster_url', 'tmdb_id', 'release_date', 'rating', 'genres', 'runtime'];
    // Only admins can toggle public visibility
    if (admin) allowed.push('is_public');
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in updates) patch[key] = updates[key];
    }

    // Admin needs service role client to bypass RLS
    const db = admin ? createServiceRoleClient() : supabase;

    const { data: movie, error } = await db
      .from('movies')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ movie });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const movieId = searchParams.get('id');

    if (!movieId) {
      return NextResponse.json({ error: 'Movie ID required' }, { status: 400 });
    }

    // Verify ownership (admins can delete any movie)
    const { data: movie } = await supabase
      .from('movies')
      .select('uploaded_by')
      .eq('id', movieId)
      .single();

    if (!movie) {
      return NextResponse.json({ error: 'Movie not found' }, { status: 404 });
    }

    const isOwner = movie.uploaded_by === user.id;
    const admin   = await isUserAdmin(supabase, user.id);

    if (!isOwner && !admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Admin needs service role client to bypass RLS
    const db = admin ? createServiceRoleClient() : supabase;

    const { error } = await db.from('movies').delete().eq('id', movieId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
