/**
 * Can the available content actually fill a blueprint-accurate STEP exam?
 *
 * The blueprint is 100 questions: Reading 40 / Grammar 30 / Listening 20 /
 * Writing 10. Asking this BEFORE building the engine, because if a
 * section is short the engine silently produces a malformed exam.
 */
import { readFileSync } from 'node:fs';
import { runPipeline } from '../src/lib/ingestion/pipeline';
import { LISTENING_QUESTION_COUNT } from '../src/lib/ingestion/listening-seed';

interface LegacyQ { id: string; sec: string; skill?: string; audio?: string; tts?: string; pid?: string }

const legacy: LegacyQ[] = JSON.parse(readFileSync('legacy_bank.json', 'utf8'));
const count = (sec: string) => legacy.filter((q) => q.sec === sec).length;

const grammarBank = runPipeline(readFileSync('gramer_bank.txt', 'utf8'));
const readingBank = runPipeline(readFileSync('reading_bank.txt', 'utf8'));

const inventory = {
  grammar: count('gram') + grammarBank.stats.unique,
  reading: count('read') + readingBank.stats.unique,
  // Only clips with a real audio file are usable; the TTS-only items
  // depend on browser speech synthesis, which is not exam-faithful.
  listening: LISTENING_QUESTION_COUNT,
  writing: count('write'),
};

const BLUEPRINT = { reading: 40, grammar: 30, listening: 20, writing: 10 };

console.log('=== available content ===');
console.log(`grammar   : ${inventory.grammar}  (legacy ${count('gram')} + bank ${grammarBank.stats.unique})`);
console.log(`reading   : ${inventory.reading}  (legacy ${count('read')} + bank ${readingBank.stats.unique})`);
console.log(`listening : ${inventory.listening}  (verified clips only; ${legacy.filter(q=>q.tts).length} TTS-only excluded)`);
console.log(`writing   : ${inventory.writing}`);
console.log(`passages  : ${readingBank.passages.length}`);

console.log('\n=== one blueprint-accurate exam (100 Q) ===');
let blocked = false;
for (const [sec, need] of Object.entries(BLUEPRINT)) {
  const have = inventory[sec as keyof typeof inventory];
  const ok = have >= need;
  if (!ok) blocked = true;
  console.log(`${sec.padEnd(10)} need ${String(need).padStart(3)}  have ${String(have).padStart(4)}  ${ok ? 'OK' : 'SHORT'}`);
}

console.log('\n=== how many DISTINCT exams (no question reused) ===');
for (const [sec, need] of Object.entries(BLUEPRINT)) {
  const have = inventory[sec as keyof typeof inventory];
  console.log(`${sec.padEnd(10)} ${Math.floor(have / need)} exam(s)`);
}
const maxExams = Math.min(
  ...Object.entries(BLUEPRINT).map(([sec, need]) => Math.floor(inventory[sec as keyof typeof inventory] / need)),
);
console.log(`\nlimiting factor -> ${maxExams} distinct full exam(s) before reuse`);
console.log(blocked ? '\nBLOCKED: at least one section cannot fill a single exam.' : '\nA single full exam is buildable.');
