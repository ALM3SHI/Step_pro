'use server';

import { createServiceClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { getDeviceId } from '@/lib/auth/device';
import { SECTION_DEFS, SKILL_BY_ID, type SectionId } from '@/lib/content/taxonomy';
import { accuracyToStepScore } from '@/lib/exam/scoring';

/**
 * Cross-attempt analytics.
 *
 * Everything here needs the per-question rows written by
 * `attempt_answers` (migration 0008). Before an attempt has been
 * submitted with outcomes, these return empty rather than fabricating a
 * trend from a single summary row.
 */

export interface AttemptSummary {
  id: string;
  examName: string;
  submittedAt: string;
  totalQuestions: number;
  correctCount: number;
  answeredCount: number;
  flaggedCount: number;
  weightedScore: number;
  estimatedStep: number;
  elapsedSeconds: number;
  /** Change in estimated STEP score against the previous attempt. */
  deltaVsPrevious: number | null;
  bySection: Record<string, { correct: number; total: number; pct: number }>;
}

export interface SkillTrend {
  skillId: string;
  nameAr: string;
  section: SectionId;
  attempted: number;
  correct: number;
  accuracyPct: number;
  avgSeconds: number | null;
  /** Change against this skill's earlier attempts. Null when only one. */
  deltaPct: number | null;
  mastery: 'strong' | 'developing' | 'weak';
}

export interface ProgressOverview {
  attempts: AttemptSummary[];
  skills: SkillTrend[];
  /** True when there is more than one submitted attempt to compare. */
  hasTrend: boolean;
}

export async function getProgressOverview(userId?: string): Promise<{
  ok: boolean;
  data?: ProgressOverview;
  error?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Supabase غير مضبوط' };
  }

  // Scope to this device. An explicit userId (a future account) wins;
  // otherwise the anonymous device cookie decides whose progress this is.
  // Without a scope, the dashboard would aggregate every visitor at once.
  const scopeId = userId ?? (await getDeviceId());
  if (!scopeId) {
    return { ok: true, data: { attempts: [], skills: [], hasTrend: false } };
  }

  try {
    const db = createServiceClient();

    // --- attempts -------------------------------------------------------
    const attemptQuery = db
      .from('exam_attempts')
      .select('id, blueprint, submitted_at, started_at, total_questions, correct_count, weighted_score')
      .eq('status', 'submitted')
      .eq('user_id', scopeId)
      .order('submitted_at', { ascending: true });

    const { data: attemptRows, error: aErr } = await attemptQuery;
    if (aErr) return { ok: false, error: aErr.message };

    const ids = (attemptRows ?? []).map((r) => r.id as string);
    if (!ids.length) {
      return { ok: true, data: { attempts: [], skills: [], hasTrend: false } };
    }

    // --- per-question rows, paged --------------------------------------
    const outcomes: Array<Record<string, unknown>> = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('attempt_answers')
        .select('attempt_id, section, skill_id, is_correct, was_answered, was_flagged, seconds_spent')
        .in('attempt_id', ids)
        .range(from, from + PAGE - 1);
      if (error) {
        // The table is created by migration 0008. Name it explicitly —
        // the raw PostgREST message ("schema cache") sends you looking
        // at caching rather than at an unrun migration.
        if (/attempt_answers/.test(error.message) && /schema cache|does not exist/i.test(error.message)) {
          return {
            ok: false,
            error: 'جدول نتائج الأسئلة غير موجود. شغّل supabase/migrations/0008_attempt_analytics.sql في SQL Editor.',
          };
        }
        return { ok: false, error: error.message };
      }
      if (!data?.length) break;
      outcomes.push(...data);
      if (data.length < PAGE) break;
    }

    // --- assemble attempt summaries ------------------------------------
    const byAttempt = new Map<string, Array<Record<string, unknown>>>();
    for (const o of outcomes) {
      const id = o.attempt_id as string;
      byAttempt.set(id, [...(byAttempt.get(id) ?? []), o]);
    }

    const attempts: AttemptSummary[] = (attemptRows ?? []).map((r) => {
      const rows = byAttempt.get(r.id as string) ?? [];
      const bySection: AttemptSummary['bySection'] = {};

      for (const o of rows) {
        const sec = o.section as string;
        bySection[sec] ??= { correct: 0, total: 0, pct: 0 };
        bySection[sec].total++;
        if (o.is_correct) bySection[sec].correct++;
      }
      for (const v of Object.values(bySection)) {
        v.pct = v.total ? (v.correct / v.total) * 100 : 0;
      }

      const weighted = Number(r.weighted_score ?? 0);
      const started = r.started_at ? new Date(r.started_at as string).getTime() : 0;
      const submitted = r.submitted_at ? new Date(r.submitted_at as string).getTime() : 0;

      return {
        id: r.id as string,
        examName: ((r.blueprint as { nameAr?: string })?.nameAr) ?? 'اختبار',
        submittedAt: (r.submitted_at as string) ?? '',
        totalQuestions: (r.total_questions as number) ?? rows.length,
        correctCount: (r.correct_count as number) ?? rows.filter((o) => o.is_correct).length,
        answeredCount: rows.filter((o) => o.was_answered).length,
        flaggedCount: rows.filter((o) => o.was_flagged).length,
        weightedScore: weighted,
        estimatedStep: accuracyToStepScore(weighted),
        elapsedSeconds: started && submitted ? Math.round((submitted - started) / 1000) : 0,
        deltaVsPrevious: null, // filled below, once ordered
        bySection,
      };
    });

    // Deltas against the immediately preceding attempt.
    for (let i = 1; i < attempts.length; i++) {
      attempts[i].deltaVsPrevious = attempts[i].estimatedStep - attempts[i - 1].estimatedStep;
    }

    // --- skill trends ---------------------------------------------------
    const attemptOrder = new Map(ids.map((id, i) => [id, i]));
    const bySkill = new Map<string, Array<Record<string, unknown>>>();
    for (const o of outcomes) {
      const skill = o.skill_id as string | null;
      if (!skill) continue;
      bySkill.set(skill, [...(bySkill.get(skill) ?? []), o]);
    }

    const skills: SkillTrend[] = [];
    for (const [skillId, rows] of bySkill) {
      const def = SKILL_BY_ID[skillId];
      if (!def) continue;

      const correct = rows.filter((o) => o.is_correct).length;
      const accuracyPct = rows.length ? (correct / rows.length) * 100 : 0;

      const timed = rows
        .map((o) => Number(o.seconds_spent))
        .filter((n) => Number.isFinite(n) && n > 0);

      // Trend compares the earliest attempts against the latest, and
      // only when BOTH halves carry enough questions to mean something.
      let deltaPct: number | null = null;
      if (attempts.length > 1) {
        const sorted = [...rows].sort(
          (a, b) =>
            (attemptOrder.get(a.attempt_id as string) ?? 0) -
            (attemptOrder.get(b.attempt_id as string) ?? 0),
        );
        const half = Math.floor(sorted.length / 2);
        if (half >= 3) {
          const early = sorted.slice(0, half);
          const late = sorted.slice(-half);
          const earlyAcc = (early.filter((o) => o.is_correct).length / early.length) * 100;
          const lateAcc = (late.filter((o) => o.is_correct).length / late.length) * 100;
          deltaPct = Math.round(lateAcc - earlyAcc);
        }
      }

      skills.push({
        skillId,
        nameAr: def.nameAr,
        section: def.section,
        attempted: rows.length,
        correct,
        accuracyPct,
        avgSeconds: timed.length ? timed.reduce((a, b) => a + b, 0) / timed.length : null,
        deltaPct,
        mastery: accuracyPct >= 80 ? 'strong' : accuracyPct >= 55 ? 'developing' : 'weak',
      });
    }

    skills.sort((a, b) => a.accuracyPct - b.accuracyPct);

    return {
      ok: true,
      data: {
        // Newest first for display; the deltas were computed in
        // chronological order above.
        attempts: [...attempts].reverse(),
        skills,
        hasTrend: attempts.length > 1,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Section totals across every submitted attempt. */
export async function getSectionTotals(userId?: string) {
  const res = await getProgressOverview(userId);
  if (!res.ok || !res.data) return res;

  const totals: Record<string, { correct: number; total: number; pct: number; weightPct: number }> = {};
  for (const a of res.data.attempts) {
    for (const [sec, v] of Object.entries(a.bySection)) {
      totals[sec] ??= {
        correct: 0, total: 0, pct: 0,
        weightPct: SECTION_DEFS[sec as SectionId]?.weightPct ?? 0,
      };
      totals[sec].correct += v.correct;
      totals[sec].total += v.total;
    }
  }
  for (const v of Object.values(totals)) v.pct = v.total ? (v.correct / v.total) * 100 : 0;

  return { ok: true as const, data: totals };
}
