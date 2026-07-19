-- =====================================================================
-- Migration 0008 — per-question attempt results
--
-- `exam_attempts` stores only a summary: answers as one jsonb blob plus
-- a total score. That is enough to show one result page and nothing
-- else. Every longitudinal question the dashboard needs —
--   "is this skill improving?"
--   "where does the candidate lose time?"
--   "do mistakes cluster in long questions?"
--   "how does this attempt compare to the last one?"
-- requires the outcome of each individual question, joined to its skill
-- and section, across attempts.
--
-- One row per answered-or-skipped question per attempt.
-- =====================================================================

create table if not exists public.attempt_answers (
  id             uuid primary key default gen_random_uuid(),
  attempt_id     uuid not null references public.exam_attempts(id) on delete cascade,
  question_id    uuid not null references public.questions(id)     on delete cascade,

  -- Denormalised from the question at answer time. The taxonomy of a
  -- question can be corrected later; a past attempt must keep the
  -- classification it was actually scored under, or historical trends
  -- silently rewrite themselves.
  section        question_category not null,
  skill_id       text,
  difficulty     question_difficulty not null default 'medium',

  chosen_option  option_key,
  correct_option option_key not null,
  is_correct     boolean not null,
  -- Distinguishes "answered wrongly" from "ran out of time".
  was_answered   boolean not null,
  was_flagged    boolean not null default false,

  /**
   * Seconds attributed to this question.
   *
   * Measured per SCREEN, then divided by the questions on it. Reading
   * shows several questions against one passage, and there is no honest
   * way to say which of them consumed the time — so this is an average
   * for such screens and exact for single-question screens.
   */
  seconds_spent  numeric(7,2),

  /** Position in the exam, for "did accuracy fall towards the end?". */
  part_index     integer,
  ordinal        integer,

  created_at     timestamptz not null default now()
);

-- One row per question per attempt; re-submitting must update, not
-- duplicate.
create unique index if not exists attempt_answers_unique
  on public.attempt_answers(attempt_id, question_id);

create index if not exists attempt_answers_attempt_idx on public.attempt_answers(attempt_id);
create index if not exists attempt_answers_skill_idx   on public.attempt_answers(skill_id);
create index if not exists attempt_answers_section_idx on public.attempt_answers(section);

alter table public.attempt_answers enable row level security;

drop policy if exists attempt_answers_own on public.attempt_answers;
create policy attempt_answers_own on public.attempt_answers
  for select using (
    exists (
      select 1 from public.exam_attempts a
      where a.id = attempt_answers.attempt_id and a.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- Per-skill history
--
-- A view rather than a table: it must never drift from the rows it
-- summarises, and the volume here is small enough that recomputing is
-- cheaper than maintaining a second copy.
-- ---------------------------------------------------------------------
create or replace view public.skill_performance as
select
  a.user_id,
  aa.skill_id,
  aa.section,
  count(*)                                   as attempted,
  count(*) filter (where aa.is_correct)      as correct,
  round(avg(aa.seconds_spent)::numeric, 1)   as avg_seconds,
  round(
    (count(*) filter (where aa.is_correct))::numeric
      / nullif(count(*), 0) * 100, 1
  )                                          as accuracy_pct,
  max(a.submitted_at)                        as last_seen
from public.attempt_answers aa
join public.exam_attempts a on a.id = aa.attempt_id
where a.status = 'submitted'
group by a.user_id, aa.skill_id, aa.section;

-- ---------------------------------------------------------------------
-- Attempt history, for the trend line
-- ---------------------------------------------------------------------
create or replace view public.attempt_history as
select
  a.id,
  a.user_id,
  a.status,
  a.started_at,
  a.submitted_at,
  a.total_questions,
  a.correct_count,
  a.weighted_score,
  (a.blueprint ->> 'nameAr')                                as exam_name,
  (a.blueprint ->> 'blueprintId')                           as blueprint_id,
  extract(epoch from (a.submitted_at - a.started_at))::int   as elapsed_seconds,
  (select count(*) from public.attempt_answers x
    where x.attempt_id = a.id and x.was_answered)            as answered_count,
  (select count(*) from public.attempt_answers x
    where x.attempt_id = a.id and x.was_flagged)             as flagged_count
from public.exam_attempts a
where a.status = 'submitted';
