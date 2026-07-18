import { readFileSync } from 'node:fs';
import { runPipeline } from '../src/lib/ingestion/pipeline';
import { repairMojibake } from '../src/lib/ingestion/normalize';

// 1. Mojibake unit check — Latin-1 form and CP1252 form of U+2019.
const latin1Form = 'Fatherâs';
const cp1252Form = 'Fatherâ€™s';
console.log('latin1 form :', JSON.stringify(repairMojibake(latin1Form)));
console.log('cp1252 form :', JSON.stringify(repairMojibake(cp1252Form)));
// 2. Must NOT damage already-correct text.
console.log('clean arabic:', JSON.stringify(repairMojibake('السؤال الأول ما هو').text));
console.log('clean ellips:', JSON.stringify(repairMojibake('visit is…').text));

// 3. End-to-end on the real corpus.
const r = runPipeline(readFileSync('gramer_bank.txt', 'utf8'));
const q = r.questions.find((x) => x.questionText.includes('house in Dammam'));
console.log('\nparsed Q    :', JSON.stringify(q?.questionText));
console.log('parsed opts :', JSON.stringify(q?.options));
