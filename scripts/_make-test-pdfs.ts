/**
 * Build synthetic PDFs that reproduce the two failure shapes, so the
 * diagnostic and the coordinate extractor can be verified without the
 * real files. Deleted after use — these prove plumbing, not formats.
 *
 *   npx tsx scripts/_make-test-pdfs.ts
 */
import { writeFileSync } from 'node:fs';

type Item = { x: number; y: number; s: string };

function pdfFromItems(pages: Item[][]): string {
  const esc = (s: string) => s.split('\\').join('\\\\').split('(').join('\\(').split(')').join('\\)');
  const objs: string[] = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');

  const pageObjNums: number[] = [];
  const contentStreams: string[] = [];
  pages.forEach((items) => {
    const content = items
      .map((it) => `BT /F1 11 Tf ${it.x} ${it.y} Td (${esc(it.s)}) Tj ET`)
      .join('\n');
    contentStreams.push(content);
  });

  // object numbering: 1 catalog, 2 pages, then per page: [pageObj, contentObj], then font
  let n = 3;
  const kids: number[] = [];
  const pageContentPairs: Array<[number, number]> = [];
  pages.forEach(() => {
    const pageNum = n++;
    const contentNum = n++;
    kids.push(pageNum);
    pageContentPairs.push([pageNum, contentNum]);
    pageObjNums.push(pageNum);
  });
  const fontNum = n;

  objs.push(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${pages.length} >>`);

  pageContentPairs.forEach(([, contentNum], i) => {
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Contents ${contentNum} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> >>`,
    );
    const stream = contentStreams[i];
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { pdf += String(o).padStart(10, '0') + ' 00000 n \n'; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

// --- a TWO-COLUMN grammar page whose content-stream order is scrambled -
// Items are emitted in a deliberately wrong order (right column first,
// interleaved) to mimic how a real export lists text runs. A naive
// extractor concatenates in this order and produces garbage; a
// coordinate-aware one recovers left-column-then-right, top-to-bottom.
const leftCol = [
  '1 / 4', 'The capital of France is ...... .', 'Berlin', 'Madrid', 'Paris', 'Rome',
  '2 / 4', 'She ...... to school daily.', 'go', 'goes', 'going', 'gone',
];
const rightCol = [
  '3 / 4', 'They ...... here since 2010.', 'live', 'lives', 'have lived', 'living',
  '4 / 4', 'He is good ...... maths.', 'in', 'at', 'on', 'for',
];

const twoColItems: Item[] = [];
leftCol.forEach((s, i) => twoColItems.push({ x: 60, y: 740 - i * 24, s }));
rightCol.forEach((s, i) => twoColItems.push({ x: 330, y: 740 - i * 24, s }));
// Scramble emission order: interleave, right before left in places.
const scrambled = [...twoColItems].sort(() => 0); // keep stable but mix columns
const mixed: Item[] = [];
for (let i = 0; i < Math.max(leftCol.length, rightCol.length); i++) {
  if (rightCol[i] !== undefined) mixed.push(twoColItems[leftCol.length + i]);
  if (leftCol[i] !== undefined) mixed.push(twoColItems[i]);
}

writeFileSync('corpora/grammar-twocolumn-scramble-TEST.pdf', pdfFromItems([mixed]), 'latin1');
console.log('wrote corpora/grammar-twocolumn-scramble-TEST.pdf (2 columns, scrambled emission order)');

// A clean single-column page for the control.
const single: Item[] = leftCol.concat(rightCol).map((s, i) => ({ x: 60, y: 760 - i * 22, s }));
writeFileSync('corpora/grammar-singlecol-TEST.pdf', pdfFromItems([single]), 'latin1');
console.log('wrote corpora/grammar-singlecol-TEST.pdf (single column, clean)');
