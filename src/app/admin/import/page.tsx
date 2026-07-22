'use client';

import { useState } from 'react';
import Link from 'next/link';
import { HybridIngest, type IngestMode } from './HybridIngest';

/**
 * Mode switch.
 *
 * Hybrid is the default and the only mode wired up today. API mode is
 * shown but clearly marked, rather than hidden — an invisible future
 * mode is one nobody remembers exists.
 */
export default function HybridPage() {
  const [mode, setMode] = useState<IngestMode>('hybrid');

  return (
    <div className="space-y-5">
      <section className="glass rounded-2xl p-6">
        <div className="mb-4 flex flex-wrap items-start gap-3">
          <div className="flex-1">
            <h1 className="text-xl font-bold">الإدخال الهجين</h1>
            <p className="text-sm text-[color:var(--app-muted)]">
              حلّل الأسئلة محليًا، واستعن بأي ذكاء اصطناعي خارجي للإجابات.
            </p>
          </div>
          <Link
            href="/admin/listening"
            className="rounded-xl border border-[color:var(--app-line)] px-4 py-2 text-sm font-semibold"
          >
            إدخال الاستماع ←
          </Link>
        </div>

        <div
          role="radiogroup"
          aria-label="وضع الإدخال"
          className="inline-flex rounded-xl border border-[color:var(--app-line)] p-1"
        >
          {([
            ['hybrid', 'هجين / مفاتيح سريعة', 'نشط'],
            ['api', 'آلي بالكامل (API)', 'لاحقًا'],
          ] as Array<[IngestMode, string, string]>).map(([key, label, badge]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={mode === key}
              onClick={() => setMode(key)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                mode === key ? 'bg-[color:var(--app-brand)] text-white' : ''
              }`}
            >
              {label}
              <span className={`mr-2 text-[0.65rem] ${mode === key ? 'opacity-80' : 'opacity-60'}`}>
                {badge}
              </span>
            </button>
          ))}
        </div>
      </section>

      <HybridIngest mode={mode} />
    </div>
  );
}
