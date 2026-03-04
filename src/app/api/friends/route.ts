import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { email } = await request.json();
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    if (email === user.email) {
      return NextResponse.json({ error: "You can't send a friend request to yourself" }, { status: 400 });
    }

    const adminSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Look up target user by email
    const { data: { users }, error: lookupError } = await adminSupabase.auth.admin.listUsers();
    if (lookupError) {
      return NextResponse.json({ error: 'Failed to look up user' }, { status: 500 });
    }

    const targetUser = users.find((u) => u.email === email.toLowerCase());
    if (!targetUser) {
      return NextResponse.json({ error: 'No user found with that email' }, { status: 404 });
    }

    // Check both directions separately to avoid .or() RLS issues
    const { data: existingAB } = await adminSupabase
      .from('friendships')
      .select('id, status')
      .eq('requester_id', user.id)
      .eq('addressee_id', targetUser.id)
      .maybeSingle();

    const { data: existingBA } = await adminSupabase
      .from('friendships')
      .select('id, status')
      .eq('requester_id', targetUser.id)
      .eq('addressee_id', user.id)
      .maybeSingle();

    // Already friends
    if (existingAB?.status === 'accepted' || existingBA?.status === 'accepted') {
      return NextResponse.json({ error: 'You are already friends!' }, { status: 400 });
    }

    // User sent a request that's still pending
    if (existingAB?.status === 'pending') {
      return NextResponse.json({ error: 'You already sent them a friend request' }, { status: 400 });
    }

    // They already sent us a request — auto-accept
    if (existingBA?.status === 'pending') {
      await adminSupabase
        .from('friendships')
        .update({ status: 'accepted' })
        .eq('id', existingBA.id);
      return NextResponse.json({ success: true, autoAccepted: true });
    }

    // No existing relationship — create new request
    const { error: insertError } = await adminSupabase
      .from('friendships')
      .insert({
        requester_id: user.id,
        addressee_id: targetUser.id,
        status: 'pending',
      });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}