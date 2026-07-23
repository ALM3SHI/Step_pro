# PDF Extraction — Diagnosis Report

Run the evidence yourself:

```bash
npx tsx scripts/diagnose-pdf.ts corpora/reading-academy-a.pdf --pages 2
npx tsx scripts/diagnose-pdf.ts corpora/grammar-academy-b.pdf --pages 3
npm run validate:corpora
```

---

## Headline finding

**The extraction layer is not the main failure. The text comes out.**

| File | Pages | Chars extracted | Arabic share | Engine result |
|------|-------|-----------------|--------------|---------------|
| reading-academy-a.pdf | 723 | 564,349 | 1% | 0 extracted, 1 failed |
| grammar-academy-b.pdf | 61 | 100,869 | 25% | 8 extracted, 413 failed |

Half a million characters of readable English came out of the reading
file. `unpdf` (which is pdf.js underneath) extracted it. The "0 questions"
is **not** an extraction failure — it is a structure the parser cannot
segment, plus Arabic chrome it was never taught to strip.

So the original hypothesis — "the problem is the PDF extraction layer,
not the parser" — is only one-quarter right. There IS an extraction
problem (right-to-left Arabic order), but it affects the chrome, not the
questions. The dominant problem is **format diversity the parsers do not
yet handle.**

---

## Reading PDF — why 0 questions

The file is a **723-page compilation**, structured completely unlike
`reading_bank.txt`:

```
Page 1    : Arabic academy cover  (أكاديمية الإفادة … channels, groups)
Page 5    : "5 Model 500   1 C 2 D 3 A 4 D 5 C 6 A"   <- ANSWER KEYS, own page
Page 15   : "15 Model 500 Passage 6 (الماتريوشكا) 1) A matryoshka doll…"
Page 20   : "20 Model 500 Passage 7 (تلوث الهواء) 1) Air pollution is…"
Page 700  : "700 Model 2800 Questions 1- What does paragraph (1) say…"
```

Four concrete blockers, none of them extraction:

1. **Whole document fed as one blob.** 723 pages become one text; the
   reading parser opens its first region on the Arabic cover and rejects
   it. It never recovers a rhythm because…

2. **The unit is the PAGE, not a passage.** Each page carries a
   `N Model XXXX` header (page number + which mock the item belongs to).
   That header is noise the parser reads as content.

3. **Answer keys live on separate pages, per model.** `1 C 2 D 3 A`
   sits pages away from its questions, and every "Model" restarts
   numbering at 1 — so binding a key to a question by its number is
   ambiguous across 30+ models.

4. **Arabic passage titles inline** — `Passage 7 (تلوث الهواء)` — mixed
   into otherwise-English content.

**The 250 "images"** the earlier run reported are a per-page academy
logo/watermark: 304 image ops across the first 60 pages ≈ 5 per page.
Decoration, not question content. They are correctly counted and
correctly irrelevant.

### RTL extraction IS broken — but only on the chrome

Page 1 raw text:

```
أكاديـمية اإلفـادة              <- letter-forms mangled ("الإفادة" broken)
تجميعات اإلفادةالجزء الثانيللقراءةاختبار كفايات   <- words glued, no spaces
```

pdf.js emits Arabic glyphs in visual order and does not re-join them
right-to-left, so Arabic comes out scrambled and space-stripped. This is
real, and it is a genuine `unpdf`/pdf.js limitation. But every Arabic run
here is navigation, credits, or a passage title — **not** an English
question — so it matters for *cleanup*, not for *recall*.

---

## Grammar PDF — why 8 of 150, 413 failed

61 pages, text extracts cleanly (25% Arabic, all of it explanation).
The format is nothing like `gramer_bank.txt`:

```
1. Don't take this book.
It's ………………
(mine – her – his – he)                       <- OPTIONS: parenthesised,
# mine is a possessive pronoun. #mine ضمائر الملكية   dash-separated, ONE line
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~                <- item separator
```

The blockers:

1. **Options are inline.** `(mine – her – his – he)` is four options on
   one line, wrapped in parentheses and split by an en-dash. Every parser
   so far expects one option per line, or `A) B) C) D)`. This single
   difference is most of the 413 failures.

2. **The correct answer is buried in a `#` note**, sometimes with Arabic:
   `# mine is a possessive pronoun`. There is no clean `1 C` key list.

3. **`~~~~~` separators and `#` commentary lines** are structural noise
   the parser has no rule for.

4. **Page 1 is a long Arabic preamble** (بسم الله, credits to
   contributors) with no questions at all — one big failed block.

---

## What this means for the plan

The extraction seam is sound and now has two strategies (below). The
work these real files actually need is split across three layers:

| Layer | Needed for these files | Status |
|-------|------------------------|--------|
| Extraction (text out of PDF) | works for English content | **done** |
| Extraction (RTL Arabic order) | fix or strip Arabic runs | open |
| Normalisation (strip chrome) | drop `N Model XXXX`, `~~~`, logos, cover pages | open |
| Parsing (format rules) | inline `(a – b – c – d)` options; Model-grouped reading; cross-page keys | open |

None of this is AI. It is deterministic parsing and cleanup, which is
exactly where effort should go before any agent is built on top.

---

## Architecture delivered (the swappable part)

The strategy pattern the request asked for already exists and is now
populated:

```
SourceAdapter                      one shape for paste / txt / pdf
  └─ pdfAdapter(extractor)         takes ANY PdfExtractor
       ├─ unpdfExtractor           flat text (fast, glues columns)
       └─ layoutExtractor          coordinate-aware (recovers columns)
```

`PdfExtractor` is a four-line interface. Adding pdfium, pdf-parse, or a
Python PyMuPDF microservice means writing one sibling file and changing
one call site — no parser is touched. `validate-corpora` already runs
both extractors on every PDF and keeps whichever yields more items.

The **layout extractor** rebuilds reading order from pdf.js item
coordinates: it detects columns from the line-start-X distribution,
assigns items to columns, groups items into lines by Y, and reads column
1 fully before column 2. On a synthetic two-column page whose runs are
emitted scrambled, flat extraction gets 2/4 with the columns glued; the
layout extractor gets 4/4 cleanly (`scripts/test-pdf-layout.ts`, 10
tests). These specific STEP files are single-column with RTL runs, so
the column logic does not change their numbers — but it is the right
tool the moment a multi-column academy file appears, and it is proven.

See `docs/pdf-library-comparison.md` for unpdf / pdf.js / pdf-parse /
pdfium / PyMuPDF.
