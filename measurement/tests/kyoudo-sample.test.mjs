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
  assert.ok(sample.queries.every(item => item.query && item.discoveryEvidence.length && item.qa.natural && item.qa.neutral && item.qa.relevant && item.qa.distinct && item.channels.length === 3 && item.sampleAnswer && /^https:\/\//.test(item.evidenceUrl) && item.gap));
  assert.ok(sample.competitors.length >= 3);
  assert.ok(sample.comparison.length >= 4 && sample.comparison.every(item => item.mentions && item.recommendations && item.confirmedDifference));
  assert.ok(sample.sources.length >= 5 && sample.sources.every(item => /^https:\/\//.test(item.url)));
  assert.ok(sample.issues.some(item => item.type === 'potential_misinformation'));
  assert.ok(sample.issues.every(item => /^https:\/\//.test(item.evidenceUrl) && item.checkedAt));
  assert.ok(sample.actions.length >= 5 && sample.actions.every(item => item.target && item.change && item.reason && item.expectedChange && item.verification));
  assert.ok(sample.facts.every(item => item.status === 'fact' && /^https:\/\//.test(item.source)));
  assert.ok(sample.baseline.id && sample.baseline.metrics.length >= 5 && sample.baseline.remeasurement && sample.baseline.fixedConditions.length >= 5 && sample.baseline.targets.length >= 5);
});

test('report uses six non-duplicative sections and AI cross-comparison', () => {
  for (let section = 1; section <= 6; section += 1) assert.match(reportSource, new RegExp(`SECTION ${section}`));
  assert.equal((reportSource.match(/SECTION \d/g) || []).length, 6);
  assert.match(reportSource, /AI検索での見え方/);
  assert.match(reportSource, /会社名で調べたときの見え方/);
  assert.match(reportSource, /ChatGPT/);
  assert.match(reportSource, /Gemini/);
  assert.match(reportSource, /Google AI Mode/);
  assert.match(reportSource, /公開情報で確認できた事実/);
  assert.match(reportSource, /改善する場合の選択肢/);
  assert.match(reportSource, /特定の表示・推薦結果を保証するものではありません/);
  assert.ok(pdf.length > 10_000);
});

test('direct-file sample embeds the same data without fetch', () => {
  const embedded = JSON.parse(directFileSource.replace(/^globalThis\.MADOHA_KYOUDO_SAMPLE\s*=\s*/, '').replace(/;\s*$/, ''));
  assert.deepEqual(embedded, sample);
});
