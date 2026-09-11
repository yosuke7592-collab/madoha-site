import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PAID_V1, auditQueries, confirmEntity, identifyEntity, validateFixtureReport } from '../paid-v1-spec.mjs';

const sample = JSON.parse(await readFile(new URL('../../data/samples/kyoudo-housing-paid-diagnosis.json', import.meta.url), 'utf8'));

test('v1 fixes the paid product measurement contract', () => {
  assert.equal(PAID_V1.priceJpy, 4980);
  assert.deepEqual(PAID_V1.queryCounts, { total: 10 });
  assert.deepEqual(PAID_V1.channels, ['chatgpt', 'gemini', 'google_ai_mode']);
  assert.equal(PAID_V1.repetitions, 1);
  assert.equal(PAID_V1.totalMeasurements, 30);
});

test('target identification stops when context is insufficient and requires confirmation', () => {
  assert.equal(identifyEntity({ name: '株式会社協同住宅' }).status, 'insufficient');
  const found = identifyEntity({ entity_type: 'company', name: '株式会社協同住宅', official_url: 'https://www.kyoudo.jp/' });
  assert.equal(found.status, 'confirmation_required');
  assert.equal(confirmEntity(found).identification_status, 'confirmed');
});

test('Kyoudo sample passes query discovery, QA and 30-measurement contract', () => {
  assert.equal(auditQueries(sample.queries, sample.subject.name).passed, true);
  assert.equal(validateFixtureReport(sample), sample);
  assert.equal(sample.queries.flatMap(query => query.channels).length, 30);
});
