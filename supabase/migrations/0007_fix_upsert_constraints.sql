-- =====================================================================
-- Migration 0007 — fix the ON CONFLICT targets, quarantine untagged rows
--
-- Two defects introduced by 0006, both found by running the migration:
--
-- 1. The external_id unique indexes were PARTIAL (`where external_id is
--    not null`). PostgreSQL cannot match `ON CONFLICT (external_id)`
--    against a partial index unless the statement repeats the same
--    predicate, so every upsert failed with:
--      "there is no unique or exclusion constraint matching the
--       ON CONFLICT specification"
--    A plain unique index is the right tool here: Postgres already
--    treats NULLs as distinct, so rows created through the admin UI
--    (which have no external_id) are unaffected and can be many.
--
-- 2. `status` defaulted to 'published', which silently published every
--    pre-existing row. Those rows have no skill_id, so they entered the
--    simulator pool untagged and broke the per-skill analytics.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Replace the partial indexes
-- ---------------------------------------------------------------------
drop index if exists public.questions_external_id_key;
drop index if exists public.passages_external_id_key;
drop index if exists public.audio_clips_external_id_key;

create unique index questions_external_id_key    on public.questions(external_id);
create unique index passages_external_id_key     on public.passages(external_id);
create unique index audio_clips_external_id_key  on public.audio_clips(external_id);

-- ---------------------------------------------------------------------
-- 2. Quarantine rows that have no skill
--
-- An untagged question is not "wrong" — it just cannot be attributed in
-- the weakness breakdown or the study plan, so serving it quietly
-- degrades the analytics. Moving it to `draft` keeps the content and
-- takes it out of the exam pool until a skill is assigned.
--
-- Reversible: set status back to 'published' once tagged, or run
--   update public.questions set status = 'published'
--    where 'untagged-import' = any(tags);
-- ---------------------------------------------------------------------
update public.questions
   set status = 'draft',
       tags   = array(select distinct unnest(tags || array['untagged-import']))
 where skill_id is null
   and status = 'published';

-- ---------------------------------------------------------------------
-- 3. Guard against it recurring
--
-- A published question must carry a skill. Enforced with NOT VALID so
-- the constraint applies to new and updated rows without failing on any
-- historical row that has not been triaged yet.
-- ---------------------------------------------------------------------
alter table public.questions drop constraint if exists questions_published_needs_skill;
alter table public.questions add constraint questions_published_needs_skill
  check (status <> 'published' or skill_id is not null) not valid;

-- ---------------------------------------------------------------------
-- 4. Report
-- ---------------------------------------------------------------------
do $$
declare
  v_total     integer;
  v_untagged  integer;
  v_servable  integer;
begin
  select count(*) into v_total    from public.questions;
  select count(*) into v_untagged from public.questions where skill_id is null;
  select count(*) into v_servable from public.servable_questions;

  raise notice 'questions total: %, untagged (now draft): %, servable: %',
    v_total, v_untagged, v_servable;
end $$;
