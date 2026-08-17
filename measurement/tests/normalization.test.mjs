import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPANY_REGISTRY, MARKET, SUBJECT } from '../data.mjs';
import { extractCompanies } from '../extraction.mjs';
import { classifySource, SOURCE_CLASSIFICATION_VERSION } from '../source.mjs';
import { aggregateResultData } from '../aggregate.mjs';
import { execute } from '../run.mjs';
import { classificationSummary, companyNormalizationSummary, reprocessRecords } from '../reprocess.mjs';

test('registry aliases merge supported variants and avoid ambiguous names', () => {
  const extracted = extractCompanies(
    '候補は世田谷ホーム株式会社、株式会社塗装職人、アオキ塗装です。',
    COMPANY_REGISTRY, [], { includeCitationOnly: false }
  );
  assert.equal(extracted.find(item => item.rawName === '世田谷ホーム株式会社').normalizedCompanyId, SUBJECT.id);
  assert.equal(extracted.find(item => item.rawName === '株式会社塗装職人').normalizedCompanyId, 'company-tosou-shokunin-tokyo');
  assert.equal(extracted.find(item => item.rawName === 'アオキ塗装').normalizedCompanyId, 'company-aoki-tosou');
  assert.equal(extractCompanies('青木工務店です', COMPANY_REGISTRY, [], { includeCitationOnly: false }).length, 0);
  assert.equal(COMPANY_REGISTRY.some(company => ['ミツモア', '外壁塗装の窓口', 'タウンライフ外壁塗装', '外壁塗装パートナーズ', 'ぬりマッチ'].includes(company.canonicalName)), false);
});

test('source classifier v0.2 covers official, comparison, review, social decision and unknown', () => {
  assert.equal(SOURCE_CLASSIFICATION_VERSION, '0.2');
  assert.equal(classifySource('https://www.setagayahome.co.jp/case', COMPANY_REGISTRY).sourceType, 'official');
  assert.equal(classifySource('https://nuri-kae.jp/area/x', COMPANY_REGISTRY).sourceType, 'comparison');
  assert.equal(classifySource('https://yanery.com/review', COMPANY_REGISTRY).sourceType, 'reviews');
  assert.equal(classifySource('https://instagram.com/example', COMPANY_REGISTRY).sourceType, 'sns');
  assert.equal(classifySource('https://note.com/example', COMPANY_REGISTRY).sourceType, 'other');
  assert.equal(classifySource('https://unknown.example/a', COMPANY_REGISTRY).sourceType, 'other');
});

test('normalization reprocesses records, competitors and source counts without treating comparison services as companies', async () => {
  const fixture = await execute(['--fixture'], { writeOutput: false, now: '2026-08-18T00:00:00.000Z' });
  const records = structuredClone(fixture.records.slice(0, 2));
  records[0].answerText = 'おすすめの候補です。\n- 世田谷ホーム株式会社\n- 花まるリフォーム\n- 外壁堂\n比較にはミツモアも使えます。';
  records[0].citations = [
    { url: 'https://setagayahome.co.jp/case', canonicalUrl: '', domain: '', title: '世田谷ホーム株式会社 施工事例', sourceType: 'other' },
    { url: 'https://nuri-kae.jp/area/setagaya', canonicalUrl: '', domain: '', title: '世田谷区の業者比較', sourceType: 'other' },
    { url: 'https://gaihekidou.com/', canonicalUrl: '', domain: '', title: '外壁堂', sourceType: 'other' }
  ];
  records[1].answerText = '候補として花まるリフォームがあります。';
  records[1].citations = [{ url: 'https://archives.hanamaru-r.jp/a', canonicalUrl: '', domain: '', title: '花まるリフォーム', sourceType: 'other' }];
  const normalized = reprocessRecords(records);
  const result = aggregateResultData(normalized, MARKET, SUBJECT, COMPANY_REGISTRY);
  const companies = companyNormalizationSummary(normalized);
  const sources = classificationSummary(normalized);
  assert.equal(result.dataset.sourceClassificationVersion, '0.2');
  assert.equal(result.competitors.some(item => item.id === SUBJECT.id), false);
  assert.equal(result.competitors.length, 2);
  assert.equal(result.competitors.find(item => item.id === 'company-hanamaru-reform').appearances, 2);
  assert.equal(companies.some(item => item.displayName === 'ミツモア'), false);
  assert.deepEqual(sources.counts, { official: 3, comparison: 1, reviews: 0, industry_media: 0, sns: 0, google: 0, other: 0 });
});
