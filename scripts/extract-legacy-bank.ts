/**
 * The legacy step-prep.html embeds a question bank that already carries
 * answer keys AND Arabic explanations. That makes it two things at once:
 *   1. a seed source (listening items with audio refs), and
 *   2. a GOLD SET for measuring real LLM accuracy before trusting it.
 *
 * This extracts it to JSON. Usage: npx tsx scripts/extract-legacy-bank.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('step-prep.html', 'utf8');

export interface LegacyQuestion {
  id: string;
  sec: string;
  skill?: string;
  q: string;
  opts: string[];
  ans: number;
  exp?: string;
  audio?: string;
  tts?: string;
  pid?: string;
}

/**
 * The bank is written in two dialects in the same file: strict JSON
 * objects ("sec":"gram") and JS object literals (sec:"gram"). Rather than
 * regex each field, find each object's braces and evaluate it in an
 * isolated scope -- the file is local and trusted, and hand-rolling a JS
 * object parser here would be far more error-prone.
 */
function extractObjects(src: string): LegacyQuestion[] {
  const out: LegacyQuestion[] = [];
  const idRe = /["']?id["']?\s*:\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;

  while ((m = idRe.exec(src))) {
    // Walk backwards to the object's opening brace.
    let start = m.index;
    while (start > 0 && src[start] !== '{') start--;
    if (src[start] !== '{') continue;

    // Walk forward, tracking depth and string state, to the closing brace.
    let depth = 0;
    let i = start;
    let inStr: string | null = null;
    let esc = false;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) continue;

    const literal = src.slice(start, i + 1);
    if (!/["']?opts["']?\s*:/.test(literal) || !/["']?ans["']?\s*:/.test(literal)) continue;

    try {
      const obj = new Function(`"use strict"; return (${literal});`)() as LegacyQuestion;
      if (obj && typeof obj.id === 'string' && Array.isArray(obj.opts) && typeof obj.ans === 'number') {
        out.push(obj);
      }
    } catch {
      /* not a question object — skip */
    }
    idRe.lastIndex = i;
  }
  return out;
}

const all = extractObjects(html);
const bySec: Record<string, number> = {};
for (const q of all) bySec[q.sec] = (bySec[q.sec] ?? 0) + 1;

const listening = all.filter((q) => q.audio);
const withExp = all.filter((q) => q.exp && q.exp.trim());
const dupIds = all.length - new Set(all.map((q) => q.id)).size;

console.log(`extracted        : ${all.length}`);
console.log(`duplicate ids    : ${dupIds}`);
console.log(`by section       : ${JSON.stringify(bySec)}`);
console.log(`with explanation : ${withExp.length}`);
console.log(`with audio ref   : ${listening.length}`);
console.log(`distinct audio   : ${new Set(listening.map((q) => q.audio)).size}`);

const badAns = all.filter((q) => q.ans < 0 || q.ans >= q.opts.length);
const badOpts = all.filter((q) => q.opts.length < 2 || q.opts.length > 4);
console.log(`out-of-range ans : ${badAns.length}`);
console.log(`opts not 2-4     : ${badOpts.length}`);

writeFileSync('legacy_bank.json', JSON.stringify(all, null, 2), 'utf8');
console.log(`\nwrote legacy_bank.json`);

console.log(`\n--- listening items (audio -> answer) ---`);
for (const q of listening) {
  console.log(`${q.audio!.replace('listening/', '')}  ans=${'ABCD'[q.ans]}  ${q.q.slice(0, 62)}`);
}
