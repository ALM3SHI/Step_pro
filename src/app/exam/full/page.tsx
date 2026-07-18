'use client';

/**
 * Full exam engine demo, driven by a fixture pool that covers all four
 * sections plus an analytical chart item. Used to verify the state
 * machine end to end in a real browser.
 */

import { ExamWorkspace } from '@/components/exam/ExamWorkspace';
import type { ExamQuestion } from '@/lib/exam/types';

const PASSAGE_1 = `In the year 2000, people spent $3.2 trillion dollars on travel. In 2005, they spent $3.4 trillion. In 2016, they will probably spend about $4.2 trillion.

France is the most popular destination: 62.4 million people went to France in 2006. The United States is second with 46.3 million visitors, and Spain third with 41.3 million.`;

// A tiny inline SVG chart, so the image path is exercised without any
// external asset or network dependency.
const CHART = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="420" height="240" viewBox="0 0 420 240">
  <rect width="420" height="240" fill="#fff"/>
  <text x="210" y="24" text-anchor="middle" font-family="Georgia" font-size="15" font-weight="700" fill="#1C2733">Freshwater per capita (m³/year)</text>
  <g fill="#01589b">
    <rect x="70"  y="90"  width="60" height="110"/>
    <rect x="180" y="130" width="60" height="70"/>
    <rect x="290" y="60"  width="60" height="140"/>
  </g>
  <g font-family="Georgia" font-size="13" fill="#333F4B" text-anchor="middle">
    <text x="100" y="218">Morocco</text><text x="210" y="218">Syria</text><text x="320" y="218">Egypt</text>
    <text x="100" y="84">610</text><text x="210" y="124">390</text><text x="320" y="54">780</text>
  </g>
  <line x1="55" y1="200" x2="380" y2="200" stroke="#C8D2DB" stroke-width="2"/>
</svg>`)}`;

const QUESTIONS: ExamQuestion[] = [
  // Reading — passage 1 (two questions, one screen, one part)
  { id: 'r1', section: 'reading', passageId: 'p1', passageText: PASSAGE_1,
    questionText: 'The third most popular country people visit is ____',
    options: { A: 'France', B: 'China', C: 'Italy', D: 'Spain' }, correctOption: 'D',
    explanationAr: 'يذكر النص الترتيب صراحةً: فرنسا الأولى، ثم الولايات المتحدة، ثم إسبانيا "Spain" بـ 41.3 مليون زائر. الخيار "Italy" ورد بعدها مباشرةً في النص، و"China" كانت السادسة — وكلاهما فخ لمن يقرأ الترتيب بسرعة.' },
  { id: 'r2', section: 'reading', passageId: 'p1', passageText: PASSAGE_1,
    questionText: 'How much did people spend on travel in 2005?',
    options: { A: '$3.2 trillion', B: '$4.2 trillion', C: '$3.4 trillion', D: '$2.4 trillion' }, correctOption: 'C',
    explanationAr: 'سؤال تفاصيل (scanning): النص ينص على "In 2005, they spent $3.4 trillion". الخيار "$3.2 trillion" يخص عام 2000، و"$4.2 trillion" توقّع لعام 2016 — أي أن كلا الرقمين موجود في النص لكن لسنة أخرى.' },

  // Reading — analytical chart item (second part)
  { id: 'r3', section: 'reading', passageId: 'p2', imageUrl: CHART,
    imageAlt: 'Bar chart of freshwater availability per capita: Morocco 610, Syria 390, Egypt 780 cubic metres per year.',
    passageText: 'The chart shows renewable freshwater available per person per year in three countries.',
    questionText: 'According to the chart, which country has the LEAST freshwater per capita?',
    options: { A: 'Morocco', B: 'Syria', C: 'Egypt', D: 'They are equal' }, correctOption: 'B',
    explanationAr: 'أقصر عمود في الرسم هو سوريا (390 م³)، لذا هي الأقل. المغرب 610 ومصر 780، وكلاهما أعلى. انتبه لكلمة LEAST المكتوبة بحروف كبيرة — فهي تطلب الأدنى لا الأعلى.' },
  { id: 'r4', section: 'reading', passageId: 'p2', imageUrl: CHART,
    imageAlt: 'Bar chart of freshwater availability per capita: Morocco 610, Syria 390, Egypt 780 cubic metres per year.',
    passageText: 'The chart shows renewable freshwater available per person per year in three countries.',
    questionText: 'Approximately how much more freshwater does Egypt have than Syria?',
    options: { A: '190 m³', B: '290 m³', C: '390 m³', D: '490 m³' }, correctOption: 'C',
    explanationAr: 'اطرح القيمتين مباشرةً من الرسم: 780 − 390 = 390 م³. الخطأ الشائع هنا هو التقدير البصري لفرق ارتفاع العمودين بدل قراءة الأرقام المكتوبة فوقهما.' },

  // Grammar — 6 singles, split into 3 parts of 2 screens (Back reachable)
  ...['He ____ to school every day.', 'She has lived here ____ 2015.',
      'I am a little busy. Come back after ____ minutes.', 'The food has been cooking ____ 30 minutes.',
      'Neither of the boys ____ finished.', 'If I ____ you, I would apply.'
     ].map((text, i) => ({
    id: `g${i + 1}`, section: 'grammar' as const, questionText: text,
    options: { A: 'go', B: 'goes', C: 'going', D: 'gone' },
    correctOption: 'B' as const,
    explanationAr: 'الفاعل مفرد غائب في المضارع البسيط، لذا يأخذ الفعل صيغة "goes" بإضافة s. الخيار "go" يُستخدم مع الجمع أو المتكلم، و"going" يحتاج فعلًا مساعدًا مثل is، و"gone" تصريف ثالث يحتاج have.',
  })),

  // Listening — two clips; the second carries two questions
  { id: 'l1', section: 'listening', audioId: 'a1', audioUrl: '/listening/1742938770.mp3',
    questionText: 'This conversation most likely takes place ____',
    options: { A: 'In a grocery store', B: 'In a restaurant', C: 'In a house', D: 'On a train' }, correctOption: 'B' },
  { id: 'l2', section: 'listening', audioId: 'a2', audioUrl: '/listening/1742938790.mp3',
    questionText: 'Most of the participants at a picnic are ____',
    options: { A: 'Drivers', B: 'Students', C: 'Friends', D: 'Families' }, correctOption: 'D' },
  { id: 'l3', section: 'listening', audioId: 'a2', audioUrl: '/listening/1742938790.mp3',
    questionText: 'Who is the caller talking to?',
    options: { A: 'A tourism guide', B: 'A sales manager', C: 'A travel attendant', D: 'A travel agent' }, correctOption: 'D' },

  // Writing — 3 singles, one part
  { id: 'w1', section: 'writing',
    questionText: 'In which sentence is all PUNCTUATION correct?',
    options: {
      A: "After all the motor cycle's are sold, whos going to get the bonus?",
      B: 'After all the motorcycles are sold, who is going to get the bonus?',
      C: "After all, the motorcycles' are sold, who's going to get the bonus?",
      D: 'After all the motorcycles are sold who is going to get the bonus',
    }, correctOption: 'B',
    explanationAr: 'الخيار B هو الصحيح: "motorcycles" جمع لا ملكية فلا تأخذ فاصلة عليا، و"who is" مكتوبة كاملة وصحيحة. الخيار A يضيف فاصلة عليا خاطئة في "cycle\'s" ويكتب "whos"، والخيار C يضع الفاصلة العليا بعد الجمع خطأً، والخيار D يحذف الترقيم كليًا.' },
  { id: 'w2', section: 'writing',
    questionText: 'In which sentence is all CAPITALIZATION correct?',
    options: {
      A: 'The girl and her mother arrived home early.',
      B: 'The Girl and her mother arrived home early.',
      C: 'The girl and her Mother arrived home early.',
      D: 'The Girl and her Mother arrived home early.',
    }, correctOption: 'A',
    explanationAr: 'القاعدة: الأسماء العامة مثل "girl" و"mother" تُكتب بحرف صغير ما لم تبدأ الجملة أو تكن اسم علم. لذا A هو الصحيح، وبقية الخيارات تُكبّر إحدى الكلمتين أو كلتيهما بلا مبرر نحوي.' },
  { id: 'w3', section: 'writing',
    questionText: 'Which of the underlined words is INCORRECT? I don\'t had enough money to buy a ticket.',
    options: { A: 'had', B: 'to buy', C: 'enough', D: 'money' }, correctOption: 'A',
    explanationAr: 'بعد الفعل المساعد "don\'t" يأتي التصريف الأول من الفعل: "have" وليس "had". لذا الكلمة الخاطئة هي "had". أما "to buy" و"enough" و"money" فكلها صحيحة في موضعها.' },
];

export default function FullExamPage() {
  return (
    <div className="mx-auto max-w-[1100px] p-4">
      <ExamWorkspace
        questions={QUESTIONS}
        totalMinutes={30}
        onSubmit={(payload) => console.log('submit', payload)}
      />
    </div>
  );
}
