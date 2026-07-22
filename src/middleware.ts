import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_COOKIE, verifyAdminToken } from '@/lib/auth/adminToken';

/**
 * Two jobs, in order: gate the admin panel, then issue a device id.
 *
 * The admin gate here is a CONVENIENCE — it turns "you may not" into a
 * login redirect instead of a broken page. It is not the security
 * boundary: server actions are reachable without ever loading a page, so
 * the real check is `requireAdmin()` inside each action. Removing this
 * block would leak the panel's markup; removing that one would hand over
 * the question bank.
 *
 * Must match DEVICE_COOKIE in src/lib/auth/device.ts. Duplicated as a
 * literal on purpose: this file runs in the Edge runtime and must not
 * import the Node-only `next/headers` module that device.ts uses.
 */
const DEVICE_COOKIE = 'device_id';
const TWO_YEARS_SECONDS = 60 * 60 * 24 * 730;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/admin') && !pathname.startsWith('/admin/login')) {
    const ok = await verifyAdminToken(request.cookies.get(ADMIN_COOKIE)?.value, Date.now());
    if (!ok) {
      const url = request.nextUrl.clone();
      url.pathname = '/admin/login';
      // Carry the intended destination so login lands where they meant
      // to go, not always on the panel home.
      url.search = `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(url);
    }
  }

  if (request.cookies.get(DEVICE_COOKIE)) return NextResponse.next();

  const id = crypto.randomUUID();

  // Forward onto the current request so the first render already reads it,
  request.cookies.set(DEVICE_COOKIE, id);
  const response = NextResponse.next({ request: { headers: request.headers } });
  // and persist it to the browser for every visit after this one.
  response.cookies.set(DEVICE_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: TWO_YEARS_SECONDS,
  });
  return response;
}

export const config = {
  // Everything except static assets and the listening audio files — none
  // of those need an identity, and skipping them keeps the cookie work
  // off the hot asset path.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|listening/).*)'],
};
