import { NextResponse, type NextRequest } from 'next/server';

/**
 * Issue a stable anonymous device id.
 *
 * With no auth yet, this cookie is what keeps one visitor's attempts and
 * progress from being served to another. It is created here rather than
 * in a Server Component because a component render cannot set a cookie,
 * and `/progress` needs the id available on its very first render — so the
 * new id is forwarded onto this request too, not only stored for later.
 *
 * Must match DEVICE_COOKIE in src/lib/auth/device.ts. Duplicated as a
 * literal on purpose: this file runs in the Edge runtime and must not
 * import the Node-only `next/headers` module that device.ts uses.
 */
const DEVICE_COOKIE = 'device_id';
const TWO_YEARS_SECONDS = 60 * 60 * 24 * 730;

export function middleware(request: NextRequest) {
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
