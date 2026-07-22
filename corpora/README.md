# Validation corpora

Drop real PDFs here and run:

    npx tsx scripts/validate-corpora.ts --verbose

Every `.pdf` in this folder is picked up automatically — no code change
needed to add a file from another academy.

**Name the file after its section** so the right parser is used:

    reading-academy-a.pdf
    grammar-academy-b.pdf
    listening-2024.pdf
    writing-sample.pdf

A file with no section in its name defaults to reading, and the report
says the section was guessed.

## What the report answers, per file

- questions actually present (from the file's own `N / M` markers, when
  it prints them) vs questions extracted, as a recall percentage
- passages, and how many questions attached to one
- questions left unlinked, with the reason for each
- failed blocks, with their original text
- images / charts / tables detected and skipped
- pages that look scanned and would need OCR

## Not committed

PDFs are gitignored — they are large and may be licensed material.
