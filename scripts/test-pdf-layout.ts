/**
 * Coordinate-aware reading-order reconstruction.
 *
 * Tests the geometry, not a PDF: synthetic (x, y) items stand in for what
 * pdf.js returns, so the column and line logic is verified without a
 * rendering engine. The bug being guarded against is the real one — a
 * two-column page whose text runs are emitted in a scrambled order and
 * glued across the column gutter by a naive extractor.
 */
import { reconstructPage, type TextItem } from '../src/lib/ingestion/v2/source/layoutExtractor';

const results: Array<[string, boolean, string?]> = [];
const check = (n: string, p: boolean, note?: string) => results.push([n, p, note]);

const PAGE_W = 612;

/** Place a run of lines down a column at a fixed X. */
function column(x: number, topY: number, lines: string[]): TextItem[] {
  return lines.map((str, i) => ({ str, x, y: topY - i * 20, w: str.length * 5, h: 11 }));
}

// --- single column: order preserved ----------------------------------
{
  const items = column(60, 740, ['1 / 2', 'Question one?', 'a', 'b', '2 / 2', 'Question two?', 'c', 'd']);
  const shuffled = [...items].reverse(); // emission order must not matter
  const text = reconstructPage(shuffled, PAGE_W);
  const lines = text.split('\n');
  check('single column keeps top-to-bottom order',
    lines[0] === '1 / 2' && lines[1] === 'Question one?',
    JSON.stringify(lines.slice(0, 2)));
  check('single column recovers all lines', lines.length === 8, `${lines.length}`);
}

// --- two columns: NOT glued ------------------------------------------
{
  const left = column(60, 740, ['1 / 4', 'Left question?', 'la', 'lb']);
  const right = column(330, 740, ['3 / 4', 'Right question?', 'ra', 'rb']);

  // Emit interleaved and out of order, the way a real export does.
  const scrambled: TextItem[] = [];
  for (let i = 0; i < 4; i++) { scrambled.push(right[i]); scrambled.push(left[i]); }

  const text = reconstructPage(scrambled, PAGE_W);
  const lines = text.split('\n');

  check('two columns are not glued on any line',
    lines.every((l) => !/\d \/ \d.*\d \/ \d/.test(l) && !/Left.*Right|Right.*Left/.test(l)),
    JSON.stringify(lines));
  check('left column is read before right',
    text.indexOf('Left question?') < text.indexOf('Right question?'));
  check('left column read top-to-bottom',
    text.indexOf('1 / 4') < text.indexOf('Left question?')
    && text.indexOf('Left question?') < text.indexOf('la'));
  check('right column intact',
    text.indexOf('3 / 4') < text.indexOf('Right question?')
    && text.indexOf('Right question?') < text.indexOf('ra'));
  check('every line belongs to exactly one column',
    lines.filter(Boolean).every((l) =>
      ['1 / 4', 'Left question?', 'la', 'lb', '3 / 4', 'Right question?', 'ra', 'rb'].includes(l.trim())),
    JSON.stringify(lines));
}

// --- items on the same line, wrong X order ---------------------------
{
  const items: TextItem[] = [
    { str: 'world', x: 120, y: 700, w: 40, h: 11 },
    { str: 'Hello', x: 60, y: 700, w: 40, h: 11 },
    { str: 'again', x: 200, y: 700, w: 40, h: 11 },
  ];
  const text = reconstructPage(items, PAGE_W);
  check('same-line items ordered by X', text.trim() === 'Hello world again', JSON.stringify(text));
}

// --- baseline jitter does not split a line ---------------------------
{
  const items: TextItem[] = [
    { str: 'normal', x: 60, y: 700, w: 40, h: 11 },
    { str: 'super', x: 110, y: 702, w: 30, h: 8 }, // 2pt higher — same line
  ];
  const text = reconstructPage(items, PAGE_W);
  check('sub/superscript stays on its line', text.split('\n').length === 1, JSON.stringify(text));
}

// --- empty / whitespace items ignored --------------------------------
{
  const items: TextItem[] = [
    { str: '  ', x: 60, y: 700, w: 5, h: 11 },
    { str: 'real', x: 70, y: 700, w: 20, h: 11 },
  ];
  check('whitespace-only items dropped', reconstructPage(items, PAGE_W).trim() === 'real');
}

// --- report ----------------------------------------------------------
let failed = 0;
for (const [name, pass, note] of results) {
  if (!pass) failed++;
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${note ? `  (${note})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exit(1);
