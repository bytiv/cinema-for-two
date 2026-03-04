import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateUploadSasUrl, generateReadSasUrl, ensureContainers, CONTAINERS } from '@/lib/azure-blob';

export async function POST(request: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { container, blobName, contentType } = await request.json();

    // Validate container
    const validContainers = Object.values(CONTAINERS);
    if (!validContainers.includes(container)) {
      return NextResponse.json({ error: 'Invalid container' }, { status: 400 });
    }

    // Ensure containers exist
    await ensureContainers();

    // Generate both upload and read SAS URLs
    const uploadUrl = generateUploadSasUrl(container, blobName);
    const readUrl = generateReadSasUrl(container, blobName, 8760); // 1 year

    return NextResponse.json({ uploadUrl, readUrl });
  } catch (error: any) {
    console.error('SAS generation error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
