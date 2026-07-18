-- =====================================================================
-- Migration 0004 — attempt persistence
-- =====================================================================

alter table public.exam_attempts
  -- Monotonic client revision. Background syncs can arrive out of order
  -- (a slow request landing after a fast one); without this, a stale
  -- payload carrying an older part index overwrites newer progress and
  -- trips the one-way-lock trigger for no reason.
  add column if not exists revision integer not null default 0,
  add column if not exists part_timings jsonb not null default '{}'::jsonb,
  add column if not exists locked_screens jsonb not null default '{}'::jsonb,
  add column if not exists screen_index integer not null default 0,
  add column if not exists phase text not null default 'intro';

-- ---------------------------------------------------------------------
-- Atomic, ordered upsert of attempt progress.
--
-- All-or-nothing in one statement so a sync cannot land half-applied,
-- and stale revisions are ignored rather than rejected — the client has
-- already moved on and an error would be noise, not signal.
-- ---------------------------------------------------------------------
create or replace function public.sync_exam_attempt(
  p_attempt_id     uuid,
  p_revision       integer,
  p_answers        jsonb,
  p_flags          jsonb,
  p_current_part   integer,
  p_screen_index   integer,
  p_phase          text,
  p_part_timings   jsonb,
  p_locked_screens jsonb
)
returns table (applied boolean, stored_revision integer)
language plpgsql security definer set search_path = public as $$
declare
  v_current integer;
  v_status  attempt_status;
begin
  select revision, status into v_current, v_status
  from exam_attempts where id = p_attempt_id
  for update;

  if v_current is null then
    raise exception 'attempt % not found', p_attempt_id using errcode = 'no_data_found';
  end if;

  -- A submitted attempt is immutable. Late writes from a tab that was
  -- still open must not reopen or alter a graded paper.
  if v_status <> 'in_progress' then
    return query select false, v_current;
    return;
  end if;

  if p_revision <= v_current then
    return query select false, v_current;
    return;
  end if;

  update exam_attempts set
    revision       = p_revision,
    answers        = p_answers,
    flags          = p_flags,
    current_part   = p_current_part,
    screen_index   = p_screen_index,
    phase          = p_phase,
    part_timings   = p_part_timings,
    locked_screens = p_locked_screens,
    max_part_index = greatest(max_part_index, p_current_part)
  where id = p_attempt_id;

  return query select true, p_revision;
end $$;

-- ---------------------------------------------------------------------
-- Final submission. Scores server-side against the stored answer keys —
-- a client-reported score is a client-controlled score.
-- ---------------------------------------------------------------------
create or replace function public.submit_exam_attempt(
  p_attempt_id uuid,
  p_answers    jsonb
)
returns table (correct integer, total integer, weighted numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_correct integer := 0;
  v_total   integer := 0;
  v_weighted numeric := 0;
  v_weight_sum numeric := 0;
  r record;
begin
  if (select status from exam_attempts where id = p_attempt_id) <> 'in_progress' then
    raise exception 'attempt % is already submitted', p_attempt_id;
  end if;

  -- Per-section accuracy, then weight by the official percentages.
  for r in
    select q.category,
           count(*) as n,
           count(*) filter (
             where p_answers ->> q.id::text = q.correct_option::text
           ) as ok,
           max(sc.weight_pct) as weight_pct
    from questions q
    join section_config sc on sc.category = q.category
    where p_answers ? q.id::text
       or q.id::text in (select jsonb_object_keys(p_answers))
    group by q.category
  loop
    v_total := v_total + r.n;
    v_correct := v_correct + r.ok;
    if r.n > 0 then
      v_weighted := v_weighted + (r.ok::numeric / r.n * 100) * r.weight_pct;
      v_weight_sum := v_weight_sum + r.weight_pct;
    end if;
  end loop;

  update exam_attempts set
    status = 'submitted',
    answers = p_answers,
    correct_count = v_correct,
    total_questions = v_total,
    weighted_score = case when v_weight_sum > 0 then v_weighted / v_weight_sum else 0 end,
    submitted_at = now()
  where id = p_attempt_id;

  return query select v_correct, v_total,
    case when v_weight_sum > 0 then round(v_weighted / v_weight_sum, 2) else 0::numeric end;
end $$;
