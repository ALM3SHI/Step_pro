import { redirect } from 'next/navigation';
import { isAdmin, isAdminConfigured } from '@/lib/auth/admin';
import { Alert, Card, SectionTitle } from '@/components/ui';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  // Only same-site paths. An open redirect here would let a crafted link
  // bounce a freshly-authenticated admin to an attacker's page.
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/admin';

  if (await isAdmin()) redirect(target);

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      {!isAdminConfigured() ? (
        <Card className="p-6">
          <SectionTitle>لوحة الإدارة غير مفعّلة</SectionTitle>
          <Alert tone="warn">
            أضف <code dir="ltr">ADMIN_PASSWORD</code> إلى <code dir="ltr">.env.local</code> ثم
            أعد تشغيل الخادم. بدونها تبقى اللوحة مغلقة على الجميع — وهو السلوك المقصود.
          </Alert>
        </Card>
      ) : (
        <LoginForm next={target} />
      )}
    </div>
  );
}
