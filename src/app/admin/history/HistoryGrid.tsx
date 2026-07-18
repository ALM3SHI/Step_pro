'use client';

import { useState } from 'react';
import { BatchCard, type BatchSummary } from '@/components/admin/BatchCard';

/**
 * Removes the card optimistically on delete. The server action already
 * revalidates this path, but dropping it locally keeps the grid from
 * showing a stale card while the refetch is in flight.
 */
export function HistoryGrid({ initial }: { initial: BatchSummary[] }) {
  const [batches, setBatches] = useState(initial);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {batches.map((b) => (
        <BatchCard
          key={b.id}
          batch={b}
          onDeleted={(id) => setBatches((prev) => prev.filter((x) => x.id !== id))}
        />
      ))}
    </div>
  );
}
