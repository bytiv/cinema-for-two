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

  const { data: { user } } = await supabase.auth.getUser();

  // Protected routes
  const protectedPaths = ['/browse', '/movie', '/watch', '/upload', '/profile', '/friends'];
  const isProtected = protectedPaths.some(path => request.nextUrl.pathname.startsWith(path));
  const isAdminPath = request.nextUrl.pathname.startsWith('/admin');
  const isPendingPath = request.nextUrl.pathname === '/pending-approval';

  if ((isProtected || isAdminPath) && !user) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('redirect', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // If user is logged in, check approval status for protected routes
  if (user && (isProtected || isAdminPath)) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('status, role')
      .eq('user_id', user.id)
      .single();

    if (profile) {
      // If pending or denied, redirect to pending page (unless they're already there)
      if (profile.status !== 'approved' && !isPendingPath) {
        return NextResponse.redirect(new URL('/pending-approval', request.url));
      }

      // Admin page: only admins allowed
      if (isAdminPath && profile.role !== 'admin') {
        return NextResponse.redirect(new URL('/browse', request.url));
      }
    }
  }

  // Allow pending users to see the pending page
  if (isPendingPath && !user) {
    const loginUrl = new URL('/auth/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect logged-in users away from auth pages
  const authPaths = ['/auth/login', '/auth/signup'];
  if (authPaths.includes(request.nextUrl.pathname) && user) {
    return NextResponse.redirect(new URL('/browse', request.url));
  }

  return response;
}
