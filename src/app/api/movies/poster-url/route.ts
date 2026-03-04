import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateReadSasUrl, CONTAINERS } from '@/lib/azure-blob';

// Extracts blob name from a full URL or returns the value as-is if it's already a blob name
function extractBlobName(posterUrl: string): string {
  try {
    const url = new URL(posterUrl);
    // URL path is like /posters/userId/filename
    // Remove the leading container name from path
    const parts = url.pathname.split('/').filter(Boolean);
    // parts[0] is container name, rest is the blob name
    return parts.slice(1).join('/');
  } catch {
    // Not a URL, treat as blob name directly
    return posterUrl;
  }
}

export async function GET(request: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const posterUrl = searchParams.get('posterUrl');

    if (!posterUrl) {
      return NextResponse.json({ error: 'posterUrl required' }, { status: 400 });
    }

    const blobName = extractBlobName(posterUrl);
    const sasUrl = generateReadSasUrl(CONTAINERS.posters, blobName, 4); // 4 hours

    return NextResponse.json({ url: sasUrl });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
