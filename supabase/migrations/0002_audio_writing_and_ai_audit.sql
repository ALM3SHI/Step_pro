-- =====================================================================
-- Migration 0002
--
-- Driven by three facts found in the legacy step-prep.html bank:
--   * it contains a FOURTH section, `write` (126 items), which the
--     original three-value category enum cannot represent;
--   * listening items reference audio files and need a stimulus row;
--   * 1,135 items ship with verified answer keys + Arabic explanations,
--     which we keep as a gold set for measuring LLM accuracy.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Writing category
-- ---------------------------------------------------------------------
alter type question_category add value if not exists 'writing';

-- ---------------------------------------------------------------------
-- 2. Audio stimuli
--
-- Modelled like `passages`: several questions share one recording
-- (1742938840.mp3 carries three), so the audio is its own row.
-- ---------------------------------------------------------------------
create table if not exists public.audio_clips (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid references public.ingestion_batches(id) on delete cascade,
  -- Stable identifier from the filename, e.g. '1742938770'.
  audio_key    text not null,
  storage_path text not null,
  transcript   text,
  duration_ms  integer,
  created_at   timestamptz not null default now()
);

create unique index if not exists audio_clips_key_uniq on public.audio_clips(audio_key);

alter table public.questions
  add column if not exists audio_clip_id uuid references public.audio_clips(id) on delete cascade,
  -- Position within a shared stimulus (Q1/Q2/Q3 of one recording).
  add column if not exists ordinal integer;

create index if not exists questions_audio_idx on public.questions(audio_clip_id);

-- A listening question must have audio; nothing else may.
alter table public.questions drop constraint if exists questions_audio_matches_category;
alter table public.questions add constraint questions_audio_matches_category
  check ((category = 'listening') = (audio_clip_id is not null));

-- ---------------------------------------------------------------------
-- 3. Answer provenance
--
-- Distinguishes an answer we KNOW (shipped key, human review) from one
-- the LLM inferred. Without this, a verified listening key and a
-- low-confidence model guess look identical in the table, and the review
-- UI cannot prioritise correctly.
-- ---------------------------------------------------------------------
do $$ begin
  create type answer_source as enum ('provided_key', 'llm_consensus', 'llm_single', 'human_review');
exception when duplicate_object then null; end $$;

alter table public.questions
  add column if not exists answer_source answer_source not null default 'llm_single',
  -- Fraction of self-consistency voters that agreed, e.g. 1.0 = 5/5.
  add column if not exists consensus_ratio numeric(4,3)
    check (consensus_ratio is null or consensus_ratio between 0 and 1),
  add column if not exists needs_human_review boolean not null default false;

-- Anything the model was not near-unanimous about gets queued for review.
create index if not exists questions_needs_review_idx
  on public.questions(needs_human_review) where needs_human_review;

-- ---------------------------------------------------------------------
-- 4. Gold set for accuracy measurement
--
-- Held separately from `questions` so evaluating the pipeline never
-- risks mutating production content.
-- ---------------------------------------------------------------------
create table if not exists public.gold_questions (
  id             uuid primary key default gen_random_uuid(),
  legacy_id      text not null unique,
  category       question_category not null,
  skill          text,
  question_text  text not null,
  options        jsonb not null,
  correct_option option_key not null,
  explanation    text,
  content_hash   char(64) not null,
  created_at     timestamptz not null default now()
);

create unique index if not exists gold_questions_hash_uniq on public.gold_questions(content_hash);

alter table public.audio_clips    enable row level security;
alter table public.gold_questions enable row level security;

drop policy if exists audio_public_read on public.audio_clips;
create policy audio_public_read on public.audio_clips for select using (true);
