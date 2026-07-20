'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createBatchAction } from '@/app/actions/content';
import { Button, Card, Field, inputClass } from '@/components/ui';

export function NewBatchForm() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const create = () => {
    setError(null);
    start(async () => {
      const res = await createBatchAction(title, notes);
      if (!res.ok || !res.data) { setError(res.error ?? 'فشل الإنشاء'); return; }
      // Straight into the editor — creating an empty batch is never the
      // goal, adding questions to it is.
      router.push(`/admin/batch/${res.data.id}`);
    });
  };

  if (!open) {
    return (
      <Button block size="lg" onClick={() => setOpen(true)}>
        + تجميعة جديدة
      </Button>
    );
  }

  return (
    <Card className="space-y-3 p-5">
      <h2 className="font-bold">تجميعة جديدة</h2>

      <Field label="العنوان" required error={error ?? undefined}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) create(); }}
          placeholder="تجميعات يوليو — المصدر X"
          autoFocus
          className={inputClass()}
        />
      </Field>

      <Field label="ملاحظات المصدر">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="أكاديمية فلان — ملف PDF"
          className={inputClass()}
        />
      </Field>

      <div className="flex gap-2">
        <Button variant="primary" onClick={create} disabled={pending || !title.trim()}>
          {pending ? '…جارٍ الإنشاء' : 'إنشاء وفتح المحرر'}
        </Button>
        <Button onClick={() => { setOpen(false); setError(null); }}>إلغاء</Button>
      </div>
    </Card>
  );
}
