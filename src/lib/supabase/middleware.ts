import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );

  // Determine if this route actually needs auth checks
  const protectedPaths = ['/browse', '/movie', '/watch', '/upload', '/profile', '/friends'];
  const isProtected = protectedPaths.some(path => request.nextUrl.pathname.startsWith(path));
  const isAdminPath = request.nextUrl.pathname.startsWith('/admin');
  const isPendingPath = request.nextUrl.pathname === '/pending-approval';
  const authPaths = ['/auth/login', '/auth/signup'];
  const isAuthPath = authPaths.includes(request.nextUrl.pathname);

  // Skip Supabase calls entirely for public/non-sensitive routes
  const needsAuth = isProtected || isAdminPath || isPendingPath || isAuthPath;
  if (!needsAuth) return response;

  // Single getUser call — this refreshes the session cookie too
  const { data: { user } } = await supabase.auth.getUser();

  if ((isProtected || isAdminPath) && !user) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('redirect', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Only query profiles DB when needed (protected routes + logged in user)
  if (user && (isProtected || isAdminPath)) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('status, role')
      .eq('user_id', user.id)
      .single();

    if (profile) {
      if (profile.status !== 'approved' && !isPendingPath) {
        return NextResponse.redirect(new URL('/pending-approval', request.url));
      }
      if (isAdminPath && profile.role !== 'admin') {
        return NextResponse.redirect(new URL('/browse', request.url));
      }
    }
  }

  if (isPendingPath && !user) {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  if (isAuthPath && user) {
    return NextResponse.redirect(new URL('/browse', request.url));
  }

  return response;
}