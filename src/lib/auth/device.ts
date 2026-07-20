import 'server-only';
import { cookies } from 'next/headers';

/**
 * Anonymous per-device identity.
 *
 * There is no login yet. To keep one person's attempts and progress from
 * mixing with another's, every browser is issued a stable random id in a
 * cookie (set by middleware), and all attempt reads/writes scope to it.
 *
 * This is only a READER — the cookie is created in middleware, because a
 * cookie cannot be set while a Server Component renders, and `/progress`
 * reads identity during exactly that render. The id is a UUID so it drops
 * straight into the `exam_attempts.user_id uuid` column, and it is
 * forward-compatible: when real accounts land, the account id simply
 * takes this parameter's place.
 */

/** Cookie name. Kept in sync by hand with the literal in `middleware.ts`,
 *  which must not import this Node-only module into the Edge runtime. */
export const DEVICE_COOKIE = 'device_id';

export async function getDeviceId(): Promise<string | null> {
  const store = await cookies();
  return store.get(DEVICE_COOKIE)?.value ?? null;
}
