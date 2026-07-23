# PDF Library Comparison

Requested criteria, in priority order: **reading order, columns, charts,
tables, element coordinates, image extraction** — not speed.

First, a fact that collapses one row of the table:

> **`unpdf` IS pdf.js.** unpdf bundles pdf.js (`node_modules/unpdf/dist/
> pdfjs.mjs`) and wraps it. "unpdf vs pdf.js" is not a real choice — it
> is the same engine with a friendlier API. The genuine choice is *which
> pdf.js call*: `extractText()` (flat, merges lines) vs
> `getTextContent()` (items with coordinates). We use both.

## The table

| Capability | unpdf / pdf.js | pdf-parse | pdfium | PyMuPDF (Python) |
|---|---|---|---|---|
| Reading order | via item coords (manual) | poor (stream order) | good (built-in) | **excellent** |
| Columns | manual (we built it) | none | partial | **native `blocks`/`dict`** |
| Element coordinates | **yes** (`transform`) | no | yes | **yes** (bbox per span) |
| Tables | no | no | no | **yes** (`find_tables`) |
| Charts (as images) | detect + render | no | yes | **yes** |
| Image extraction | yes (`extractImages`) | no | yes | **yes** |
| RTL / Arabic joining | **no** (visual order) | no | partial | **best available** |
| Runs in Node/Vercel | **yes**, pure JS | yes, pure JS | native binary | no — needs Python service |
| Native build step | none | none | **yes** (.node/.wasm) | Python + wheels |

## Per-library notes

**unpdf / pdf.js** — already installed, pure JavaScript, runs in a Vercel
serverless function with no build step. Exposes exactly what a
coordinate-aware extractor needs: `getTextContent()` gives every text
item's `(x, y)`, width and font. Its weaknesses are the two we hit: no
column logic (we added it) and no RTL joining (open). Cannot read tables
as structure. **This stays the default** — it is the only option with
zero deployment friction, and coordinates let us fix most layout issues
ourselves.

**pdf-parse** — a thin wrapper over pdf.js that returns a single merged
string with **no coordinates**. Strictly worse than calling pdf.js
directly for our purpose: it throws away the positional data that makes
reading-order reconstruction possible. No reason to add it.

**pdfium** (Google's Chrome PDF engine, via `pdfium.node` or WASM) —
excellent rendering and solid text order, used because it is battle-
tested in Chrome. Costs a **native binary**, which complicates Vercel
deployment (needs the right prebuilt for the runtime). Worth it only if
pdf.js text order proves inadequate on files we cannot fix with
coordinates — not the case in the two files tested.

**PyMuPDF** (MuPDF, Python) — the strongest option on every content
criterion: native reading order, column detection via `page.get_text
("blocks")`, real **table extraction** (`find_tables()`), per-span
bounding boxes, and the best RTL handling available. The cost is
architectural: it is Python, so it cannot run in the Next.js runtime and
needs a **separate microservice** (FastAPI + PyMuPDF, called over HTTP).
That is real operational weight, justified only when a corpus genuinely
needs tables or clean Arabic — at which point it becomes the right tool.

## Recommendation

1. **Now:** pdf.js coordinates (via unpdf) with the layout extractor.
   Zero deployment cost, coordinates in hand, columns solved.
2. **When a file needs it:** add an RTL-joining step over pdf.js items
   (reorder right-to-left runs by X descending) — still pure JS, still
   in-process. This addresses the Arabic-order problem without a service.
3. **Only if tables/scanned pages appear:** stand up a PyMuPDF
   microservice behind the same `PdfExtractor` interface. Because the
   seam already exists, this is an additive change — one new file
   implementing `extract(bytes)` by calling the service — and touches no
   parser.

The interface makes this a progression, not a rewrite: each step is a
new `PdfExtractor`, chosen per file, with the parsers unaware of which
ran.
