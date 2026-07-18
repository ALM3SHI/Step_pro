import { readFileSync } from 'node:fs';
import type { ContentBundle } from '../src/lib/content/schema';

const bundle: ContentBundle = JSON.parse(readFileSync('content/bundle.json', 'utf8'));
const byId = new Map(bundle.questions.map((q) => [q.id, q]));

console.log('=== duplicate-option errors ===');
for (const id of ['legacy-cq578', 'legacy-dq109']) {
  const q = byId.get(id);
  if (!q) { console.log(`${id}: not found`); continue; }
  console.log(`\n${id}  [${q.section}/${q.skillId}]`);
  console.log(`  Q: ${q.text}`);
  for (const [k, v] of Object.entries(q.options)) {
    console.log(`  ${k}) ${JSON.stringify(v)}${k === q.correctOption ? '  <-- key' : ''}`);
  }
}

console.log('\n\n=== duplicate contentHash groups ===');
const byHash = new Map<string, string[]>();
for (const q of bundle.questions) {
  byHash.set(q.contentHash, [...(byHash.get(q.contentHash) ?? []), q.id]);
}
let shown = 0;
for (const [, ids] of byHash) {
  if (ids.length < 2 || shown >= 4) continue;
  shown++;
  const first = byId.get(ids[0])!;
  console.log(`\n${ids.join('  ==  ')}`);
  console.log(`  Q: ${first.text.slice(0, 90)}`);
  console.log(`  keys: ${ids.map((i) => byId.get(i)!.correctOption).join(' / ')}`);
  console.log(`  exps: ${ids.map((i) => (byId.get(i)!.explanationAr ? 'yes' : 'no')).join(' / ')}`);
}

console.log('\n\n=== listening inventory ===');
const listening = bundle.questions.filter((q) => q.section === 'listening');
console.log(`total: ${listening.length}`);
const byClip = new Map<string, string[]>();
for (const q of listening) {
  byClip.set(q.audioClipId!, [...(byClip.get(q.audioClipId!) ?? []), q.id]);
}
for (const [clip, ids] of byClip) {
  console.log(`  ${clip.padEnd(20)} ${ids.length} question(s)  ${ids.length > 3 ? '<-- MORE THAN EXPECTED' : ''}`);
}
