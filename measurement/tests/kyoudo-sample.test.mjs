import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sample = JSON.parse(await readFile(new URL('../../data/samples/kyoudo-housing-paid-diagnosis.json', import.meta.url), 'utf8'));
const directFileSource = await readFile(new URL('../../sample-kyoudo-data.js', import.meta.url), 'utf8');
const reportSource = await readFile(new URL('../../sample-kyoudo.js', import.meta.url), 'utf8');
const pdf = await readFile(new URL('../../output/pdf/madoha-kyoudo-paid-diagnosis-v1.pdf', import.meta.url));

test('Kyoudo paid sample is explicit fixture and covers purchase-value sections', () => {
  assert.equal(sample.sample, true);
  assert.match(sample.measurement.limitations, /実測値ではありません/);
  assert.deepEqual(
    ['overallRating', 'improvementPotential', 'opportunityLoss', 'competitorGap', 'keyPoint'].filter(key => !sample.executiveSummary[key]),
    [],
  );
  assert.equal(sample.subject.entity_type, 'company');
  assert.equal(sample.subject.identification_status, 'confirmed');
  assert.equal(sample.queries.length, 10);
  assert.equal(sample.queries.filter(item => item.kind === 'nonbrand').length, 6);
  assert.equal(sample.queries.filter(item => item.kind === 'branded').length, 4);
  assert.ok(sample.queries.every(item => item.query && item.intent && item.selection_reason && item.source_signals.length >= 3 && item.discoveryEvidence.length && item.qa.natural && item.qa.neutral && item.qa.relevant && item.qa.distinct && item.channels.length === 3 && item.sampleAnswer && /^https:\/\//.test(item.evidenceUrl) && item.gap));
  assert.ok(sample.competitors.length >= 3);
  assert.ok(sample.comparison.length >= 4 && sample.comparison.every(item => item.mentions && item.recommendations && item.confirmedDifference));
  assert.ok(sample.sources.length >= 5 && sample.sources.every(item => /^https:\/\//.test(item.url)));
  assert.ok(sample.issues.some(item => item.type === 'potential_misinformation'));
  assert.ok(sample.issues.every(item => /^https:\/\//.test(item.evidenceUrl) && item.checkedAt));
  assert.ok(sample.actions.length >= 5 && sample.actions.every(item => item.target && item.change && item.reason && item.expectedChange && item.verification));
  assert.ok(sample.facts.every(item => item.status === 'fact' && /^https:\/\//.test(item.source)));
  assert.ok(sample.baseline.id && sample.baseline.metrics.length >= 5 && sample.baseline.remeasurement && sample.baseline.fixedConditions.length >= 5 && sample.baseline.targets.length >= 5);
});

test('report starts with ten search results and keeps evaluation labels out of customer UI', () => {
  assert.doesNotMatch(reportSource, /診断サマリー/);
  assert.doesNotMatch(reportSource, /総合評価/);
  assert.doesNotMatch(reportSource, /最大の機会損失/);
  assert.doesNotMatch(reportSource, /class="tag/);
  assert.match(reportSource, /会社名を入れない検索/);
  assert.match(reportSource, /会社名を入れた検索/);
  assert.match(reportSource, /query-block/);
  assert.match(reportSource, /\['掲載',row\.appeared\?'あり':'なし'/);
  assert.match(reportSource, /'掲載なし'/);
  assert.match(reportSource, /番目に掲載/);
  assert.match(reportSource, /AIの順位付け/);
  assert.match(reportSource, /AI RESPONSE/);
  assert.match(reportSource, /掲載された企業/);
  assert.match(reportSource, /参照された情報/);
  assert.match(reportSource, /MADOHAの見解/);
  assert.match(reportSource, /ChatGPT/);
  assert.match(reportSource, /Gemini/);
  assert.match(reportSource, /Google AI Mode/);
  assert.match(reportSource, /改善する場合の選択肢/);
  assert.match(reportSource, /特定の表示・推薦結果を保証するものではありません/);
  assert.match(reportSource, /nonbrand\.length\*channelCount/);
  assert.match(reportSource, /branded\.length\*channelCount/);
  assert.match(reportSource, /index\+nonbrand\.length/);
  assert.match(reportSource, /hasWarning\?'注意あり':row\.answer\?'回答あり':'回答なし'/);
  assert.match(reportSource, /catalogSources=\[\.\.\.new Map/);
  assert.match(reportSource, /data\.subject\.category\|\|data\.subject\.industry/);
  assert.doesNotMatch(reportSource, /6 QUESTIONS \/ 18 RESULTS/);
  assert.doesNotMatch(reportSource, /非指名6問と指名4問/);
  assert.ok(pdf.length > 10_000);
});

test('final sample shows substantial answers and keeps analysis secondary', () => {
  const rows = sample.queries.flatMap(query => query.channels);
  assert.equal(rows.length, 30);
  assert.ok(rows.every(row => row.answer.length >= 75));
  assert.ok(rows.filter(row => row.comment).length <= 4);
  assert.ok(!JSON.stringify(sample.queries).match(/地域工務店|住宅メーカー|施工事例を公開する地域会社|売却実績を公開する地域会社/));
  assert.match(reportSource, /data\.actions\.slice\(0,3\)/);
  assert.match(reportSource, /sourceRole/);
  assert.match(reportSource, /host\(source\.url\)/);
  assert.match(reportSource, /subject-highlight/);
});

test('listing positions, recommendation ranks and source catalog stay consistent', () => {
  const nonbrandRows = sample.queries.filter(query => query.kind === 'nonbrand').flatMap(query => query.channels.map(row => ({ query, row })));
  const appeared = nonbrandRows.filter(({ row }) => row.appeared);
  assert.equal(appeared.length, 7);
  for (const { row } of appeared) {
    assert.ok(Number.isInteger(row.listedPosition));
    assert.ok(row.listedPosition >= 1 && row.listedPosition <= row.competitors.length + 1);
  }
  const ranked = nonbrandRows.filter(({ row }) => Number.isInteger(row.aiRank));
  assert.equal(ranked.length, 1);
  assert.ok(ranked.every(({ row }) => row.recommended));
  const knownHosts = new Set(sample.sources.map(source => new URL(source.url).hostname.replace(/^www\./, '')));
  for (const { row } of nonbrandRows) {
    assert.ok(row.sources.every(url => knownHosts.has(new URL(url).hostname.replace(/^www\./, ''))));
  }
});

test('direct-file sample embeds the same data without fetch', () => {
  const embedded = JSON.parse(directFileSource.replace(/^globalThis\.MADOHA_KYOUDO_SAMPLE\s*=\s*/, '').replace(/;\s*$/, ''));
  assert.deepEqual(embedded, sample);
});
