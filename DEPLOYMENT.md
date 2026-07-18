# Deployment — Vercel + Supabase

Target repo: `https://github.com/ALM3SHI/Step_pro`

---

## 1. Supabase setup

Create a project, then run the migrations **in order** (SQL Editor, or
`supabase db push` if you use the CLI):

| File | Creates |
|---|---|
| `0001_ingestion_schema.sql` | `ingestion_batches`, `passages`, `questions`, cascade delete RPC, history view |
| `0002_audio_writing_and_ai_audit.sql` | `writing` category, `audio_clips`, `gold_questions`, answer provenance |
| `0003_exam_engine.sql` | `image_url`/`image_alt`, `section_config` (40/30/20/10), `exam_attempts`, one-way lock trigger |
| `0004_attempt_sync.sql` | `sync_exam_attempt`, `submit_exam_attempt`, revision column |
| `0005_storage.sql` | `listening-audio` bucket + policies + orphan cleanup |

`0003` asserts the section weights total 100 and **will fail the
migration** if they don't. That's intentional — a weighted score built on
weights that don't sum to 100 is meaningless.

---

## 2. Environment variables

Set all three in **both** `.env.local` and Vercel (Production, Preview,
and Development scopes).

| Variable | Where to find it | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Settings → API → Project URL | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → API → `anon` `public` | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → `service_role` | **Yes** |

`SUPABASE_SERVICE_ROLE_KEY` bypasses every RLS policy. In Vercel, mark it
**Sensitive** so it can't be read back from the dashboard. It is used
only in `src/lib/supabase/server.ts`, which throws if it is ever
evaluated in a browser.

The LLM keys are optional — the hybrid workflow (Mode A) needs none of
them.

---

## 3. The 4.5 MB constraint

Vercel caps function request **and** response bodies at 4.5 MB and
returns `FUNCTION_PAYLOAD_TOO_LARGE` above it. `serverActions.bodySizeLimit`
cannot raise this — it only changes what Next accepts locally, so setting
it higher makes local dev *pass* and production *fail*.

Two consequences, both already handled:

**Audio never touches a function.** `createAudioUploadUrl` validates size
and MIME type server-side and returns a one-shot signed token (a few
hundred bytes). The browser then PUTs the MP3 **directly** to Supabase
Storage. A 20 MB clip works; routing it through a Server Action would
not.

**Question batches are chunked** at 100 per call, with every chunk after
the first appending to the same `batch_id` — so a 300-question paste is
still one row in the history and one click to delete.

No `vercel.json` is needed. Do **not** raise `bodySizeLimit` above 4mb.

---

## 4. Deploy

```bash
git remote add origin https://github.com/ALM3SHI/Step_pro.git
git add . && git commit -m "STEP Pro platform"
git push -u origin main
```

Import the repo in Vercel. Framework preset: **Next.js**. Add the three
env vars before the first deploy — the build succeeds without them, but
every admin page will fail at runtime.

---

## 5. Post-deploy checks

Run these in order; each one exercises a path that unit tests cannot.

1. `/admin/hybrid` → paste questions → Fast-Key → **Approve & Save**.
   Confirm a row appears in `ingestion_batches` and the questions land in
   `questions`.
2. Paste the **same** batch again. It must report everything as duplicate
   and insert nothing — that verifies the isomorphic SHA-256 produces
   identical hashes in the browser and on the server.
3. `/admin/listening` → upload an MP3 → set keys → save. Confirm the
   object exists in the `listening-audio` bucket and `audio_clips` has a
   matching `storage_path`.
4. `/admin/history` → delete that batch. Confirm the questions **and**
   the storage object are both gone (the `trg_audio_clip_delete` trigger).
5. Sit an exam end to end. Confirm listening audio streams, and that the
   player does **not** restart when moving between two questions on the
   same clip.

### Two things to watch specifically

**One-way lock false positives.** `exam_attempts` has a trigger rejecting
any decrease of `max_part_index`. Background sync carries a monotonic
`revision` so stale writes are discarded before they reach it — but this
has never run against a live database. If you see
`cannot return to part N`, that's the interaction to investigate.

**Signed URL lifetime.** Exam audio is signed for 4 hours at exam load,
not per part — a candidate can spend an hour on Reading before reaching
Listening. If you lengthen exams past 4 hours, raise
`AUDIO_URL_TTL_SECONDS` in `src/app/actions/exam-content.ts`.

---

## 6. Local verification

```bash
npm install
npm run ingest:verify        # 100% yield on both corpora
npm run listening:verify     # seed keys vs legacy + audio files
npm run solver:test          # LLM adapter, mock provider
npx tsx scripts/test-fastkey.ts
npx tsx scripts/test-sha256.ts
npx tsx scripts/test-exam-engine.ts
npx tsx scripts/test-small-batch.ts
npm run build
```

None of these need Supabase or an API key.
