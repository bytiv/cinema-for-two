import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// GET /api/rooms/cleanup - Suspend rooms with no activity for 10+ minutes
// Can be called via cron or on page load
export async function GET() {
  try {
    const supabase = createServerSupabaseClient();

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    // Suspend rooms that have been inactive for 10+ minutes
    const { data, error } = await supabase
      .from('watch_rooms')
      .update({
        is_active: false,
        suspended_at: new Date().toISOString(),
      })
      .eq('is_active', true)
      .lt('last_activity_at', tenMinutesAgo)
      .select('id');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      suspended: data?.length || 0,
      message: `Suspended ${data?.length || 0} inactive rooms`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
