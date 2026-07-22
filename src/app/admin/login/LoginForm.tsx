'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { adminLoginAction } from '@/app/actions/admin-auth';
import { Alert, Button, Card, SectionTitle, inputClass } from '@/components/ui';

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await adminLoginAction(password);
      if (!res.ok) { setError(res.error ?? 'تعذّر تسجيل الدخول'); return; }
      // The cookie is set; refresh so the middleware re-evaluates and the
      // server components render as an admin.
      router.replace(next);
      router.refresh();
    });
  };

  return (
    <Card className="p-6">
      <SectionTitle hint="هذه اللوحة تعدّل بنك الأسئلة مباشرة، والدخول إليها محصور.">
        دخول لوحة المحتوى
      </SectionTitle>

      {error && <Alert tone="bad">{error}</Alert>}

      <form onSubmit={submit} className="mt-4 space-y-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="كلمة مرور الإدارة"
          autoFocus
          autoComplete="current-password"
          className={inputClass()}
        />
        <Button type="submit" variant="primary" block disabled={pending || !password}>
          {pending ? '…جارٍ التحقق' : 'دخول'}
        </Button>
      </form>
    </Card>
  );
}
