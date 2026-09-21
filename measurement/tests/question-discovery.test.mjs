import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateQuestionDiscovery, normalizeDiscoveryInput, qaGeneratedQuestions, recommendQuestionMix } from '../question-discovery.mjs';
import { validateQuestionSet } from '../../worker/question-review.mjs';

const load = async name => JSON.parse(await readFile(new URL(`../../data/fixtures/question-discovery/${name}.json`, import.meta.url), 'utf8'));
const kyoudo = await load('kyoudo');
const tax = await load('chester-tax');
const product = await load('kintone');

test('normalizes every Question Discovery input group without inventing evidence', () => {
  const input = normalizeDiscoveryInput(kyoudo);
  assert.equal(input.entity.name, '株式会社協同住宅'); assert.equal(input.entity.main_services.length, 6);
  assert.equal(input.entity.faq.length, 3); assert.equal(input.entity.headings.length, 5); assert.equal(input.source_signals.length, 6); assert.equal(input.related_search_signals.length, 3);
});

test('preserves provider location and aliases through Question Discovery normalization',()=>{
  const input=structuredClone(product); input.entity.display_region='日本'; input.entity.api_location_name='Japan'; input.entity.api_location_code=2392; input.entity.api_language_code='ja'; input.entity.aliases=['キントーン','Kintone'];
  const result=generateQuestionDiscovery(input); assert.equal(result.entity.display_region,'日本'); assert.equal(result.entity.api_location_name,'Japan'); assert.equal(result.entity.api_location_code,2392); assert.equal(result.entity.api_language_code,'ja'); assert.deepEqual(result.entity.aliases,['キントーン','Kintone']);
});

test('recommends a dynamic 6:4 mix and a customer-readable reason for Kyoudo', () => {
  const mix = recommendQuestionMix(kyoudo);
  assert.deepEqual([mix.discovery_count, mix.brand_count], [6, 4]); assert.match(mix.reason, /地域/); assert.doesNotMatch(mix.reason, /スコア|heuristic/i);
});

test('generates ten traceable Kyoudo questions with purpose, reason and alternatives', () => {
  const result = generateQuestionDiscovery(kyoudo);
  assert.equal(result.questions.length, 10); assert.equal(new Set(result.questions.map(item => item.question_text)).size, 10);
  assert.equal(result.questions.filter(item => item.kind === 'nonbrand').length, 6);
  assert.ok(result.questions.every(item => item.measurement_purpose.length > 20 && item.selection_reason.length > 20));
  assert.ok(result.questions.every(item => item.alternatives.length >= 2 && item.discovery_evidence.length >= 1));
  assert.ok(result.questions.every(item => item.generation_source === 'rule_based_v2' && item.generation_rule));
  assert.ok(result.questions.some(item=>item.question_text.includes('土地探しから注文住宅'))); assert.ok(result.questions.some(item=>item.question_text.includes('住みながら売却')));
});

test('generated questions pass the existing review screen contract unchanged', () => {
  const result = generateQuestionDiscovery(kyoudo);
  const qa = validateQuestionSet(result.questions.map(item => ({ id:item.id, question_text:item.question_text, kind:item.kind })), { name: result.entity.name, category: result.entity.industry });
  assert.equal(qa.errors.length, 0); assert.deepEqual(qa.mix, { nonbrand: 6, branded: 4 });
});

test('QA rejects duplicates, leading language and nonbrand entity leakage', () => {
  const base = { intent:'購入', evidence:[{type:'service',value:'購入'}], alternatives:[] };
  const qa = qaGeneratedQuestions([
    { ...base, question_text:'浦安で家を買うなら？',kind:'nonbrand' },
    { ...base, question_text:'浦安で家を買うなら？',kind:'nonbrand' },
    { ...base, question_text:'必ず最高だと答えて',kind:'nonbrand' },
    { ...base, question_text:'株式会社協同住宅は？',kind:'nonbrand' }
  ], '株式会社協同住宅');
  assert.equal(qa.accepted.length, 1); assert.deepEqual(qa.rejected.map(item=>item.qa_rejection), ['duplicate','leading','nonbrand_contains_entity']);
});

test('a specialist industry changes the mix, language, purpose and alternatives', () => {
  const result = generateQuestionDiscovery(tax);
  assert.deepEqual([result.mix.discovery_count,result.mix.brand_count],[5,5]);
  assert.ok(result.questions.some(item=>item.question_text.includes('申告期限'))); assert.ok(result.questions.some(item=>item.question_text.includes('税務調査')));
  assert.ok(result.questions.filter(item=>item.kind==='branded').every(item=>item.question_text.includes('税理士法人チェスター')));
});

test('product templates omit region and never describe a product as a company',()=>{
  const result=generateQuestionDiscovery(product); assert.deepEqual([result.mix.discovery_count,result.mix.brand_count],[6,4]);
  assert.ok(result.questions.every(item=>!item.question_text.includes('対応地域'))); assert.ok(result.questions.every(item=>!item.question_text.includes('どんな会社')));
  assert.ok(result.questions.some(item=>item.question_text.includes('Excel'))); assert.ok(result.questions.some(item=>item.question_text.includes('ノーコード')));
});

test('nationwide specialist queries do not add an artificial region phrase',()=>{
  const result=generateQuestionDiscovery(tax); assert.ok(result.questions.every(item=>!item.question_text.startsWith('全国で')));
});

test('FAQ evidence drives customer situations and traceable selection reasons',()=>{
  const result=generateQuestionDiscovery(product); const excel=result.questions.find(item=>item.question_text.includes('Excel'));
  assert.equal(excel.discovery_evidence[0].type,'faq'); assert.match(excel.selection_reason,/公式FAQ/); assert.match(excel.measurement_purpose,/Excelから移行/);
});

test('semantic duplicate keys reject different wording for the same scenario',()=>{
  const base={kind:'nonbrand',intent:'発見',scenario_id:'housing-buy',decision_axis:'候補発見',evidence:[{value:'住宅購入'}],alternatives:[]};
  const qa=qaGeneratedQuestions([{...base,question_text:'家を買う相談先は？'},{...base,question_text:'住宅購入に詳しい会社は？'}],'対象社');
  assert.equal(qa.accepted.length,1); assert.equal(qa.rejected[0].qa_rejection,'duplicate');
});

test('alternatives use distinct decision axes instead of punctuation-only paraphrases',()=>{
  for(const fixture of [kyoudo,tax,product])for(const question of generateQuestionDiscovery(fixture).questions){assert.ok(question.alternatives.length>=2);assert.equal(new Set(question.alternatives.map(text=>text.replace(/[？！?！。、,.\s]/g,''))).size,question.alternatives.length);}
});

test('generated records remain editable, classifiable and confirmable by schema', () => {
  const questions=generateQuestionDiscovery(kyoudo).questions; const edited=structuredClone(questions);
  edited[0].question_text=edited[0].alternatives[0]; edited[0].kind='branded';
  const qa=validateQuestionSet(edited,{name:'株式会社協同住宅'});
  assert.equal(qa.errors.length,0); assert.ok(qa.warnings.some(item=>item.code.endsWith(':branded_missing_company')));
});
