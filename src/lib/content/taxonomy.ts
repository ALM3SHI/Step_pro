/**
 * Content taxonomy — the vocabulary the whole platform agrees on.
 *
 * Sections, skills, and difficulty live here as DATA, not as strings
 * scattered through components. Analytics, the exam builder, the admin
 * editor, and the future AI services all read from this one registry, so
 * adding a skill is a one-line change rather than a hunt.
 *
 * The skill list is inherited from the legacy prototype, where all 1,135
 * questions were already hand-tagged. That tagging is the most valuable
 * thing in the old build and is what makes per-skill weakness analysis
 * possible on day one.
 */

export const SECTIONS = ['reading', 'grammar', 'listening', 'writing'] as const;
export type SectionId = (typeof SECTIONS)[number];

export interface SectionDef {
  id: SectionId;
  nameAr: string;
  nameEn: string;
  /** Official STEP weighting. Must total 100 across all sections. */
  weightPct: number;
  /** Listening is forward-only: no back navigation, no review grid. */
  allowsBack: boolean;
  allowsReview: boolean;
  displayOrder: number;
}

export const SECTION_DEFS: Record<SectionId, SectionDef> = {
  reading: {
    id: 'reading', nameAr: 'استيعاب المقروء', nameEn: 'Reading Comprehension',
    weightPct: 40, allowsBack: true, allowsReview: true, displayOrder: 1,
  },
  grammar: {
    id: 'grammar', nameAr: 'التراكيب النحوية', nameEn: 'Grammar & Structure',
    weightPct: 30, allowsBack: true, allowsReview: true, displayOrder: 2,
  },
  listening: {
    id: 'listening', nameAr: 'استيعاب المسموع', nameEn: 'Listening Comprehension',
    weightPct: 20, allowsBack: false, allowsReview: false, displayOrder: 3,
  },
  writing: {
    id: 'writing', nameAr: 'التحليل الكتابي', nameEn: 'Writing Analysis',
    weightPct: 10, allowsBack: true, allowsReview: true, displayOrder: 4,
  },
};

export const SECTION_LIST: SectionDef[] = SECTIONS.map((s) => SECTION_DEFS[s]).sort(
  (a, b) => a.displayOrder - b.displayOrder,
);

// ---------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------

export interface SkillDef {
  id: string;
  section: SectionId;
  nameAr: string;
  nameEn: string;
  /** Shown in the study plan as the thing to go learn. */
  studyHintAr?: string;
}

/**
 * 27 skills, migrated from the legacy taxonomy with the legacy ids
 * preserved.
 *
 * The ids are kept verbatim (`tenses`, `svagree`, `lmain`…) so the 1,135
 * already-tagged questions import without a remapping step — a remap is
 * a silent-corruption risk for zero benefit.
 */
export const SKILL_DEFS: SkillDef[] = [
  // --- grammar ---
  { id: 'tenses',       section: 'grammar', nameAr: 'الأزمنة',                 nameEn: 'Tenses' },
  { id: 'svagree',      section: 'grammar', nameAr: 'توافق الفعل مع الفاعل',   nameEn: 'Subject-Verb Agreement' },
  { id: 'preps',        section: 'grammar', nameAr: 'حروف الجر',               nameEn: 'Prepositions' },
  { id: 'pronouns',     section: 'grammar', nameAr: 'الضمائر',                 nameEn: 'Pronouns' },
  { id: 'quantifiers',  section: 'grammar', nameAr: 'المحددات والكميات',       nameEn: 'Quantifiers' },
  { id: 'articles',     section: 'grammar', nameAr: 'أدوات التعريف',           nameEn: 'Articles' },
  { id: 'conditionals', section: 'grammar', nameAr: 'الجمل الشرطية',           nameEn: 'Conditionals' },
  { id: 'passive',      section: 'grammar', nameAr: 'المبني للمجهول',          nameEn: 'Passive Voice' },
  { id: 'relative',     section: 'grammar', nameAr: 'ضمائر الوصل',             nameEn: 'Relative Clauses' },
  { id: 'compare',      section: 'grammar', nameAr: 'المقارنة والتفضيل',       nameEn: 'Comparatives' },
  { id: 'modals',       section: 'grammar', nameAr: 'الأفعال الناقصة',         nameEn: 'Modals' },
  { id: 'gerund',       section: 'grammar', nameAr: 'المصدر والاسم الفعلي',    nameEn: 'Gerunds & Infinitives' },
  { id: 'conj',         section: 'grammar', nameAr: 'أدوات الربط',             nameEn: 'Conjunctions' },
  { id: 'wordform',     section: 'grammar', nameAr: 'اشتقاق الكلمات',          nameEn: 'Word Forms' },

  // --- reading ---
  { id: 'main',   section: 'reading', nameAr: 'الفكرة الرئيسية',        nameEn: 'Main Idea' },
  { id: 'detail', section: 'reading', nameAr: 'الأسئلة التفصيلية',      nameEn: 'Supporting Detail' },
  { id: 'infer',  section: 'reading', nameAr: 'الاستنتاج',              nameEn: 'Inference' },
  { id: 'vocab',  section: 'reading', nameAr: 'معنى الكلمة من السياق',  nameEn: 'Vocabulary in Context' },
  { id: 'ref',    section: 'reading', nameAr: 'مرجع الضمير',            nameEn: 'Pronoun Reference' },

  // --- listening ---
  { id: 'lmain',   section: 'listening', nameAr: 'المسموع: الفكرة العامة', nameEn: 'Listening: Gist' },
  { id: 'ldetail', section: 'listening', nameAr: 'المسموع: التفاصيل',      nameEn: 'Listening: Detail' },
  { id: 'linfer',  section: 'listening', nameAr: 'المسموع: الاستنتاج',     nameEn: 'Listening: Inference' },

  // --- writing ---
  { id: 'error',     section: 'writing', nameAr: 'اكتشاف الخطأ',         nameEn: 'Error Identification' },
  { id: 'wordorder', section: 'writing', nameAr: 'ترتيب الكلمات',        nameEn: 'Word Order' },
  { id: 'order',     section: 'writing', nameAr: 'ترتيب الفقرة',         nameEn: 'Sentence Ordering' },
  { id: 'punct',     section: 'writing', nameAr: 'علامات الترقيم',       nameEn: 'Punctuation & Capitalization' },
  { id: 'best',      section: 'writing', nameAr: 'اختيار أفضل صياغة',    nameEn: 'Best Construction' },
];

export const SKILL_BY_ID: Record<string, SkillDef> = Object.fromEntries(
  SKILL_DEFS.map((s) => [s.id, s]),
);

export const SKILLS_BY_SECTION: Record<SectionId, SkillDef[]> = SECTIONS.reduce(
  (acc, sec) => {
    acc[sec] = SKILL_DEFS.filter((s) => s.section === sec);
    return acc;
  },
  {} as Record<SectionId, SkillDef[]>,
);

// ---------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * Difficulty is NOT present in the legacy data — every question imports
 * as `medium`. It is a real field rather than a guess dressed up as one:
 * once attempts accumulate, observed p-values (share answering
 * correctly) replace the default, which is the only honest source for it.
 */
export const DEFAULT_DIFFICULTY: Difficulty = 'medium';

/** Convert an observed correct-rate into a difficulty band. */
export function difficultyFromPValue(correctRate: number): Difficulty {
  if (correctRate >= 0.75) return 'easy';
  if (correctRate >= 0.45) return 'medium';
  return 'hard';
}

// ---------------------------------------------------------------------
// Integrity
// ---------------------------------------------------------------------

/** Weights must total 100 or every weighted score is meaningless. */
export function assertWeightsValid(): void {
  const total = SECTION_LIST.reduce((n, s) => n + s.weightPct, 0);
  if (total !== 100) {
    throw new Error(`Section weights total ${total}, expected 100`);
  }
}
