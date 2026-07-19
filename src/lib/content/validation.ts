/**
 * Question validation — one implementation, run on both sides.
 *
 * The browser runs it for instant feedback while typing; the server runs
 * the SAME function before every write. Two copies would drift, and the
 * one that drifts is always the server's, which is the one that matters.
 *
 * Duplicate detection is deliberately NOT here: it needs a database
 * round trip, so it lives in the repository and is reported alongside
 * these results.
 */

import { OPTION_KEYS, type OptionKey } from './schema';
import { SKILL_BY_ID, type SectionId } from './taxonomy';

export type Severity = 'error' | 'warning';

export interface Issue {
  field: string;
  severity: Severity;
  message: string;
}

export interface DraftQuestion {
  id?: string;
  section: SectionId;
  skillId: string;
  difficulty: string;
  status: string;
  text: string;
  options: Partial<Record<OptionKey, string>>;
  correctOption?: OptionKey | '';
  explanationAr?: string;
  tags?: string[];
  passageId?: string | null;
  audioClipId?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  ordinal?: number | null;
}

export interface ValidationResult {
  issues: Issue[];
  errors: Issue[];
  warnings: Issue[];
  /** False blocks saving. */
  canSave: boolean;
}

const MAX_PROMPT_WORDS = 120;

export function validateDraft(q: DraftQuestion): ValidationResult {
  const issues: Issue[] = [];
  const err = (field: string, message: string) => issues.push({ field, severity: 'error', message });
  const warn = (field: string, message: string) => issues.push({ field, severity: 'warning', message });

  // --- text ---
  const text = q.text ?? '';
  if (!text.trim()) err('text', 'نص السؤال مطلوب');
  else if (text.trim().length < 5) err('text', 'نص السؤال قصير جدًا');
  else if (q.section !== 'reading' && text.split(/\s+/).length > MAX_PROMPT_WORDS) {
    // A merged block reliably blows past this; reading prompts are short
    // because the length lives in the passage.
    warn('text', `النص ${text.split(/\s+/).length} كلمة — تأكد أنه سؤال واحد وليس عدة أسئلة`);
  }

  // --- skill ---
  if (!q.skillId) {
    err('skillId', 'المهارة مطلوبة — بدونها لا يظهر السؤال في تحليل نقاط الضعف');
  } else {
    const skill = SKILL_BY_ID[q.skillId];
    if (!skill) err('skillId', `مهارة غير معروفة: ${q.skillId}`);
    // A reading skill on a grammar question silently misattributes the
    // whole per-skill breakdown.
    else if (skill.section !== q.section) {
      err('skillId', `المهارة «${skill.nameAr}» تخص قسم ${skill.section} وليس ${q.section}`);
    }
  }

  // --- options ---
  const present = OPTION_KEYS.filter((k) => q.options[k]?.trim());
  if (present.length < 2) {
    err('options', `خياران على الأقل مطلوبان (الحالي ${present.length})`);
  }

  // Gaps confuse the exam renderer, which walks A→D in order.
  for (let i = 1; i < present.length; i++) {
    const expected = OPTION_KEYS[i];
    if (present[i] !== expected) {
      err('options', 'الخيارات يجب أن تكون متتالية من A دون فجوات');
      break;
    }
  }

  // Case- and punctuation-SENSITIVE. Whole question families
  // (CAPITALIZATION, PUNCTUATION) differ only by case or commas, and
  // normalising before this check would delete valid questions.
  const seen = new Map<string, OptionKey>();
  for (const k of present) {
    const v = q.options[k]!.trim();
    const prior = seen.get(v);
    if (prior) err('options', `الخياران ${prior} و${k} متطابقان تمامًا`);
    else seen.set(v, k);
  }

  // --- correct answer ---
  if (!q.correctOption) {
    err('correctOption', 'حدّد الإجابة الصحيحة');
  } else if (!q.options[q.correctOption as OptionKey]?.trim()) {
    err('correctOption', `الإجابة ${q.correctOption} تشير إلى خيار فارغ`);
  }

  // --- section-specific structure ---
  if (q.section === 'listening' && !q.audioClipId) {
    err('audioClipId', 'سؤال الاستماع يحتاج تسجيلًا صوتيًا');
  }
  if (q.section !== 'listening' && q.audioClipId) {
    warn('audioClipId', 'تسجيل صوتي على سؤال ليس من قسم الاستماع');
  }
  if (q.section === 'reading' && !q.passageId && !q.imageUrl) {
    warn('passageId', 'سؤال قراءة بلا قطعة ولا صورة — تأكد أنه مقصود');
  }

  // An image with no description is unanswerable for screen-reader users.
  if (q.imageUrl && !q.imageAlt?.trim()) {
    err('imageAlt', 'الصورة تحتاج وصفًا نصيًا (يُقرأ لذوي الإعاقة البصرية)');
  }

  // --- explanation ---
  if (!q.explanationAr?.trim()) {
    warn('explanationAr', 'لا يوجد شرح — سيظهر السؤال بلا تفسير بعد الاختبار');
  }

  // Publishing without a key or a skill is the failure this whole
  // workflow exists to prevent.
  if (q.status === 'published') {
    if (!q.correctOption) err('status', 'لا يمكن نشر سؤال بلا إجابة صحيحة');
    if (!q.skillId) err('status', 'لا يمكن نشر سؤال بلا مهارة');
  }

  const errors = issues.filter((i) => i.severity === 'error');
  return {
    issues,
    errors,
    warnings: issues.filter((i) => i.severity === 'warning'),
    canSave: errors.length === 0,
  };
}

/** Group issues by field, for rendering inline next to each input. */
export function issuesByField(result: ValidationResult): Record<string, Issue[]> {
  const out: Record<string, Issue[]> = {};
  for (const i of result.issues) (out[i.field] ??= []).push(i);
  return out;
}

/**
 * Normalise text for storage.
 *
 * Newlines are CONTENT — sentence-ordering and error-detection items
 * depend on line structure — so they are preserved exactly. Only
 * trailing whitespace per line and the surrounding blank space are
 * trimmed, and CRLF is folded to LF so Windows and Mac authors produce
 * identical rows.
 */
export function normalizeAuthoredText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}
