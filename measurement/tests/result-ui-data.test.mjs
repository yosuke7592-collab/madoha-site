import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadMeasuredDataset, resolveDataset } from '../../data-adapter.js';
import { normalizeResultData } from '../../mock-data.js';

const datasetPath = fileURLToPath(new URL('../../data/measured/jp-tokyo-setagaya-exterior-painting-setagaya-home.json', import.meta.url));
const rawText = await readFile(datasetPath, 'utf8');
const measured = JSON.parse(rawText);

test('resolves only registered company names and domains', () => {
  for (const input of ['世田谷ホーム', '世田谷ホーム株式会社', 'setagayahome.co.jp', 'https://www.setagayahome.co.jp/', 'https://service.setagayahome.co.jp/path']) {
    assert.equal(resolveDataset(input)?.id, 'setagaya-home-v1');
  }
  for (const input of ['', '世田谷', '架空塗装', 'https://example.com/setagayahome.co.jp']) {
    assert.equal(resolveDataset(input), null);
  }
});

test('loads and validates the registered static dataset', async () => {
  let requestedPath = '';
  const result = await loadMeasuredDataset('setagaya-home-v1', {
    fetchImpl: async path => {
      requestedPath = path;
      return { ok: true, json: async () => measured };
    }
  });
  assert.match(requestedPath, /^\.\/data\/measured\//u);
  assert.equal(result.subject.name, '世田谷ホーム');
  assert.equal(result.scores.visibility, 41);
});

test('rejects missing, unknown, and malformed datasets without fallback', async () => {
  await assert.rejects(loadMeasuredDataset('unknown', { fetchImpl: async () => ({ ok: true }) }));
  await assert.rejects(loadMeasuredDataset('setagaya-home-v1', { fetchImpl: async () => ({ ok: false }) }));
  await assert.rejects(loadMeasuredDataset('setagaya-home-v1', { fetchImpl: async () => ({ ok: true, json: async () => ({ dataset: { status: 'demo' } }) }) }));
});

test('public dataset exposes sanitized measured values and explicit gaps', () => {
  assert.equal(measured.dataset.status, 'measured');
  assert.equal(measured.scores.visibility, 41);
  assert.equal(measured.scores.stability, 82);
  assert.deepEqual(measured.scores.modelCoverage, { detected: 1, total: 1, status: 'measured' });
  assert.deepEqual(measured.scores.recommendation, { detected: 5, total: 17 });
  assert.deepEqual(measured.dataset.scoreCompleteness, { measured: 75, total: 100 });
  assert.equal(measured.dataset.scoreComponents.relativePosition.status, 'not_measured');
  assert.equal(measured.scores.accuracyStatus, 'not_measured');
  assert.deepEqual(measured.models.map(item => item.name), ['Perplexity Sonar']);
  assert.deepEqual(measured.dataset.unmeasuredModels, ['ChatGPT', 'Gemini']);
  assert.equal(measured.queries.length, 6);
  assert.equal(measured.competitors.length, 18);
});

test('public dataset contains no raw provider payload or credentials', () => {
  for (const forbidden of ['authorization', 'perplexity_api_key', 'rawproviderenvelope', 'choices', 'answertext', 'run-ledger.json']) {
    assert.equal(rawText.toLowerCase().includes(forbidden), false, forbidden);
  }
});

test('normalized ResultData retains measured and unmeasured semantics', () => {
  const result = normalizeResultData(measured, 'https://setagayahome.co.jp');
  assert.equal(result.subject.name, '世田谷ホーム');
  assert.equal(result.derived.scores.visibility, 41);
  assert.equal(result.derived.scores.accuracy, null);
  assert.equal(result.derived.scores.accuracyStatus, 'not_measured');
  assert.equal(result.dataset.scoreCompleteness.measured, 75);
  assert.equal(result.derived.models.length, 1);
  assert.equal(result.derived.queries.length, 6);
  assert.equal(result.derived.competitors.length, 18);
  assert.equal(result.derived.sourceDomains.length, 5);
});
