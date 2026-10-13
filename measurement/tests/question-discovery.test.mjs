import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detectInputWarnings, generateQuestionDiscovery, normalizeDiscoveryInput, qaGeneratedQuestions, recommendQuestionMix } from '../question-discovery.mjs';
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

test('uses one diagnosis region string unchanged in all ten questions',()=>{
  const input=structuredClone(kyoudo);delete input.entity.region_conditions;input.entity.region_enabled=true;input.entity.diagnosis_region='港区・世田谷区・千代田区';
  const result=generateQuestionDiscovery(input),nonbrand=result.questions.filter(item=>item.kind==='nonbrand'),branded=result.questions.filter(item=>item.kind==='branded');
  assert.equal(result.entity.diagnosis_region,'港区・世田谷区・千代田区');
  assert.ok(result.questions.every(item=>item.question_text.includes('港区・世田谷区・千代田区')));
  assert.ok(result.questions.every(item=>item.discovery_evidence.find(evidence=>evidence.type==='user_region_condition')?.value==='港区・世田谷区・千代田区'));
  assert.ok(nonbrand.every(item=>item.question_text.startsWith('港区・世田谷区・千代田区で、')));
  assert.ok(branded.every(item=>item.question_text.startsWith('港区・世田谷区・千代田区の株式会社協同住宅')));
});

test('accepts a one-value legacy region array but rejects legacy multiple-region input',()=>{
  const compatible=generateQuestionDiscovery(kyoudo);assert.equal(compatible.entity.diagnosis_region,'浦安・市川');assert.ok(compatible.questions.every(item=>item.question_text.includes('浦安・市川')));
  const multiple=structuredClone(kyoudo);multiple.entity.region_conditions=['市川','浦安'];assert.throws(()=>generateQuestionDiscovery(multiple),/1つの入力欄/);
});

test('does not turn company location into a search region when region targeting is off',()=>{
  const input=structuredClone(kyoudo);input.entity.region='千葉県市川市';input.entity.region_enabled=false;input.entity.diagnosis_region='東京都';delete input.entity.region_conditions;
  const result=generateQuestionDiscovery(input);assert.equal(result.entity.company_location,'千葉県市川市');assert.equal(result.entity.region,'千葉県市川市');assert.equal(result.entity.diagnosis_region,'');
  assert.ok(result.questions.every(item=>!item.question_text.includes('千葉県市川市')));assert.equal(result.mix.inputs.local,false);
});

test('uses the confirmed diagnosis region instead of the company location or proposed service region',()=>{
  const input=structuredClone(kyoudo);input.entity.company_location='千葉県船橋市';input.entity.region='千葉県船橋市';input.entity.service_regions=['千葉県全域'];input.entity.region_enabled=true;input.entity.region_conditions=['千葉県全域'];input.entity.diagnosis_region='千葉・船橋';
  const result=generateQuestionDiscovery(input),regional=result.questions.filter(item=>item.question_text.startsWith('千葉・船橋で、'));
  assert.equal(result.entity.company_location,'千葉県船橋市');assert.equal(result.entity.diagnosis_region,'千葉・船橋');assert.equal('region_conditions' in result.entity,false);
  assert.equal(regional.length,6);assert.ok(result.questions.every(item=>item.question_text.includes('千葉・船橋')&&!item.question_text.includes('千葉県全域')&&!item.question_text.includes('千葉県船橋市')));
});

test('uses an online condition unchanged in all ten questions',()=>{
  const input=structuredClone(kyoudo);delete input.entity.region_conditions;input.entity.diagnosis_region='オンライン';
  const result=generateQuestionDiscovery(input);assert.ok(result.questions.every(item=>item.question_text.includes('オンライン')));
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
  assert.equal(excel.discovery_evidence[0].type,'faq'); assert.equal(excel.discovery_evidence[0].source_type,'official_site'); assert.match(excel.selection_reason,/公式サイト/); assert.match(excel.measurement_purpose,/Excelから移行/);
});

test('user-entered consultation context keeps its provenance and contributes at most two generalized questions',()=>{
  const input=structuredClone(kyoudo);input.entity.faq=['子育て中で内見時間を取りにくいのでオンラインで相談したい','平日の昼は仕事なので夜間に相談したい','予算の範囲で比較したい'];input.entity.faq_entries=input.entity.faq.map(value=>({value,source_type:'user_input'}));
  const result=generateQuestionDiscovery(input),userQuestions=result.questions.filter(item=>item.discovery_evidence[0]?.source_type==='user_input');
  assert.equal(userQuestions.length,2);assert.ok(userQuestions.some(item=>item.question_text.includes('住宅購入をオンラインで相談できる不動産会社')));assert.ok(userQuestions.some(item=>item.question_text.includes('都合のよい時間に住宅購入を相談できる不動産会社')));
  assert.ok(userQuestions.every(item=>!item.question_text.includes('子育て中で内見時間を取りにくい')));assert.ok(userQuestions.every(item=>item.selection_reason.includes('入力された相談場面')&&!item.selection_reason.includes('公式')));
});

test('empty consultation context falls back safely without inventing FAQ evidence',()=>{
  const input=structuredClone(kyoudo);input.entity.faq=[];input.entity.faq_entries=[];input.entity.headings=[];
  const result=generateQuestionDiscovery(input);assert.equal(result.questions.length,10);assert.ok(result.questions.every(item=>item.discovery_evidence.every(evidence=>evidence.type!=='faq')));
});

test('a verified single service expands into distinct customer decision axes without inventing services or prices',()=>{
  const input={entity:{name:'株式会社Example Logistics',entity_type:'company',official_url:'https://example.jp/',region_enabled:true,diagnosis_region:'千葉県全域',industry:'軽貨物運送・物流',main_services:['個人宅向け軽貨物宅配サービス'],faq:[],headings:['事業内容']}};
  const result=generateQuestionDiscovery(input),nonbrand=result.questions.filter(item=>item.kind==='nonbrand'),branded=result.questions.filter(item=>item.kind==='branded');
  assert.equal(nonbrand.length,6);assert.equal(branded.length,4);
  assert.equal(new Set(nonbrand.map(item=>item.decision_axis)).size,6);
  assert.ok(nonbrand.every(item=>item.source_signals.includes('個人宅向け軽貨物宅配サービス')));
  assert.ok(nonbrand.every(item=>!/(料金|価格|即日|法人向け|冷蔵|大型)/.test(item.question_text)));
  assert.ok(nonbrand.every(item=>!/(依頼内容に合う|対応内容を事前に確認|何を確認すべき)/.test(item.question_text)));
  assert.ok(nonbrand.some(item=>item.question_text.includes('おすすめ')));
  assert.ok(nonbrand.some(item=>item.question_text.includes('実績がある')));
  assert.ok(nonbrand.some(item=>item.question_text.includes('に強い会社')));
  assert.deepEqual(nonbrand.map(item=>item.discovery_evidence.find(evidence=>evidence.type==='user_region_condition')?.value),Array(6).fill('千葉県全域'));
  assert.ok(nonbrand.some(item=>item.intent==='発見'));assert.ok(nonbrand.some(item=>item.intent==='比較'));assert.ok(nonbrand.some(item=>item.intent==='推薦'));assert.ok(nonbrand.some(item=>item.intent==='信頼確認'));assert.ok(nonbrand.some(item=>item.intent==='専門性'));
});

test('industry and service mismatch warns only with high confidence and allows compound businesses',()=>{
  assert.deepEqual(detectInputWarnings({industry:'住宅・不動産',main_services:['住宅購入','注文住宅']}),[]);
  const mismatch=detectInputWarnings({industry:'相続税務',main_services:['住宅購入','注文住宅']});assert.equal(mismatch.length,1);assert.equal(mismatch[0].code,'input:industry_service_mismatch');
  assert.deepEqual(detectInputWarnings({industry:'住宅・不動産と相続税務',main_services:['住宅購入','相続税申告']}),[]);
  assert.deepEqual(detectInputWarnings({industry:'相続税務',main_services:['相続税申告','住宅売却サポート']}),[]);
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
