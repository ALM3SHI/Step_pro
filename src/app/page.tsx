import Link from 'next/link';
import { SECTION_LIST } from '@/lib/content/taxonomy';
import { getPoolSummary } from '@/app/actions/exam';
import { isAdmin } from '@/lib/auth/admin';
import { Card, linkClass } from '@/components/ui';

export const dynamic = 'force-dynamic';

const FEATURES = [
  {
    icon: '🎯',
    title: 'محاكاة مطابقة لقياس',
    body: 'نفس واجهة الاختبار الحقيقي: مؤقت لكل جزء، شاشة مراجعة، وقفل الأجزاء السابقة.',
  },
  {
    icon: '📊',
    title: 'تحليل 27 مهارة',
    body: 'لا نكتفي بدرجتك — نبيّن أي مهارة بالضبط تُفقدك الدرجات، بالأرقام.',
  },
  {
    icon: '🧭',
    title: 'خطة مبنية على أدائك',
    body: 'تُرتّب حسب الأقسام الأعلى وزنًا في الاختبار، لا حسب أكثرها أخطاءً فقط.',
  },
  {
    icon: '💾',
    title: 'استئناف أي وقت',
    body: 'تقدّمك يُحفظ تلقائيًا. أغلق المتصفح وأكمل لاحقًا من حيث توقّفت.',
  },
];

export default async function Home() {
  let pool: Record<string, number> = {};
  try {
    pool = await getPoolSummary();
  } catch {
    // The landing page must render even with no database behind it.
  }
  const totalQuestions = Object.values(pool).reduce((a, b) => a + b, 0);
  const admin = await isAdmin();

  return (
    <div className="min-h-screen">
      {/* Ambient wash. Without a non-flat backdrop, backdrop-filter on
          the cards renders as flat grey rather than glass. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            'radial-gradient(1200px 700px at 15% -15%, rgba(14,90,84,.20), transparent 60%),' +
            'radial-gradient(900px 500px at 85% 5%, rgba(217,142,50,.16), transparent 55%),' +
            'radial-gradient(900px 800px at 50% 115%, rgba(1,88,155,.14), transparent 60%)',
        }}
      />

      <header className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-6">
        <b className="text-xl tracking-tight text-[color:var(--app-brand)]">ستيب برو</b>
        <span className="flex-1" />
        <Link href="/practice" className={linkClass({ variant: 'ghost', size: 'sm' })}>
          التدريب
        </Link>
        <Link href="/progress" className={linkClass({ variant: 'ghost', size: 'sm' })}>
          تقدّمي
        </Link>
        {/* Advertised only to someone already signed in. A visitor has no
            use for the link, and publishing it invites probing. */}
        {admin && (
          <Link
            href="/admin"
            className={linkClass({ variant: 'ghost', size: 'sm', className: 'text-[color:var(--app-muted)]' })}
          >
            الإدارة
          </Link>
        )}
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-24">
        {/* ---------- hero ---------- */}
        <section className="animate-fade-up py-12 text-center sm:py-20">
          <span className="inline-block rounded-full bg-[color:var(--app-brand)]/10 px-4 py-1.5 text-xs font-bold text-[color:var(--app-brand)]">
            محاكي اختبار STEP
          </span>

          <h1 className="mx-auto mt-5 max-w-2xl text-3xl font-extrabold leading-[1.35] tracking-tight sm:text-5xl sm:leading-[1.25]">
            تدرّب على STEP
            <span className="text-[color:var(--app-brand)]"> كما ستؤدّيه فعلًا</span>
          </h1>

          <p className="mx-auto mt-5 max-w-xl text-base leading-[1.9] text-[color:var(--app-muted)]">
            اختبار كامل بتوزيع قياس الرسمي — 100 سؤال في 120 دقيقة، أربعة أقسام،
            ثلاثة أجزاء لكل قسم. ثم تحليل يشرح أين ضاعت درجاتك بالضبط.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/exam" className={linkClass({ variant: 'primary', size: 'lg' })}>
              ابدأ الاختبار
            </Link>
            <Link href="/practice" className={linkClass({ size: 'lg' })}>
              التدريب الذكي
            </Link>
          </div>

          {totalQuestions > 0 && (
            <p className="mt-5 text-xs text-[color:var(--app-muted)]">
              <b className="tabular-nums">{totalQuestions.toLocaleString('ar-SA')}</b> سؤال متاح
            </p>
          )}
        </section>

        {/* ---------- section weights ---------- */}
        <section className="stagger grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SECTION_LIST.map((s) => (
            <Card key={s.id} as="div" className="p-4 text-center">
              <div className="text-2xl font-extrabold tabular-nums text-[color:var(--app-brand)]">
                {s.weightPct}%
              </div>
              <div className="mt-0.5 text-sm font-semibold">{s.nameAr}</div>
              <div className="mt-1 text-[0.68rem] text-[color:var(--app-muted)]">
                {pool[s.id] ? `${pool[s.id]} سؤال` : 'قريبًا'}
              </div>
            </Card>
          ))}
        </section>

        {/* ---------- features ---------- */}
        <section className="mt-16">
          <h2 className="mb-6 text-center text-xl font-bold tracking-tight">
            لماذا هذه المنصة مختلفة
          </h2>
          <div className="stagger grid gap-4 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <Card key={f.title} as="div" className="p-5">
                <div className="mb-2 text-2xl" aria-hidden>{f.icon}</div>
                <h3 className="mb-1 font-bold">{f.title}</h3>
                <p className="text-sm leading-relaxed text-[color:var(--app-muted)]">{f.body}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* ---------- closing ---------- */}
        <Card className="mt-16 p-8 text-center sm:p-12">
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">جاهز للبدء؟</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[color:var(--app-muted)]">
            الاختبار الكامل يستغرق ساعتين. يمكنك أيضًا التدرّب على قسم واحد فقط
            مع شرح بعد كل سؤال.
          </p>
          <Link
            href="/exam"
            className={linkClass({ variant: 'primary', size: 'lg', className: 'mt-6' })}
          >
            ابدأ الآن
          </Link>
        </Card>
      </main>

      <footer className="border-t border-[color:var(--app-line)] py-8 text-center text-xs text-[color:var(--app-muted)]">
        ستيب برو — منصة التحضير لاختبار STEP
      </footer>
    </div>
  );
}
