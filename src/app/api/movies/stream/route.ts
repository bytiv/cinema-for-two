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
      .select('id, uploaded_by')
      .eq('blob_name', blobName)
      .single();

    if (!movie) {
      return NextResponse.json({ error: 'Movie not found' }, { status: 404 });
    }

    // Allow if user is the uploader
    if (movie.uploaded_by !== user.id) {
      const adminSupabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );

      // Check admin role
      const { data: profile } = await adminSupabase
        .from('profiles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      if (profile?.role !== 'admin') {
        // Check friendship in both directions
        const [{ data: reqRow }, { data: addrRow }] = await Promise.all([
          adminSupabase.from('friendships').select('id').eq('requester_id', user.id).eq('addressee_id', movie.uploaded_by).eq('status', 'accepted').maybeSingle(),
          adminSupabase.from('friendships').select('id').eq('requester_id', movie.uploaded_by).eq('addressee_id', user.id).eq('status', 'accepted').maybeSingle(),
        ]);

        // Check session-based invite access
        const { data: inviteRow } = await adminSupabase
          .from('watch_invites')
          .select('id')
          .eq('movie_id', movie.id)
          .eq('to_user_id', user.id)
          .eq('status', 'accepted')
          .maybeSingle();

        // Also allow if user is an active participant in any room for this movie
        let participantRow = null;
        const { data: activeRooms } = await adminSupabase
          .from('watch_rooms')
          .select('id')
          .eq('movie_id', movie.id)
          .eq('is_active', true);
        if (activeRooms && activeRooms.length > 0) {
          const roomIds = activeRooms.map((r) => r.id);
          const { data: pRow } = await adminSupabase
            .from('watch_room_participants')
            .select('id')
            .eq('user_id', user.id)
            .in('room_id', roomIds)
            .maybeSingle();
          participantRow = pRow;
        }

        if (!reqRow && !addrRow && !inviteRow && !participantRow) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
    }

    // Generate a streaming SAS URL (valid for 4 hours — short enough to stay fresh,
    // long enough not to expire mid-movie)
    const url = generateReadSasUrl(CONTAINERS.movies, blobName, 4);

    return NextResponse.json({ url }, {
      headers: {
        // Cache the SAS URL on the client for 30 minutes
        'Cache-Control': 'private, max-age=1800',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}