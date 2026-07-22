import { listSamplesAction } from '@/app/actions/parser-debug';
import { ParserDebug } from './ParserDebug';

export const dynamic = 'force-dynamic';

/**
 * Parser review.
 *
 * The new ingestion engine is not the official one until its output has
 * been read by a human — counters can say "0 orphans" while every
 * question hangs off the wrong passage.
 */
export default async function ParserDebugPage() {
  const samples = await listSamplesAction();
  return <ParserDebug samples={samples} />;
}
