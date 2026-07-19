import Link from 'next/link';
import { activeContentSource } from '@/lib/content/activeProvider';

const TABS = [
  { href: '/admin', label: 'التجميعات' },
  { href: '/exam', label: 'المحاكي' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // Shown so the live source is never a guess — the whole point of the
  // migration was that there is exactly one.
  let source = 'bundle';
  try { source = activeContentSource(); } catch { /* unconfigured */ }

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

      <header className="glass sticky top-0 z-40 mb-6 rounded-b-2xl px-6 py-4">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4">
          <div>
            <b className="text-xl tracking-tight text-[color:var(--app-brand)]">ستيب برو</b>
            <span className="mr-2 text-xs text-[color:var(--app-muted)]">لوحة المحتوى</span>
          </div>

          <nav className="flex gap-2">
            {TABS.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className="rounded-full border border-[color:var(--app-line)] px-4 py-1.5 text-sm font-semibold transition-colors hover:bg-black/5 dark:hover:bg-white/10"
              >
                {t.label}
              </Link>
            ))}
          </nav>

          <span className="flex-1" />

          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              source === 'supabase'
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
            }`}
            title="مصدر المحتوى الحالي"
          >
            {source === 'supabase' ? '● Supabase' : '● حزمة محلية'}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-24">{children}</main>
    </div>
  );
}
