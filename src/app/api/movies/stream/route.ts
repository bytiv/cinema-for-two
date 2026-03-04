import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { generateReadSasUrl, CONTAINERS } from '@/lib/azure-blob';

export async function GET(request: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const blobName = searchParams.get('blobName');

    if (!blobName) {
      return NextResponse.json({ error: 'Blob name required' }, { status: 400 });
    }

    // Find the movie by blobName to check ownership
    const { data: movie } = await supabase
      .from('movies')
      .select('uploaded_by')
      .eq('blob_name', blobName)
      .single();

    if (!movie) {
      return NextResponse.json({ error: 'Movie not found' }, { status: 404 });
    }

    // Allow if user is the uploader
    if (movie.uploaded_by !== user.id) {
      // Check friendship in both directions
      const adminSupabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );

      const [{ data: reqRow }, { data: addrRow }] = await Promise.all([
        adminSupabase.from('friendships').select('id').eq('requester_id', user.id).eq('addressee_id', movie.uploaded_by).eq('status', 'accepted').maybeSingle(),
        adminSupabase.from('friendships').select('id').eq('requester_id', movie.uploaded_by).eq('addressee_id', user.id).eq('status', 'accepted').maybeSingle(),
      ]);

      if (!reqRow && !addrRow) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Generate a streaming SAS URL (valid for 24 hours)
    const url = generateReadSasUrl(CONTAINERS.movies, blobName, 24);

    return NextResponse.json({ url });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}