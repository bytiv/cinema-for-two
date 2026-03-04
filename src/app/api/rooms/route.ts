import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { movie_id } = await request.json();

    // Create a new watch room
    const { data: room, error } = await supabase
      .from('watch_rooms')
      .insert({
        movie_id,
        host_user_id: user.id,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Add host as participant
    await supabase.from('watch_room_participants').insert({
      room_id: room.id,
      user_id: user.id,
    });

    return NextResponse.json({ room });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Deactivate a room
export async function PATCH(request: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { room_id } = await request.json();

    const { error } = await supabase
      .from('watch_rooms')
      .update({ is_active: false })
      .eq('id', room_id)
      .eq('host_user_id', user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
