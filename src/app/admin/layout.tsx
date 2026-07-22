import Link from 'next/link';
import { activeContentSource } from '@/lib/content/activeProvider';
import { isAdmin } from '@/lib/auth/admin';
import { adminLogoutAction } from '@/app/actions/admin-auth';
import { Badge, linkClass } from '@/components/ui';

const TABS = [
  { href: '/admin', label: 'التجميعات' },
  { href: '/admin/import', label: 'الاستيراد' },
  { href: '/admin/listening', label: 'الاستماع' },
  { href: '/admin/history', label: 'السجل' },
  { href: '/admin/parser-debug', label: 'مراجعة المُحلّل' },
  { href: '/exam', label: 'المحاكي' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The login page lives under /admin too, so the chrome is conditional:
  // showing panel navigation to someone who cannot use it is noise, and
  // the content-source badge is itself information about the deployment.
  const authed = await isAdmin();

  return (
    <div className="min-h-screen">
      {/* Ambient wash — without a non-flat backdrop, backdrop-filter
          renders as plain translucency and the glass reads as grey. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            'radial-gradient(1100px 600px at 12% -10%, rgba(14,90,84,.22), transparent 60%),' +
            'radial-gradient(900px 500px at 88% 0%, rgba(217,142,50,.18), transparent 55%),' +
            'radial-gradient(800px 700px at 50% 110%, rgba(1,88,155,.16), transparent 60%)',
        }}
      />

      {authed && <AdminHeader />}

      <main className="mx-auto max-w-6xl px-6 pb-24">{children}</main>
    </div>
  );
}

function AdminHeader() {
  // Shown so the live source is never a guess — the whole point of the
  // migration was that there is exactly one.
  let source = 'bundle';
  try { source = activeContentSource(); } catch { /* unconfigured */ }

  return (
    <header className="glass sticky top-0 z-40 mb-6 rounded-b-2xl px-6 py-4">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4">
        <div>
          <b className="text-xl tracking-tight text-[color:var(--app-brand)]">ستيب برو</b>
          <span className="mr-2 text-xs text-[color:var(--app-muted)]">لوحة المحتوى</span>
        </div>

        <nav className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className={linkClass({ size: 'sm' })}>
              {t.label}
            </Link>
          ))}
        </nav>

        <span className="flex-1" />

        <Badge tone={source === 'supabase' ? 'good' : 'warn'}>
          {source === 'supabase' ? '● Supabase' : '● حزمة محلية'}
        </Badge>

        <form action={adminLogoutAction}>
          <button type="submit" className={linkClass({ variant: 'ghost', size: 'sm' })}>
            خروج
          </button>
        </form>
      </div>
    </header>
  );
}
