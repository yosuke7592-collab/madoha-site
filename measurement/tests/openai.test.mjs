import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKET, COMPANY_REGISTRY, SUBJECT, QUERY_SET_VERSION } from '../data.mjs';
import { openAiFixtureFor } from '../openai-data.mjs';
import {
  OpenAiFixtureAdapter, OpenAiLiveAdapter, OPENAI_ENDPOINT, OPENAI_KEY_MISSING_MESSAGE,
  OPENAI_MODEL, estimateOpenAiCost
} from '../openai.mjs';
import { OPENAI_GUARDRAILS, assertGuardrails } from '../guardrails.mjs';
import { aggregateResultData } from '../aggregate.mjs';
import { execute } from '../run.mjs';
import { MemoryLedgerStore, createRunFingerprint, recordCompletedRun } from '../ledger.mjs';

const now = '2026-08-18T02:00:00.000Z';
const fixture = new OpenAiFixtureAdapter({ registry: COMPANY_REGISTRY, fixtureLoader: openAiFixtureFor });
const basePlan = { mode: 'fixture', provider: 'openai', model: OPENAI_MODEL, queries: MARKET.queries, repetitions: 3 };

async function recordFor(query = MARKET.queries[0], repetition = 1) {
  const raw = await fixture.fetchRaw({ ...basePlan, runId: 'openai-test', now, market: MARKET, query, repetition });
  return fixture.normalizeProviderResponse({ rawEnvelope: raw, runId: 'openai-test', market: MARKET, query, repetition, requestedAt: now });
}

const mockPayload = id => ({
  id, object: 'response', status: 'completed', model: 'gpt-5.6-luna',
  output: [
    { type: 'web_search_call', action: { type: 'search', sources: [{ type: 'url', url: 'https://setagayahome.co.jp/cases', title: '世田谷ホーム公式' }] } },
    { type: 'message', content: [{ type: 'output_text', text: 'おすすめは世田谷ホームです。', annotations: [{ type: 'url_citation', url: 'https://setagayahome.co.jp/cases', title: '世田谷ホーム公式', start_index: 0, end_index: 5 }] }] }
  ], usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }
});
const response = (status, payload) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => payload });
const livePlan = overrides => ({ ...basePlan, mode: 'live', runId: 'mock-openai', market: MARKET, query: MARKET.queries[0], repetition: 1, requestBudget: { used: 0, max: 18, consume() { this.used += 1; return this.used <= this.max; } }, ...overrides });

test('fixture generates 18 records and covers success, absent, no citation, and provider error', async () => {
  const output = await execute(['--provider', 'openai', '--fixture'], { now, writeOutput: false });
  assert.equal(output.records.length, 18);
  assert.ok(output.records.some(record => record.status === 'success'));
  assert.ok(output.records.some(record => record.status === 'partial' && record.citationStatus === 'absent'));
  assert.ok(output.records.some(record => record.status === 'failed'));
  assert.ok(output.records.some(record => !record.companies.some(company => company.normalizedCompanyId === SUBJECT.id)));
});

test('raw normalization preserves OpenAI identity, version, response ID, citations, usage, and product semantics', async () => {
  const record = await recordFor();
  assert.equal(record.provider, 'openai');
  assert.equal(record.modelVersion, 'gpt-5.6-luna');
  assert.match(record.providerMetadata.responseId, /^openai-fixture-/);
  assert.equal(record.providerMetadata.measurementType, 'openai_web_search');
  assert.equal(record.providerMetadata.consumerProductReference, 'ChatGPT');
  assert.equal(record.providerMetadata.consumerProductEquivalent, false);
  assert.equal(record.usage.inputTokens, 250);
  assert.ok(record.citations.some(item => item.sourceType === 'official'));
  assert.ok(record.companies.some(item => item.normalizedCompanyId === SUBJECT.id));
});

test('cost estimate separates model tokens and web search with dated official pricing', () => {
  const estimate = estimateOpenAiCost(basePlan);
  assert.deepEqual({ requests: estimate.requests, min: estimate.min, standard: estimate.standard, max: estimate.max }, { requests: 18, min: 0.19206, standard: 0.21834, max: 0.25236 });
  assert.equal(estimate.components.webSearch.calls, 18);
  assert.equal(estimate.pricing.checkedAt, '2026-08-20');
  assert.equal(assertGuardrails({ ...basePlan, marketCount: 1, providerCount: 1 }, estimate, undefined, OPENAI_GUARDRAILS).passed, true);
  assert.throws(() => assertGuardrails({ ...basePlan, marketCount: 1, providerCount: 1 }, { ...estimate, max: .281 }, undefined, OPENAI_GUARDRAILS), /run cost/);
});

test('auth and confirmation gates block OpenAI live execution', async () => {
  const missing = new OpenAiLiveAdapter({ registry: COMPANY_REGISTRY, fetchImpl: async () => response(200, mockPayload('never')), apiKeyProvider: () => '' });
  assert.throws(() => missing.buildRequest(livePlan()), new RegExp(OPENAI_KEY_MISSING_MESSAGE));
  const mock = new OpenAiLiveAdapter({ registry: COMPANY_REGISTRY, fetchImpl: async () => response(200, mockPayload('never')), apiKeyProvider: () => 'test-only' });
  await assert.rejects(execute(['--provider', 'openai', '--live'], { now, openAiLiveAdapter: mock, ledgerStore: new MemoryLedgerStore(), writeOutput: false }), /confirm-live/);
  await assert.rejects(execute(['--provider', 'openai', '--live', '--confirm-live', '--confirm-cost', '0.30'], { now, openAiLiveAdapter: mock, ledgerStore: new MemoryLedgerStore(), writeOutput: false }), /confirm-cost 0.28/);
});

test('request uses Responses web_search, sources, store false and never puts key in body', () => {
  const live = new OpenAiLiveAdapter({ registry: COMPANY_REGISTRY, fetchImpl: async () => response(200, mockPayload('x')), apiKeyProvider: () => 'test-only-secret' });
  const request = live.buildRequest(livePlan());
  assert.equal(request.url, OPENAI_ENDPOINT);
  const body = JSON.parse(request.init.body);
  assert.equal(body.model, OPENAI_MODEL);
  assert.deepEqual(body.tools, [{ type: 'web_search' }]);
  assert.deepEqual(body.include, ['web_search_call.action.sources']);
  assert.equal(body.store, false);
  assert.ok(!request.init.body.includes('test-only-secret'));
});

test('mocked live success and provider failures normalize without real network', async () => {
  let calls = 0;
  const live = new OpenAiLiveAdapter({ registry: COMPANY_REGISTRY, fetchImpl: async () => { calls += 1; return response(200, mockPayload(`mock-${calls}`)); }, apiKeyProvider: () => 'test-only', now: () => now });
  const raw = await live.fetchRaw(livePlan());
  const record = live.normalizeProviderResponse({ rawEnvelope: raw, runId: 'mock', market: MARKET, query: MARKET.queries[0], repetition: 1, requestedAt: now });
  assert.equal(calls, 1);
  assert.equal(record.status, 'success');
  assert.equal(record.citations.length, 1);

  for (const status of [401, 429, 500]) {
    let attempts = 0;
    const failed = new OpenAiLiveAdapter({ registry: COMPANY_REGISTRY, fetchImpl: async () => { attempts += 1; return response(status, { error: { message: 'not persisted' } }); }, apiKeyProvider: () => 'test-only', sleep: async () => {}, now: () => now });
    const failedRecord = failed.normalizeProviderResponse({ rawEnvelope: await failed.fetchRaw(livePlan()), runId: 'mock', market: MARKET, query: MARKET.queries[0], repetition: 1, requestedAt: now });
    assert.equal(failedRecord.status, 'failed');
    assert.equal(attempts, status === 401 ? 1 : 2);
  }
});

test('shared ledger totals both providers and OpenAI fingerprint duplicate is blocked', async () => {
  const ledger = await new MemoryLedgerStore().load(now);
  recordCompletedRun(ledger, { fingerprint: 'perplexity', startedAt: now, completedAt: now, estimatedCostUsd: .234, reportedCostUsd: .1, status: 'completed', provider: 'perplexity' });
  recordCompletedRun(ledger, { fingerprint: 'openai', startedAt: now, completedAt: now, estimatedCostUsd: .25236, reportedCostUsd: null, status: 'completed', provider: 'openai' });
  assert.equal(ledger.estimatedSpentTodayUsd, .48636);

  const fingerprint = createRunFingerprint({ marketId: MARKET.id, provider: 'openai', model: OPENAI_MODEL, querySetVersion: QUERY_SET_VERSION, repetitions: 3, cycleId: 'cycle' });
  const duplicateStore = new MemoryLedgerStore();
  const stored = await duplicateStore.load(now);
  recordCompletedRun(stored, { fingerprint, startedAt: now, completedAt: now, estimatedCostUsd: .25236, status: 'completed' });
  await duplicateStore.save(stored);
  let calls = 0;
  const live = new OpenAiLiveAdapter({ registry: COMPANY_REGISTRY, fetchImpl: async () => { calls += 1; return response(200, mockPayload('x')); }, apiKeyProvider: () => 'test-only' });
  await assert.rejects(execute(['--provider', 'openai', '--live', '--confirm-live', '--confirm-cost', '0.28', '--cycle', 'cycle'], { now, openAiLiveAdapter: live, ledgerStore: duplicateStore, writeOutput: false }), /Duplicate/);
  assert.equal(calls, 0);
});

test('Perplexity and OpenAI fixtures aggregate with 2/2 coverage and provider/query comparison', async () => {
  const perplexity = await execute(['--fixture'], { now, writeOutput: false });
  const openai = await execute(['--provider', 'openai', '--fixture'], { now, writeOutput: false });
  const combined = aggregateResultData([...perplexity.records, ...openai.records], MARKET, SUBJECT, COMPANY_REGISTRY);
  assert.deepEqual(combined.scores.modelCoverage, { detected: 2, total: 2, status: 'measured' });
  assert.deepEqual(combined.models.map(item => item.name).sort(), ['OpenAI Search', 'Perplexity Sonar']);
  assert.equal(combined.providerComparison.length, 2);
  assert.equal(combined.queryProviderComparison.length, 12);
  assert.ok(combined.competitors.length > 0);
  assert.ok(combined.sources.length > 0);

  const duplicatedOpenAi = aggregateResultData([...perplexity.records, ...openai.records, ...openai.records], MARKET, SUBJECT, COMPANY_REGISTRY);
  assert.equal(duplicatedOpenAi.scores.visibility, combined.scores.visibility);
  assert.deepEqual(duplicatedOpenAi.queries.map(item => item.strength), combined.queries.map(item => item.strength));
  assert.equal(duplicatedOpenAi.dataset.providerWeighting, 'equal_provider_model');
});
