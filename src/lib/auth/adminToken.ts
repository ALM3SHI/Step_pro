/**
 * Admin session tokens.
 *
 * Deliberately dependency-free and built on Web Crypto so the SAME code
 * verifies a token in the Edge middleware (which gates `/admin/*`) and in
 * Node server actions (which gate every write). Two implementations would
 * be two chances to disagree about who is an admin.
 *
 * The token is a signed assertion, not a lookup key: there is no session
 * table, so a stolen cookie cannot be revoked individually — rotating
 * ADMIN_SESSION_SECRET invalidates every outstanding session at once.
 */

export const ADMIN_COOKIE = 'admin_session';

/** Eight hours. Long enough for a content session, short enough that a
 *  forgotten login on a shared machine expires the same day. */
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

const encoder = new TextEncoder();

/**
 * The signing key.
 *
 * Falls back to deriving from ADMIN_PASSWORD so a working setup needs one
 * variable rather than two — but the derivation is namespaced, so the
 * signing key is never literally the password.
 */
function secretMaterial(): string | null {
  const explicit = process.env.ADMIN_SESSION_SECRET?.trim();
  if (explicit) return explicit;
  const password = process.env.ADMIN_PASSWORD?.trim();
  return password ? `derived-session-key:${password}` : null;
}

/** True when an admin password is configured at all. */
export function isAdminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD?.trim());
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function toBase64Url(bytes: ArrayBuffer): string {
  const chars = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(chars).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  return toBase64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

/**
 * Compare without leaking where the first difference is.
 *
 * A `===` on a signature lets an attacker recover it byte by byte from
 * response timing. The lengths are compared first only because they are
 * public, and the loop still runs over the full expected length.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Mint a token that asserts "admin, until `exp`". */
export async function issueAdminToken(nowMs: number): Promise<string | null> {
  const secret = secretMaterial();
  if (!secret) return null;
  const exp = Math.floor(nowMs / 1000) + ADMIN_SESSION_SECONDS;
  return `${exp}.${await sign(`admin|${exp}`, secret)}`;
}

/**
 * Verify a token. Any malformed, expired, or mis-signed value is simply
 * "not an admin" — the caller gets a boolean and never a reason, so a
 * probe cannot distinguish a bad signature from an expired one.
 */
export async function verifyAdminToken(
  token: string | undefined | null,
  nowMs: number,
): Promise<boolean> {
  if (!token) return false;
  const secret = secretMaterial();
  if (!secret) return false;

  const dot = token.indexOf('.');
  if (dot <= 0) return false;

  const expPart = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!/^\d+$/.test(expPart) || !signature) return false;

  // Expiry is checked BEFORE the HMAC so an expired token costs no crypto.
  const exp = Number(expPart);
  if (!Number.isSafeInteger(exp) || exp * 1000 <= nowMs) return false;

  try {
    return timingSafeEqual(signature, await sign(`admin|${exp}`, secret));
  } catch {
    return false;
  }
}

/** Check a submitted password against the configured one. */
export function checkAdminPassword(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD?.trim();
  if (!expected) return false;
  return timingSafeEqual(candidate, expected);
}
