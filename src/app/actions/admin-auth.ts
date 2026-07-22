'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  ADMIN_COOKIE, ADMIN_SESSION_SECONDS,
  checkAdminPassword, isAdminConfigured, issueAdminToken,
} from '@/lib/auth/adminToken';

/**
 * Login and logout for the content panel.
 *
 * A single shared password rather than accounts: this gate exists to keep
 * ordinary visitors out of the question bank, and the platform has no
 * concept of multiple editors yet. When real accounts land, only this
 * file and `lib/auth/admin.ts` change — every caller already asks the
 * same `requireAdmin()` question.
 */

export interface LoginResult {
  ok: boolean;
  error?: string;
}

export async function adminLoginAction(password: string): Promise<LoginResult> {
  if (!isAdminConfigured()) {
    return {
      ok: false,
      error: 'لوحة الإدارة غير مفعّلة. أضف ADMIN_PASSWORD في .env.local ثم أعد تشغيل الخادم.',
    };
  }

  if (!checkAdminPassword(password)) {
    // One message for every failure. Distinguishing "wrong password" from
    // anything else would confirm to a prober that they are on the right
    // track.
    return { ok: false, error: 'كلمة المرور غير صحيحة.' };
  }

  const token = await issueAdminToken(Date.now());
  if (!token) return { ok: false, error: 'تعذّر إنشاء الجلسة.' };

  const store = await cookies();
  store.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Never sent over plain HTTP in production; left off locally so the
    // panel still works on http://localhost.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_SESSION_SECONDS,
  });

  return { ok: true };
}

export async function adminLogoutAction(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  redirect('/');
}
