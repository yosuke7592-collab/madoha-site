import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { assessPaidReliability, enrichPaidMeasurementReliability, identityNameKey, normalizePaidEntityMentions } from '../reliability.mjs';
import { measurementsToPaidReport } from '../paid-pipeline.mjs';

const entity = { id: 'kyoudo', name: '株式会社協同住宅', aliases: ['協同住宅'], official_url: 'https://www.kyoudo.jp/', area: '千葉県浦安市', category: '不動産・建築' };
const registry = [{ id: 'kyoudo', canonicalName: entity.name, displayName: entity.name, aliases: entity.aliases, officialDomains: ['kyoudo.jp'] }];

test('corporate forms and branch suffixes normalize while raw spellings remain available', () => {
  assert.equal(identityNameKey('株式会社明和地所'), identityNameKey('明和地所'));
  const rows = normalizePaidEntityMentions([
    { name: '明和地所', raw_name: '明和地所', target: false },
    { name: '株式会社明和地所 浦安店', raw_name: '株式会社明和地所 浦安店', target: false },
  ]);
  assert.equal(rows.length, 1); assert.deepEqual(rows[0].raw_names, ['明和地所', '株式会社明和地所 浦安店']);
});

test('duplicate target spelling merges even when one extraction initially lacks the target flag', () => {
  const rows = normalizePaidEntityMentions([
    { name: '税理士法人チェスター', raw_name: '税理士法人チェスター', target: true },
    { name: '税理士法人チェスター', raw_name: '[税理士法人チェスター]', target: false },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target, true);
});

test('known domain, region or entity id conflicts prevent accidental company merging', () => {
  const rows = normalizePaidEntityMentions([
    { entity_id: 'a', name: '株式会社同名商事', target: false, official_domains: ['a.example'], region: '東京' },
    { entity_id: 'b', name: '同名商事', target: false, official_domains: ['b.example'], region: '大阪' },
  ]);
  assert.equal(rows.length, 2);
});

test('a branded answer mixing a similar but distinct legal entity gets one restrained warning', () => {
  const reliability = assessPaidReliability({ answer: '株式会社協同住宅と協同住宅ローン株式会社を説明します。', entity,
    mentionedEntities: [{ name: entity.name, target: true }, { name: '協同住宅ローン株式会社', target: false }], questionKind: 'branded', channel: 'gemini' });
  assert.equal(reliability.status, 'review'); assert.deepEqual(reliability.warnings.map(item => item.code), ['similar_entity_mixture']);
});

test('ordinary competitor names do not trigger a similar-entity warning', () => {
  const reliability = assessPaidReliability({ answer: '株式会社協同住宅と明和地所を比較します。', entity,
    mentionedEntities: [{ name: entity.name, target: true }, { name: '明和地所', target: false }], questionKind: 'branded', channel: 'gemini' });
  assert.equal(reliability.status, 'clear'); assert.equal(reliability.warnings.length, 0);
});

test('headings and product labels containing the target name are not treated as similarly named companies', () => {
  const chester = { name: '税理士法人チェスター', aliases: ['チェスター'] };
  const chesterResult = assessPaidReliability({
    answer: '### 税理士法人チェスターの「信頼性」が高い理由', entity: chester,
    mentionedEntities: [{ name: '税理士法人チェスターの「信頼性」が高い理由', target: false }], questionKind: 'branded', channel: 'gemini'
  });
  assert.equal(chesterResult.warnings.length, 0);
  const kintone = { name: 'kintone', aliases: ['キントーン', 'Kintone'] };
  const kintoneResult = assessPaidReliability({
    answer: '### kintoneが向いている代表的な業務', entity: kintone,
    mentionedEntities: [{ name: 'kintoneが向いている代表的な業務', target: false }, { name: 'サイボウズ kintone', target: false }], questionKind: 'branded', channel: 'gemini'
  });
  assert.equal(kintoneResult.warnings.length, 0);
});

test('a similar legal entity is detected from prose but an explicit separation avoids an unnecessary warning', () => {
  const mixed = assessPaidReliability({ answer: '協同住宅ローン株式会社の情報も紹介します。', entity, mentionedEntities: [], questionKind: 'branded', channel: 'gemini' });
  assert.deepEqual(mixed.warnings.map(item => item.code), ['similar_entity_mixture']);
  const separated = assessPaidReliability({ answer: '協同住宅ローン株式会社がありますが、これらは異なる会社です。', entity, mentionedEntities: [], questionKind: 'branded', channel: 'gemini' });
  assert.equal(separated.warnings.length, 0);
});

test('dense Google Maps and local-store output is identified without changing the raw answer', () => {
  const answer = '店舗 4.8 (175)\n営業時間外\n電話[経路](https://google.com/maps/dir/)\n不動産仲介業';
  const row = enrichPaidMeasurementReliability({ raw_answer: answer, channel: 'google_ai_mode', mentioned_entities: [], target_present: false }, entity, registry, 'nonbrand');
  assert.equal(row.raw_answer, answer); assert.equal(row.reliability.local_information_present, true);
  assert.deepEqual(row.reliability.warnings.map(item => item.code), ['local_result_noise']);
});

test('report preserves AI text, exposes warnings to Web/PDF, and keeps normalized counts', () => {
  const measurement = enrichPaidMeasurementReliability({ question_id: 'q1', channel: 'gemini', raw_answer: '株式会社協同住宅と協同住宅ローン株式会社を説明します。',
    mentioned_entities: [{ name: entity.name, raw_name: entity.name, target: true }, { name: '協同住宅ローン株式会社', raw_name: '協同住宅ローン株式会社', target: false }], recommendation: false, explicit_rank: null, sources: [], error: null }, entity, registry, 'branded');
  const report = measurementsToPaidReport({ subject: entity, queries: [{ id: 'q1', kind: 'branded', channels: [] }] }, [measurement]);
  assert.equal(report.queries[0].channels[1].answer, measurement.raw_answer);
  assert.equal(report.queries[0].channels[1].competitors[0], '協同住宅ローン株式会社');
  assert.equal(report.queries[0].channels[1].reliability.warnings[0].code, 'similar_entity_mixture');
  assert.match(report.reliabilityNotice, /AIの回答には誤りや他社情報の混同/u);
});

test('Web and PDF templates render reliability notices without replacing the AI response', () => {
  const web = fs.readFileSync(new URL('../../sample-kyoudo.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../../sample-kyoudo.css', import.meta.url), 'utf8');
  const pdf = fs.readFileSync(new URL('../../scripts/generate_paid_sample_pdf.py', import.meta.url), 'utf8');
  assert.match(web, /MADOHAによる注意/u); assert.match(web, /local_information_present/u); assert.match(css, /reliability-notice/u);
  assert.match(pdf, /row\.get\('reliability'\)/u); assert.match(pdf, /MADOHAによる注意/u);
});
