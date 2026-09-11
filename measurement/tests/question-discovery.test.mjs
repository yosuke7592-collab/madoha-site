import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateQuestionDiscovery, normalizeDiscoveryInput, qaGeneratedQuestions, recommendQuestionMix } from '../question-discovery.mjs';
import { validateQuestionSet } from '../../worker/question-review.mjs';

const load = async name => JSON.parse(await readFile(new URL(`../../data/fixtures/question-discovery/${name}.json`, import.meta.url), 'utf8'));
const kyoudo = await load('kyoudo');
const tax = await load('minato-tax');

test('normalizes every Question Discovery input group without inventing evidence', () => {
  const input = normalizeDiscoveryInput(kyoudo);
  assert.equal(input.entity.name, '株式会社協同住宅'); assert.equal(input.entity.main_services.length, 6);
  assert.equal(input.entity.faq.length, 2); assert.equal(input.entity.headings.length, 3); assert.equal(input.source_signals.length, 6); assert.equal(input.related_search_signals.length, 3);
});

test('recommends a dynamic 7:3 mix and a customer-readable reason for Kyoudo', () => {
  const mix = recommendQuestionMix(kyoudo);
  assert.deepEqual([mix.discovery_count, mix.brand_count], [7, 3]); assert.match(mix.reason, /浦安・市川/); assert.doesNotMatch(mix.reason, /スコア|heuristic/i);
});

test('generates ten traceable Kyoudo questions with purpose, reason and alternatives', () => {
  const result = generateQuestionDiscovery(kyoudo);
  assert.equal(result.questions.length, 10); assert.equal(new Set(result.questions.map(item => item.question_text)).size, 10);
  assert.equal(result.questions.filter(item => item.kind === 'nonbrand').length, 7);
  assert.ok(result.questions.every(item => item.measurement_purpose.length > 20 && item.selection_reason.length > 20));
  assert.ok(result.questions.every(item => item.alternatives.length >= 2 && item.discovery_evidence.length >= 1));
  assert.ok(result.questions.every(item => item.generation_source === 'rule_based_v1' && item.generation_rule));
  for (const service of kyoudo.entity.main_services) assert.ok(result.questions.some(item => item.intent === service), `${service}がありません`);
});

test('generated questions pass the existing review screen contract unchanged', () => {
  const result = generateQuestionDiscovery(kyoudo);
  const qa = validateQuestionSet(result.questions.map(item => ({ id:item.id, question_text:item.question_text, kind:item.kind })), { name: result.entity.name, category: result.entity.industry });
  assert.equal(qa.errors.length, 0); assert.deepEqual(qa.mix, { nonbrand: 7, branded: 3 });
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
  assert.deepEqual([result.mix.discovery_count,result.mix.brand_count],[4,6]);
  assert.ok(result.questions.some(item=>item.question_text.includes('相続税申告'))); assert.ok(result.questions.every(item=>item.measurement_purpose));
  assert.ok(result.questions.filter(item=>item.kind==='branded').every(item=>item.question_text.includes('みなと相続税理士事務所')));
});

test('generated records remain editable, classifiable and confirmable by schema', () => {
  const questions=generateQuestionDiscovery(kyoudo).questions; const edited=structuredClone(questions);
  edited[0].question_text=edited[0].alternatives[0]; edited[0].kind='branded';
  const qa=validateQuestionSet(edited,{name:'株式会社協同住宅'});
  assert.equal(qa.errors.length,0); assert.ok(qa.warnings.some(item=>item.code.endsWith(':branded_missing_company')));
});
