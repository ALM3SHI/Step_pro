import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BatchEditor } from '@/components/admin/BatchEditor';
import { listAudioClips, listBatches, listPassages, listQuestions } from '@/lib/content/repository';
import { isSupabaseConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!isSupabaseConfigured()) {
    return <p className="glass rounded-2xl p-6">لم تُضبط متغيّرات Supabase.</p>;
  }

  // Loaded in parallel — these are four independent reads and the editor
  // needs all of them before it can render anything useful.
  const [batches, questions, passages, audioClips] = await Promise.all([
    listBatches(),
    listQuestions(id),
    listPassages(),
    listAudioClips(),
  ]);

  const batch = batches.find((b) => b.id === id);
  if (!batch) notFound();

  return (
    <div className="space-y-4">
      <header className="glass rounded-2xl p-5">
        <Link href="/admin" className="text-xs text-[color:var(--app-muted)] hover:underline">
          ← كل التجميعات
        </Link>
        <h1 className="mt-1 text-xl font-bold">{batch.title}</h1>
        <p className="text-sm text-[color:var(--app-muted)]">
          {batch.counts.total} سؤالًا · منشور {batch.counts.published} · مسودة {batch.counts.draft}
          {batch.counts.review > 0 && ` · للمراجعة ${batch.counts.review}`}
        </p>
        {batch.notes && <p className="mt-1 text-xs text-[color:var(--app-muted)]">{batch.notes}</p>}
      </header>

      <BatchEditor
        batch={batch}
        initialQuestions={questions}
        passages={passages}
        audioClips={audioClips}
        otherBatches={batches.filter((b) => b.id !== id)}
      />
    </div>
  );
}
