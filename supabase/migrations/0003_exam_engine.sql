-- =====================================================================
-- Migration 0003 — exam engine support
--   * image/graph stimuli for analytical reading items
--   * section weighting, sourced from the legacy SECTIONS table
--   * exam attempt persistence (resume + audit)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Image stimuli
--
-- Some analytical reading items are answerable only from a chart (e.g.
-- freshwater levels by country). The image is part of the stimulus, so it
-- lives with the passage when there is one, and on the question when the
-- chart stands alone.
-- ---------------------------------------------------------------------
alter table public.questions
  add column if not exists image_url text,
  add column if not exists image_alt text;

alter table public.passages
  add column if not exists image_url text,
  add column if not exists image_alt text;

comment on column public.questions.image_alt is
  'Required when image_url is set — screen-reader text describing the chart.';

-- An image without a description is inaccessible, and STEP candidates
-- include users of assistive technology.
alter table public.questions drop constraint if exists questions_image_has_alt;
alter table public.questions add constraint questions_image_has_alt
  check (image_url is null or (image_alt is not null and length(btrim(image_alt)) > 0));

-- ---------------------------------------------------------------------
-- 2. Section weights
--
-- Official STEP weighting. Stored rather than hardcoded so the exam
-- builder and the analytics both read one source of truth.
-- ---------------------------------------------------------------------
create table if not exists public.section_config (
  category      question_category primary key,
  name_ar       text not null,
  name_en       text not null,
  weight_pct    integer not null check (weight_pct between 0 and 100),
  -- Listening is forward-only with no review grid; the others allow
  -- bidirectional navigation. This drives the engine, not just the UI.
  allows_back   boolean not null default true,
  allows_review boolean not null default true,
  display_order integer not null
);

insert into public.section_config (category, name_ar, name_en, weight_pct, allows_back, allows_review, display_order)
values
  ('reading',   'فهم المقروء',      'Reading Comprehension', 40, true,  true,  1),
  ('grammar',   'القواعد والتراكيب', 'Grammar & Structure',   30, true,  true,  2),
  ('listening', 'فهم المسموع',      'Listening',             20, false, false, 3),
  ('writing',   'التحليل الكتابي',   'Writing Analysis',      10, true,  true,  4)
on conflict (category) do update set
  name_ar = excluded.name_ar,
  name_en = excluded.name_en,
  weight_pct = excluded.weight_pct,
  allows_back = excluded.allows_back,
  allows_review = excluded.allows_review,
  display_order = excluded.display_order;

-- Weights must total 100, or the weighted score is meaningless.
do $$
declare total integer;
begin
  select sum(weight_pct) into total from public.section_config;
  if total <> 100 then
    raise exception 'section_config weights sum to %, expected 100', total;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Exam attempts
-- ---------------------------------------------------------------------
do $$ begin
  create type attempt_status as enum ('in_progress', 'submitted', 'expired', 'abandoned');
exception when duplicate_object then null; end $$;

create table if not exists public.exam_attempts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid,
  status         attempt_status not null default 'in_progress',

  -- Frozen question order + part layout. Without this an attempt cannot
  -- be resumed or audited: the pool changes as new batches are ingested.
  blueprint      jsonb not null,
  answers        jsonb not null default '{}'::jsonb,
  flags          jsonb not null default '[]'::jsonb,

  -- Highest part index the candidate has entered. One-way locking is
  -- enforced against THIS, server-side; a client-only guard would be
  -- bypassable from the console.
  max_part_index integer not null default 0,
  current_part   integer not null default 0,
  part_deadlines jsonb not null default '{}'::jsonb,

  total_questions integer not null default 0,
  correct_count   integer,
  weighted_score  numeric(5,2),

  started_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  updated_at     timestamptz not null default now()
);

create index if not exists exam_attempts_user_idx on public.exam_attempts(user_id, started_at desc);

drop trigger if exists trg_attempts_touch on public.exam_attempts;
create trigger trg_attempts_touch before update on public.exam_attempts
  for each row execute function public.touch_updated_at();

alter table public.exam_attempts  enable row level security;
alter table public.section_config enable row level security;

drop policy if exists section_config_read on public.section_config;
create policy section_config_read on public.section_config for select using (true);

drop policy if exists attempts_own on public.exam_attempts;
create policy attempts_own on public.exam_attempts
  for select using (auth.uid() = user_id);

-- Guard against a client rewinding max_part_index to re-open a locked part.
create or replace function public.enforce_one_way_lock()
returns trigger language plpgsql as $$
begin
  if new.max_part_index < old.max_part_index then
    raise exception 'max_part_index cannot decrease (% -> %): parts are one-way',
      old.max_part_index, new.max_part_index;
  end if;
  if new.current_part < old.max_part_index then
    raise exception 'cannot return to part % after reaching part %',
      new.current_part, old.max_part_index;
  end if;
  return new;
end $$;

drop trigger if exists trg_attempts_one_way on public.exam_attempts;
create trigger trg_attempts_one_way before update on public.exam_attempts
  for each row execute function public.enforce_one_way_lock();
