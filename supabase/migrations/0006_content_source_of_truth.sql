-- =====================================================================
-- Migration 0006 — make Supabase the single source of truth for content
--
-- The existing `questions` table cannot hold everything the content
-- bundle carries. Seeding without this migration would SILENTLY DROP:
--   * skill_id   — the 27-skill taxonomy on all 1,409 questions, which
--                  every per-skill analytic and the study plan depend on
--   * difficulty — currently uniform, but the field has nowhere to live
--   * tags       — legacy / bank / needs-key / needs-fix / verified-key
--   * status     — only `is_active` (boolean) exists, which cannot
--                  distinguish "draft" (no answer key) from "review"
--                  (structurally broken) from "retired"
--
-- Additive only. No column is dropped and no row is rewritten, so it is
-- safe to run against the live database.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Skills registry
--
-- A real table rather than a free-text column: a typo in a skill id
-- silently creates a 28th skill and quietly breaks the analytics that
-- group by it. The FK makes that impossible.
-- ---------------------------------------------------------------------
create table if not exists public.skills (
  id            text primary key,
  category      question_category not null,
  name_ar       text not null,
  name_en       text not null,
  study_hint_ar text,
  display_order integer not null default 0
);

-- Ids are the legacy ones, preserved verbatim so the 1,135 already
-- tagged questions import with no remapping step (a remap is a
-- silent-corruption risk for zero benefit).
insert into public.skills (id, category, name_ar, name_en, display_order) values
  ('tenses',       'grammar',   'الأزمنة',                'Tenses',                     1),
  ('svagree',      'grammar',   'توافق الفعل مع الفاعل',  'Subject-Verb Agreement',     2),
  ('preps',        'grammar',   'حروف الجر',              'Prepositions',               3),
  ('pronouns',     'grammar',   'الضمائر',                'Pronouns',                   4),
  ('quantifiers',  'grammar',   'المحددات والكميات',      'Quantifiers',                5),
  ('articles',     'grammar',   'أدوات التعريف',          'Articles',                   6),
  ('conditionals', 'grammar',   'الجمل الشرطية',          'Conditionals',               7),
  ('passive',      'grammar',   'المبني للمجهول',         'Passive Voice',              8),
  ('relative',     'grammar',   'ضمائر الوصل',            'Relative Clauses',           9),
  ('compare',      'grammar',   'المقارنة والتفضيل',      'Comparatives',              10),
  ('modals',       'grammar',   'الأفعال الناقصة',        'Modals',                    11),
  ('gerund',       'grammar',   'المصدر والاسم الفعلي',   'Gerunds & Infinitives',     12),
  ('conj',         'grammar',   'أدوات الربط',            'Conjunctions',              13),
  ('wordform',     'grammar',   'اشتقاق الكلمات',         'Word Forms',                14),
  ('main',         'reading',   'الفكرة الرئيسية',        'Main Idea',                 20),
  ('detail',       'reading',   'الأسئلة التفصيلية',      'Supporting Detail',         21),
  ('infer',        'reading',   'الاستنتاج',              'Inference',                 22),
  ('vocab',        'reading',   'معنى الكلمة من السياق',  'Vocabulary in Context',     23),
  ('ref',          'reading',   'مرجع الضمير',            'Pronoun Reference',         24),
  ('lmain',        'listening', 'المسموع: الفكرة العامة', 'Listening: Gist',           30),
  ('ldetail',      'listening', 'المسموع: التفاصيل',      'Listening: Detail',         31),
  ('linfer',       'listening', 'المسموع: الاستنتاج',     'Listening: Inference',      32),
  ('error',        'writing',   'اكتشاف الخطأ',           'Error Identification',      40),
  ('wordorder',    'writing',   'ترتيب الكلمات',          'Word Order',                41),
  ('order',        'writing',   'ترتيب الفقرة',           'Sentence Ordering',         42),
  ('punct',        'writing',   'علامات الترقيم',         'Punctuation',               43),
  ('best',         'writing',   'اختيار أفضل صياغة',      'Best Construction',         44)
on conflict (id) do update set
  category      = excluded.category,
  name_ar       = excluded.name_ar,
  name_en       = excluded.name_en,
  display_order = excluded.display_order;

-- ---------------------------------------------------------------------
-- 2. Content status
--
-- Four states, because `is_active` cannot express the difference between
-- "no answer key yet" and "structurally broken, needs a human".
-- ---------------------------------------------------------------------
do $$ begin
  create type content_status as enum ('draft', 'review', 'published', 'retired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type question_difficulty as enum ('easy', 'medium', 'hard');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 3. Widen `questions`
-- ---------------------------------------------------------------------
alter table public.questions
  add column if not exists skill_id   text references public.skills(id),
  add column if not exists difficulty question_difficulty not null default 'medium',
  add column if not exists tags       text[] not null default '{}',
  add column if not exists status     content_status not null default 'published',
  -- Stable id from the source bundle, so re-seeding updates in place
  -- instead of inserting a second copy of every question.
  add column if not exists external_id text;

create unique index if not exists questions_external_id_key
  on public.questions(external_id) where external_id is not null;

create index if not exists questions_skill_idx  on public.questions(skill_id);
create index if not exists questions_status_idx on public.questions(status);
create index if not exists questions_tags_idx   on public.questions using gin (tags);

-- Existing rows predate the enum; keep them consistent with is_active.
update public.questions
   set status = case when is_active then 'published'::content_status else 'retired'::content_status end
 where status is null;

-- A skill must belong to its question's own section, or the per-skill
-- breakdown silently attributes a reading skill to grammar.
create or replace function public.check_skill_matches_category()
returns trigger language plpgsql as $$
declare v_cat question_category;
begin
  if new.skill_id is null then return new; end if;
  select category into v_cat from public.skills where id = new.skill_id;
  if v_cat is distinct from new.category then
    raise exception 'skill % belongs to % but question is %', new.skill_id, v_cat, new.category;
  end if;
  return new;
end $$;

drop trigger if exists trg_questions_skill_category on public.questions;
create trigger trg_questions_skill_category
  before insert or update of skill_id, category on public.questions
  for each row execute function public.check_skill_matches_category();

-- `is_active` is kept as a generated mirror of `status` so any existing
-- query or RLS policy that reads it keeps working unchanged.
create or replace function public.sync_is_active()
returns trigger language plpgsql as $$
begin
  new.is_active := (new.status = 'published');
  return new;
end $$;

drop trigger if exists trg_questions_sync_active on public.questions;
create trigger trg_questions_sync_active
  before insert or update of status on public.questions
  for each row execute function public.sync_is_active();

-- ---------------------------------------------------------------------
-- 4. Passages: carry titles and a stable id
-- ---------------------------------------------------------------------
alter table public.passages
  add column if not exists title_ar    text,
  add column if not exists external_id text;

create unique index if not exists passages_external_id_key
  on public.passages(external_id) where external_id is not null;

alter table public.audio_clips
  add column if not exists external_id text;

create unique index if not exists audio_clips_external_id_key
  on public.audio_clips(external_id) where external_id is not null;

-- ---------------------------------------------------------------------
-- 5. Runtime view for the exam builder
--
-- One place that defines "servable": published, active, and with its
-- stimulus present. The builder reads this instead of re-implementing
-- the rule.
-- ---------------------------------------------------------------------
create or replace view public.servable_questions as
select
  q.id, q.external_id, q.category, q.skill_id, q.difficulty, q.tags,
  q.question_text, q.options, q.correct_option, q.explanation,
  q.passage_id, q.audio_clip_id, q.ordinal,
  q.image_url, q.image_alt, q.content_hash,
  p.body  as passage_body,
  p.title as passage_title,
  p.image_url as passage_image_url,
  p.image_alt as passage_image_alt,
  a.audio_key, a.storage_path
from public.questions q
left join public.passages    p on p.id = q.passage_id
left join public.audio_clips a on a.id = q.audio_clip_id
where q.status = 'published'
  and q.is_active
  -- Unanswerable without its stimulus.
  and (q.passage_id    is null or p.id is not null)
  and (q.audio_clip_id is null or a.id is not null);

alter table public.skills enable row level security;

drop policy if exists skills_public_read on public.skills;
create policy skills_public_read on public.skills for select using (true);
