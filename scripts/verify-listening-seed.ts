/**
 * Cross-checks the hand-entered listening seed against two independent
 * sources: the answer keys embedded in legacy step-prep.html, and the
 * MP3 files actually on disk.
 *
 * Answer keys are the one thing in this pipeline that cannot be
 * recomputed if they are wrong, so they get verified against a second
 * source rather than trusted from a single transcription.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LISTENING_SEED, LISTENING_QUESTION_COUNT, listeningSeedRows } from '../src/lib/ingestion/listening-seed';

interface LegacyQ { id: string; sec: string; q: string; opts: string[]; ans: number; exp?: string; audio?: string }

const legacy: LegacyQ[] = JSON.parse(readFileSync('legacy_bank.json', 'utf8'));
const legacyListening = legacy.filter((q) => q.audio);

console.log(`seed clips        : ${LISTENING_SEED.length}`);
console.log(`seed questions    : ${LISTENING_QUESTION_COUNT}`);
console.log(`legacy questions  : ${legacyListening.length}`);

// --- 1. audio files present on disk ------------------------------------
let missingFiles = 0;
for (const c of LISTENING_SEED) {
  const p = join('listening', c.fileName);
  if (!existsSync(p)) { console.log(`  MISSING AUDIO: ${p}`); missingFiles++; }
  else if (statSync(p).size < 10_000) console.log(`  SUSPICIOUSLY SMALL: ${p}`);
}
console.log(`missing audio     : ${missingFiles}`);

// --- 2. answer keys agree with the legacy bank -------------------------
const byAudio = new Map<string, LegacyQ[]>();
for (const q of legacyListening) {
  const key = q.audio!.replace('listening/', '').replace('.mp3', '');
  byAudio.set(key, [...(byAudio.get(key) ?? []), q]);
}

let mismatches = 0;
let compared = 0;

for (const c of LISTENING_SEED) {
  const legacyQs = byAudio.get(c.audioKey) ?? [];
  if (legacyQs.length !== c.questions.length) {
    console.log(`  COUNT DIFF ${c.audioKey}: seed ${c.questions.length} vs legacy ${legacyQs.length}`);
    mismatches++;
    continue;
  }
  c.questions.forEach((sq, i) => {
    const lq = legacyQs[i];
    const legacyKey = 'ABCD'[lq.ans];
    compared++;
    if (legacyKey !== sq.correctOption) {
      console.log(`  KEY MISMATCH ${c.audioKey} Q${sq.ordinal}: seed=${sq.correctOption} legacy=${legacyKey}`);
      console.log(`     seed  : ${sq.questionText}`);
      console.log(`     legacy: ${lq.q}`);
      mismatches++;
    }
  });
}

console.log(`keys compared     : ${compared}`);
console.log(`key mismatches    : ${mismatches}`);

// --- 3. structural sanity ---------------------------------------------
const rows = listeningSeedRows();
const dupHashes = rows.length - new Set(rows.map((r) => r.contentHash)).size;
const badOpts = rows.filter((r) => Object.values(r.options).some((v) => !v || !v.trim()));
const keyNotPresent = rows.filter((r) => !r.options[r.correctOption]);

console.log(`duplicate hashes  : ${dupHashes}`);
console.log(`empty options     : ${badOpts.length}`);
console.log(`key not in options: ${keyNotPresent.length}`);

const ok = missingFiles === 0 && mismatches === 0 && dupHashes === 0 && badOpts.length === 0 && keyNotPresent.length === 0;
console.log(`\n${ok ? 'PASS — seed verified against legacy keys and audio files' : 'FAIL — see above'}`);
process.exit(ok ? 0 : 1);
