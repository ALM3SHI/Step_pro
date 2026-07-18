import Link from 'next/link';

const TABS = [
  { href: '/admin/hybrid', label: 'الإدخال الهجين' },
  { href: '/admin/listening', label: 'الاستماع' },
  { href: '/admin', label: 'المعالجة الآلية' },
  { href: '/admin/history', label: 'سجل التسليمات' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      {/* Ambient wash — gives the glass surfaces something to refract.
          Without a non-flat backdrop, backdrop-filter renders as plain
          translucency and the effect reads as muddy grey. */}
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
            <span className="mr-2 text-xs text-[color:var(--app-muted)]">لوحة الإدخال والمعالجة</span>
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
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-24">{children}</main>
    </div>
  );
}
