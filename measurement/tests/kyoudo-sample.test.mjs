import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sample = JSON.parse(await readFile(new URL('../../data/samples/kyoudo-housing-paid-diagnosis.json', import.meta.url), 'utf8'));
const directFileSource = await readFile(new URL('../../sample-kyoudo-data.js', import.meta.url), 'utf8');

test('Kyoudo paid sample is explicit fixture and covers purchase-value sections', () => {
  assert.equal(sample.sample, true);
  assert.match(sample.measurement.limitations, /実測値ではありません/);
  assert.equal(sample.queries.length, 8);
  assert.ok(sample.queries.every(item => item.query && typeof item.appeared === 'boolean' && typeof item.recommended === 'boolean' && item.sampleAnswer && /^https:\/\//.test(item.evidenceUrl) && item.mainCompetitor && item.gap));
  assert.ok(sample.competitors.length >= 3);
  assert.ok(sample.comparison.length >= 4 && sample.comparison.every(item => item.mentions && item.recommendations && item.confirmedDifference));
  assert.ok(sample.sources.length >= 5 && sample.sources.every(item => /^https:\/\//.test(item.url)));
  assert.ok(sample.issues.some(item => item.type === 'potential_misinformation'));
  assert.ok(sample.issues.every(item => /^https:\/\//.test(item.evidenceUrl) && item.checkedAt));
  assert.ok(sample.actions.length >= 5 && sample.actions.every(item => item.target && item.change && item.reason && item.expectedChange && item.verification));
  assert.ok(sample.facts.every(item => item.status === 'fact' && /^https:\/\//.test(item.source)));
  assert.ok(sample.baseline.id && sample.baseline.metrics.length >= 5 && sample.baseline.remeasurement && sample.baseline.fixedConditions.length >= 5 && sample.baseline.targets.length >= 5);
});

test('direct-file sample embeds the same data without fetch', () => {
  const embedded = JSON.parse(directFileSource.replace(/^globalThis\.MADOHA_KYOUDO_SAMPLE\s*=\s*/, '').replace(/;\s*$/, ''));
  assert.deepEqual(embedded, sample);
});
