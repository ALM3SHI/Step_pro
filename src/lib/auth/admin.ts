import 'server-only';
import { cookies } from 'next/headers';
import { ADMIN_COOKIE, isAdminConfigured, verifyAdminToken } from './adminToken';

/**
 * Admin identity, server side.
 *
 * The middleware hides `/admin/*` from the browser, but hiding a page is
 * not access control: every server action is its own public HTTP endpoint
 * and can be invoked without ever loading the page. `requireAdmin()` is
 * therefore called at the top of EVERY content mutation — that call, not
 * the middleware, is what actually protects the question bank.
 */

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return verifyAdminToken(store.get(ADMIN_COOKIE)?.value, Date.now());
}

/** Thrown by `requireAdmin`. Carries no detail — the client learns only
 *  that it is not authorised. */
export class NotAdminError extends Error {
  constructor() {
    super('غير مصرّح. سجّل الدخول إلى لوحة الإدارة أولًا.');
    this.name = 'NotAdminError';
  }
}

/**
 * Fails closed.
 *
 * With no ADMIN_PASSWORD set, nobody can ever be an admin — the panel is
 * unusable rather than open. An unconfigured deployment silently allowing
 * every visitor to delete the bank is the exact failure this guards.
 */
export async function requireAdmin(): Promise<void> {
  if (!isAdminConfigured()) throw new NotAdminError();
  if (!(await isAdmin())) throw new NotAdminError();
}

export { isAdminConfigured };
