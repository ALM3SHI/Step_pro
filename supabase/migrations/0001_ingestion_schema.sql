-- =====================================================================
-- STEP Prep — Admin Ingestion & AI Processing Engine
-- Migration 0001: batches, passages, questions
-- =====================================================================

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "pg_trgm";       -- fuzzy/near-duplicate search

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin
  create type ingestion_status as enum ('pending', 'processing', 'review', 'completed', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type question_category as enum ('grammar', 'reading', 'listening');
exception when duplicate_object then null; end $$;

do $$ begin
  create type option_key as enum ('A', 'B', 'C', 'D');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- ingestion_batches
-- ---------------------------------------------------------------------
create table if not exists public.ingestion_batches (
  id                        uuid primary key default gen_random_uuid(),
  batch_title               text not null check (length(btrim(batch_title)) between 1 and 200),
  source_metadata           jsonb not null default '{}'::jsonb,
  status                    ingestion_status not null default 'pending',

  -- Pipeline telemetry. Kept denormalised so the history cards render
  -- from a single row with no aggregate scan.
  total_questions_parsed    integer not null default 0,  -- segmenter output
  total_questions_duplicate integer not null default 0,  -- dropped by dedupe
  total_questions_processed integer not null default 0,  -- survived to AI
  total_questions_saved     integer not null default 0,  -- committed rows
  error_message             text,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  completed_at              timestamptz
);

comment on column public.ingestion_batches.total_questions_processed is
  'Questions that reached the LLM stage (parsed minus duplicates).';

-- ---------------------------------------------------------------------
-- passages
--
-- Reading questions in the real corpus share a multi-paragraph passage
-- (see reading_bank.txt). Storing the passage inline on every question
-- would duplicate ~2KB per row and make edits inconsistent, so it gets
-- its own table. Grammar/listening rows simply leave passage_id null.
-- ---------------------------------------------------------------------
create table if not exists public.passages (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references public.ingestion_batches(id) on delete cascade,
  title         text,
  body          text not null,
  content_hash  char(64) not null,
  created_at    timestamptz not null default now()
);

create unique index if not exists passages_content_hash_key on public.passages(content_hash);
create index if not exists passages_batch_id_idx on public.passages(batch_id);

-- ---------------------------------------------------------------------
-- questions
-- ---------------------------------------------------------------------
create table if not exists public.questions (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references public.ingestion_batches(id) on delete cascade,
  passage_id      uuid          references public.passages(id)          on delete cascade,

  category        question_category not null,
  question_text   text not null check (length(btrim(question_text)) >= 3),

  -- {"A": "...", "B": "...", "C": "...", "D": "..."}
  options         jsonb not null,
  correct_option  option_key,

  explanation     text,
  content_hash    char(64) not null,

  -- Audit trail: which model answered, and how sure it was.
  ai_provider     text,
  ai_model        text,
  ai_confidence   numeric(4,3) check (ai_confidence between 0 and 1),
  reviewed_by     uuid,
  reviewed_at     timestamptz,

  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Structural guarantees. These are the DB-level backstop for the
  -- "20 questions merged into one row" class of parser bug: a merged
  -- blob reliably trips either the option-count or the length check.
  constraint questions_options_is_object
    check (jsonb_typeof(options) = 'object'),
  -- At least A+B must exist, and nothing outside A-D may exist. Pure
  -- jsonb operators only -- CHECK constraints cannot contain subqueries,
  -- which rules out counting via jsonb_object_keys().
  constraint questions_options_min_two
    check (options ?& array['A','B']),
  constraint questions_options_max_four
    check (not (options ?| array['E','F','G','H','I','J'])),
  constraint questions_correct_option_present
    check (correct_option is null or options ? correct_option::text),
  constraint questions_text_not_a_blob
    check (category = 'reading' or length(question_text) <= 1200)
);

-- Global dedupe. The pipeline checks this hash before calling the LLM;
-- the unique index is the race-condition backstop for concurrent batches.
create unique index if not exists questions_content_hash_key on public.questions(content_hash);

create index if not exists questions_batch_id_idx  on public.questions(batch_id);
create index if not exists questions_category_idx  on public.questions(category) where is_active;
create index if not exists questions_passage_idx   on public.questions(passage_id);
create index if not exists questions_text_trgm_idx on public.questions using gin (question_text gin_trgm_ops);

-- ---------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_batches_touch on public.ingestion_batches;
create trigger trg_batches_touch before update on public.ingestion_batches
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_questions_touch on public.questions;
create trigger trg_questions_touch before update on public.questions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Cascade delete RPC
--
-- `on delete cascade` already wipes the children, but the admin UI wants
-- the deleted counts back to render a confirmation toast. Doing it in one
-- SQL function keeps it atomic and saves a round trip.
-- ---------------------------------------------------------------------
create or replace function public.delete_ingestion_batch(p_batch_id uuid)
returns table (deleted_batch_title text, deleted_questions integer, deleted_passages integer)
language plpgsql security definer set search_path = public as $$
declare
  v_title text;
  v_questions integer;
  v_passages integer;
begin
  select batch_title into v_title from ingestion_batches where id = p_batch_id;
  if v_title is null then
    raise exception 'Batch % not found', p_batch_id using errcode = 'no_data_found';
  end if;

  select count(*) into v_questions from questions where batch_id = p_batch_id;
  select count(*) into v_passages  from passages  where batch_id = p_batch_id;

  delete from ingestion_batches where id = p_batch_id;  -- cascades

  return query select v_title, v_questions, v_passages;
end $$;

-- ---------------------------------------------------------------------
-- History view backing the batch cards
-- ---------------------------------------------------------------------
create or replace view public.ingestion_batch_overview as
select
  b.id,
  b.batch_title,
  b.source_metadata,
  b.status,
  b.created_at,
  b.total_questions_parsed,
  b.total_questions_duplicate,
  b.total_questions_saved,
  count(q.id) filter (where q.is_active)                              as live_questions,
  count(q.id) filter (where q.category = 'grammar'   and q.is_active) as grammar_count,
  count(q.id) filter (where q.category = 'reading'   and q.is_active) as reading_count,
  count(q.id) filter (where q.category = 'listening' and q.is_active) as listening_count
from public.ingestion_batches b
left join public.questions q on q.batch_id = b.id
group by b.id;

-- ---------------------------------------------------------------------
-- RLS — admin-only write, public read of active questions
-- ---------------------------------------------------------------------
alter table public.ingestion_batches enable row level security;
alter table public.questions          enable row level security;
alter table public.passages           enable row level security;

-- Students / the public site: read active questions only.
drop policy if exists questions_public_read on public.questions;
create policy questions_public_read on public.questions
  for select using (is_active);

drop policy if exists passages_public_read on public.passages;
create policy passages_public_read on public.passages
  for select using (true);

-- Admin writes go through the service-role key from server actions only.
-- No anon-key policy is defined for insert/update/delete, so they are
-- denied by default. Do NOT expose the service key to the browser.
