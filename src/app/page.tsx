import Link from 'next/link';

const LINKS = [
  { href: '/admin', title: 'لوحة الإدخال', desc: 'إدخال التجميعات، المعالجة، والمراجعة السريعة' },
  { href: '/admin/history', title: 'سجل التسليمات', desc: 'إدارة الدفعات وحذفها' },
  { href: '/exam/demo', title: 'محاكي الاختبار', desc: 'واجهة اختبار STEP' },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold text-[color:var(--app-brand)]">ستيب برو</h1>
      <p className="mb-8 text-[color:var(--app-muted)]">منصة التحضير لاختبار STEP</p>

      <div className="grid gap-4 sm:grid-cols-2">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-2xl border border-[color:var(--app-line)] p-5 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          >
            <b className="block">{l.title}</b>
            <span className="text-sm text-[color:var(--app-muted)]">{l.desc}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
