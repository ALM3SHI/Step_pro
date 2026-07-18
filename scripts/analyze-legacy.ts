/**
 * Inventory of what the legacy prototype actually contains, so the
 * rebuild is driven by the real data rather than assumptions about it.
 */
import { readFileSync } from 'node:fs';

interface LegacyQ {
  id: string; sec: string; skill?: string; q: string; opts: string[];
  ans: number; exp?: string; audio?: string; tts?: string; pid?: string;
}

const all: LegacyQ[] = JSON.parse(readFileSync('legacy_bank.json', 'utf8'));

const bySection: Record<string, number> = {};
const bySkill: Record<string, { n: number; sec: string }> = {};
let noSkill = 0;
let withPassage = 0;
let withTts = 0;
let withHtml = 0;
let withNewlines = 0;

for (const q of all) {
  bySection[q.sec] = (bySection[q.sec] ?? 0) + 1;
  if (q.skill) {
    bySkill[q.skill] ??= { n: 0, sec: q.sec };
    bySkill[q.skill].n++;
  } else noSkill++;
  if (q.pid) withPassage++;
  if (q.tts) withTts++;
  if (/<br\s*\/?>|<b>|<i>|<u>/i.test(q.q)) withHtml++;
  if (/\n/.test(q.q)) withNewlines++;
}

console.log(`total questions   : ${all.length}`);
console.log(`by section        : ${JSON.stringify(bySection)}`);
console.log(`distinct skills   : ${Object.keys(bySkill).length}`);
console.log(`questions w/o skill: ${noSkill}`);
console.log(`with passage ref  : ${withPassage}`);
console.log(`with TTS text     : ${withTts}`);
console.log(`containing HTML   : ${withHtml}`);
console.log(`containing \\n     : ${withNewlines}`);

console.log(`\n--- skills by section ---`);
const grouped: Record<string, Array<[string, number]>> = {};
for (const [skill, v] of Object.entries(bySkill)) {
  (grouped[v.sec] ??= []).push([skill, v.n]);
}
for (const [sec, skills] of Object.entries(grouped)) {
  console.log(`\n${sec}:`);
  for (const [s, n] of skills.sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s.padEnd(14)} ${n}`);
  }
}

// Option-count distribution — affects the exam UI and the schema check.
const optCounts: Record<number, number> = {};
for (const q of all) optCounts[q.opts.length] = (optCounts[q.opts.length] ?? 0) + 1;
console.log(`\noption counts     : ${JSON.stringify(optCounts)}`);

// Explanation quality — these become the study feedback.
const expLens = all.map((q) => (q.exp ?? '').length).sort((a, b) => a - b);
console.log(`explanation length: min ${expLens[0]} / median ${expLens[Math.floor(expLens.length / 2)]} / max ${expLens.at(-1)}`);

// How many are genuinely distinct after normalising whitespace+case?
const seen = new Set(all.map((q) => `${q.q.replace(/\s+/g, ' ').trim().toLowerCase()}::${q.opts.join('|').toLowerCase()}`));
console.log(`unique after norm : ${seen.size} (${all.length - seen.size} near-duplicates)`);
