/**
 * PDF extraction diagnosis.
 *
 * Answers the question the ingestion report cannot: is a failure in
 * EXTRACTION or in PARSING? It shows the raw text a PDF yields BEFORE any
 * parser sees it, plus the low-level facts that explain a bad extraction
 * — how many text items a page has, whether they carry coordinates, how
 * many images sit on the page, and whether a font declares a ToUnicode
 * map (without which pdf.js cannot turn glyphs into characters).
 *
 *   npx tsx scripts/diagnose-pdf.ts                 # every PDF in corpora/
 *   npx tsx scripts/diagnose-pdf.ts path/to/file.pdf
 *   npx tsx scripts/diagnose-pdf.ts file.pdf --pages 3 --chars 3000
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name: string, def: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
};
const PAGES = flag('pages', 2);
const CHARS = flag('chars', 2000);

const files = args.filter((a) => a.toLowerCase().endsWith('.pdf'));
const targets = files.length
  ? files
  : existsSync('corpora')
    ? readdirSync('corpora').filter((f) => f.toLowerCase().endsWith('.pdf')).map((f) => path.join('corpora', f))
    : [];

if (!targets.length) {
  console.log('No PDF given and none in corpora/. Usage:');
  console.log('  npx tsx scripts/diagnose-pdf.ts path/to/file.pdf');
  process.exit(0);
}

const {
  getDocumentProxy, extractText, getResolvedPDFJS,
} = await import('unpdf');

for (const file of targets) {
  if (!existsSync(file)) { console.log(`SKIP ${file} — not found`); continue; }

  const bytes = new Uint8Array(readFileSync(file));
  console.log('\n' + '#'.repeat(78));
  console.log(`# ${file}   (${(bytes.length / 1024).toFixed(0)} KB)`);
  console.log('#'.repeat(78));

  let pdf;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch (e) {
    console.log(`FATAL: could not open — ${e instanceof Error ? e.message : e}`);
    continue;
  }

  const total = pdf.numPages;
  console.log(`pages: ${total}`);

  // --- overall extractText, the path the adapter used ------------------
  const { text } = await extractText(pdf, { mergePages: false });
  const pageTexts = Array.isArray(text) ? text : [String(text)];
  const totalChars = pageTexts.reduce((n, t) => n + String(t ?? '').trim().length, 0);
  console.log(`extractText total chars across all pages: ${totalChars}`);
  console.log(`  => ${totalChars < 100 ? 'NO EXTRACTABLE TEXT — image-only or undecodable fonts' : 'text is present'}`);

  // --- per-page forensic pass on the first N pages ---------------------
  const pdfjs = await getResolvedPDFJS();

  for (let p = 1; p <= Math.min(PAGES, total); p++) {
    console.log('\n' + '-'.repeat(78));
    console.log(`PAGE ${p}`);
    console.log('-'.repeat(78));

    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    console.log(`size: ${Math.round(viewport.width)} x ${Math.round(viewport.height)}`);

    // text items, with coordinates
    const content = await page.getTextContent();
    const items = content.items as Array<{ str: string; transform: number[]; width: number }>;
    const withText = items.filter((i) => i.str && i.str.trim());
    console.log(`text items: ${items.length}  (non-empty: ${withText.length})`);

    if (withText.length) {
      const xs = withText.map((i) => i.transform[4]);
      const ys = withText.map((i) => i.transform[5]);
      console.log(`  x range: ${Math.round(Math.min(...xs))}..${Math.round(Math.max(...xs))}`
        + `   y range: ${Math.round(Math.min(...ys))}..${Math.round(Math.max(...ys))}`);
      // Distinct Y bands ~ number of visual lines; if far fewer than
      // items, items are fragmented across a line.
      const bands = new Set(ys.map((y) => Math.round(y / 2))).size;
      console.log(`  distinct Y bands (~lines): ${bands}`);

      // A cheap column probe: bimodal X-start distribution ⇒ two columns.
      const startXs = withText
        .filter((i) => i.str.trim().length > 1)
        .map((i) => Math.round(i.transform[4] / 20) * 20);
      const xhist = new Map<number, number>();
      for (const x of startXs) xhist.set(x, (xhist.get(x) ?? 0) + 1);
      const topX = [...xhist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      console.log(`  common line-start X: ${topX.map(([x, n]) => `${x}(${n})`).join('  ')}`);
    }

    // images / drawing objects
    let images = 0;
    try {
      const ops = await page.getOperatorList();
      const { OPS } = pdfjs;
      for (const fn of ops.fnArray) {
        if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) images++;
      }
    } catch { /* operator list can fail on damaged pages */ }
    console.log(`image paint ops: ${images}`);

    // fonts + ToUnicode: the usual reason "copyable" text extracts as junk
    try {
      await page.getOperatorList();
      const fonts = (page as unknown as { commonObjs: { _objs: Record<string, { data?: { name?: string; toUnicode?: unknown } }> } }).commonObjs._objs;
      const fontInfos = Object.values(fonts ?? {})
        .map((o) => o?.data)
        .filter((d): d is { name?: string; toUnicode?: unknown } => Boolean(d && 'name' in d));
      if (fontInfos.length) {
        const noUnicode = fontInfos.filter((f) => !f.toUnicode).length;
        console.log(`fonts: ${fontInfos.length}  without ToUnicode map: ${noUnicode}`
          + (noUnicode ? '  <= these render as unrecoverable glyphs' : ''));
      }
    } catch { /* best-effort */ }

    // --- the raw text itself ------------------------------------------
    const raw = String(pageTexts[p - 1] ?? '');
    console.log(`\nRAW TEXT (extractText, first ${CHARS} chars):`);
    console.log('┌' + '─'.repeat(76));
    console.log(raw.slice(0, CHARS).split('\n').map((l) => '│ ' + l).join('\n') || '│ (empty)');
    console.log('└' + '─'.repeat(76));

    // And the coordinate-ordered reconstruction, to show whether reading
    // order can be recovered from the item positions.
    if (withText.length) {
      const reordered = withText
        .map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5] }))
        .sort((a, b) => (Math.abs(a.y - b.y) > 3 ? b.y - a.y : a.x - b.x))
        .map((i) => i.s)
        .join(' ')
        .replace(/\s+/g, ' ');
      console.log(`COORDINATE-ORDERED (first ${Math.min(CHARS, 600)} chars):`);
      console.log('┌' + '─'.repeat(76));
      console.log(reordered.slice(0, Math.min(CHARS, 600)).split('\n').map((l) => '│ ' + l).join('\n'));
      console.log('└' + '─'.repeat(76));
    }
  }
}

console.log('\nDone. Read the RAW TEXT blocks above:');
console.log('  - empty / garbage  => extraction failure (fonts or scan), not the parser');
console.log('  - readable but out of order => layout/reading-order failure');
console.log('  - clean and ordered => the parser is at fault, not extraction');
