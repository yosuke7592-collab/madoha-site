import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKET, COMPANY_REGISTRY } from '../data.mjs';
import { GUARDRAILS, assertGuardrails } from '../guardrails.mjs';
import { PerplexityLiveAdapter, KEY_MISSING_MESSAGE, PERPLEXITY_ENDPOINT } from '../live.mjs';
import { MemoryLedgerStore, createRunFingerprint, recordCompletedRun } from '../ledger.mjs';
import { execute } from '../run.mjs';

const now = '2026-08-18T01:00:00.000Z';
const headers = values => ({ get: name => values?.[name.toLowerCase()] ?? null });
const response = (status, payload, headerValues = {}) => ({ ok: status >= 200 && status < 300, status, headers: headers(headerValues), json: async () => payload });
const successPayload = (id = 'response-live-mock') => ({
  id, model: 'sonar', created: 1787014800,
  choices: [{ index: 0, message: { role: 'assistant', content: 'おすすめの候補は世田谷ホームです。' }, finish_reason: 'stop' }],
  citations: ['https://reviews.example/setagaya-home'],
  search_results: [{ title: '世田谷ホーム fixture source', url: 'https://reviews.example/setagaya-home', source: 'web' }],
  usage: { prompt_tokens: 20, completion_tokens: 40, total_tokens: 60, num_search_queries: 1, search_context_size: 'low', cost: { total_cost: .00506 } }
});
const plan = (overrides = {}) => ({
  mode: 'live', provider: 'perplexity', model: 'sonar', searchContextSize: 'low', runId: 'mock-run',
  market: MARKET, query: MARKET.queries[0], repetition: 1, queries: MARKET.queries, repetitions: 3,
  requestBudget: { used: 0, max: 18, consume() { if (this.used >= this.max) return false; this.used += 1; return true; } },
  ...overrides
});

function adapter(fetchImpl, options = {}) {
  return new PerplexityLiveAdapter({
    registry: COMPANY_REGISTRY, fetchImpl, apiKeyProvider: options.apiKeyProvider || (() => 'fixture-only-test-secret'),
    sleep: options.sleep || (async () => {}), timeoutMs: options.timeoutMs || 20, now: () => now
  });
}

test('auth blocks missing key and constructs the official request without exposing it in body', () => {
  const missing = adapter(async () => response(200, successPayload()), { apiKeyProvider: () => '' });
  assert.throws(() => missing.buildRequest(plan()), new RegExp(KEY_MISSING_MESSAGE));
  const built = adapter(async () => response(200, successPayload())).buildRequest(plan());
  assert.equal(built.url, PERPLEXITY_ENDPOINT);
  assert.equal(built.init.headers.Authorization, 'Bearer fixture-only-test-secret');
  const body = JSON.parse(built.init.body);
  assert.equal(body.model, 'sonar');
  assert.equal(body.max_tokens, GUARDRAILS.MAX_OUTPUT_TOKENS);
  assert.equal(body.language_preference, 'ja');
  assert.equal(body.web_search_options.search_context_size, 'low');
  assert.ok(!built.init.body.includes('fixture-only-test-secret'));
});

test('confirmation flags preserve dry-run and block incomplete live requests', async () => {
  const store = new MemoryLedgerStore();
  assert.equal((await execute([], { now, ledgerStore: store, writeOutput: false })).resultData, null);
  await assert.rejects(execute(['--live'], { now, ledgerStore: store, liveAdapter: adapter(async () => response(200, successPayload())), writeOutput: false }), /confirm-live/);
  await assert.rejects(execute(['--confirm-live'], { now, ledgerStore: store, writeOutput: false }), /requires --live/);
  await assert.rejects(execute(['--live', '--confirm-live', '--confirm-cost', '0.29'], { now, ledgerStore: store, liveAdapter: adapter(async () => response(200, successPayload())), writeOutput: false }), /confirm-cost 0.30/);
});

test('valid confirmation reaches only the injected mock network path', async () => {
  let calls = 0;
  const live = adapter(async () => { calls += 1; return response(200, successPayload(`mock-${calls}`)); });
  const output = await execute(['--live', '--confirm-live', '--confirm-cost', '0.30', '--cycle', 'mock-cycle-a'], {
    now, runId: 'confirmed-mock-run', ledgerStore: new MemoryLedgerStore(), liveAdapter: live, writeOutput: false
  });
  assert.equal(calls, 18);
  assert.equal(output.records.length, 18);
  assert.equal(output.run.status, 'completed');
  assert.equal(output.run.networkRequests, 18);
  assert.equal(output.run.reportedCostUsd, .09108);
});

test('cost limits block run, daily, monthly, and run count overruns', () => {
  const base = { mode: 'live', marketCount: 1, providerCount: 1, queries: MARKET.queries, repetitions: 3 };
  assert.throws(() => assertGuardrails(base, { requests: 18, max: .31 }), /run cost/);
  assert.throws(() => assertGuardrails(base, { requests: 18, max: .234 }, { runsToday: 2, dailyUsd: 0, monthlyUsd: 0 }), /Daily run/);
  assert.throws(() => assertGuardrails(base, { requests: 18, max: .234 }, { runsToday: 0, dailyUsd: .5, monthlyUsd: 0 }), /Daily cost/);
  assert.throws(() => assertGuardrails(base, { requests: 18, max: .234 }, { runsToday: 0, dailyUsd: 0, monthlyUsd: 9.9 }), /Monthly cost/);
});

test('network success normalizes citations, usage, reported cost, and missing fields', async () => {
  const live = adapter(async () => response(200, successPayload(), { 'x-ratelimit-remaining': '49' }));
  const raw = await live.fetchRaw(plan());
  const record = live.normalizeProviderResponse({ rawEnvelope: raw, runId: 'mock-run', market: MARKET, query: MARKET.queries[0], repetition: 1, requestedAt: now, estimatedCost: .0057 });
  assert.equal(record.status, 'success');
  assert.equal(record.citations.length, 1);
  assert.equal(record.usage.inputTokens, 20);
  assert.equal(record.cost.reported, .00506);
  assert.equal(record.providerMetadata.responseId, 'response-live-mock');
  assert.equal(record.providerMetadata.rateLimit.remaining, '49');

  const missingRaw = await adapter(async () => response(200, { id: 'missing', model: 'sonar', choices: [] })).fetchRaw(plan());
  const missing = live.normalizeProviderResponse({ rawEnvelope: missingRaw, runId: 'mock-run', market: MARKET, query: MARKET.queries[0], repetition: 1, requestedAt: now });
  assert.equal(missing.status, 'partial');
  assert.equal(missing.cost.reported, null);
});

test('timeout, 401, malformed JSON, 429 retry, and 500 retry become safe records', async () => {
  const timeoutAdapter = adapter((url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))), { timeoutMs: 1 });
  const timeoutRecord = timeoutAdapter.normalizeProviderResponse({ rawEnvelope: await timeoutAdapter.fetchRaw(plan()), runId: 'x', market: MARKET, query: MARKET.queries[0], repetition: 1, requestedAt: now });
  assert.equal(timeoutRecord.failure.category, 'timeout');

  const unauthorized = adapter(async () => response(401, { error: { message: 'secret details ignored' } }));
  const unauthorizedRecord = unauthorized.normalizeProviderResponse({ rawEnvelope: await unauthorized.fetchRaw(plan()), runId: 'x', market: MARKET, query: MARKET.queries[0], repetition: 1, requestedAt: now });
  assert.equal(unauthorizedRecord.failure.httpStatus, 401);
  assert.equal(unauthorizedRecord.failure.retryable, false);

  const malformed = adapter(async () => ({ ok: true, status: 200, headers: headers(), json: async () => { throw new Error('bad json'); } }));
  const malformedRecord = malformed.normalizeProviderResponse({ rawEnvelope: await malformed.fetchRaw(plan()), runId: 'x', market: MARKET, query: MARKET.queries[0], repetition: 1, requestedAt: now });
  assert.equal(malformedRecord.failure.category, 'malformed_json');

  for (const status of [429, 500]) {
    let calls = 0;
    const retry = adapter(async () => { calls += 1; return calls === 1 ? response(status, { error: 'retry' }, { 'retry-after': '0' }) : response(200, successPayload()); });
    const raw = await retry.fetchRaw(plan());
    assert.equal(calls, 2);
    assert.equal(raw.metadata.attempts, 2);
  }
});

test('ledger updates totals, stores failure safely, and blocks completed duplicates', async () => {
  const store = new MemoryLedgerStore();
  const fingerprint = createRunFingerprint({ marketId: MARKET.id, provider: 'perplexity', model: 'sonar', querySetVersion: 'v1', repetitions: 3, cycleId: 'cycle' });
  const ledger = await store.load(now);
  recordCompletedRun(ledger, { fingerprint, startedAt: now, completedAt: now, estimatedCostUsd: .234, reportedCostUsd: .1, status: 'completed' });
  recordCompletedRun(ledger, { fingerprint: 'failed-fingerprint', startedAt: now, completedAt: now, estimatedCostUsd: .05, reportedCostUsd: null, status: 'failed' });
  await store.save(ledger);
  const loaded = await store.load(now);
  assert.equal(loaded.runsToday, 2);
  assert.equal(loaded.estimatedSpentTodayUsd, .284);
  assert.equal(loaded.reportedSpentTodayUsd, .1);
  assert.equal(loaded.runs.at(-1).status, 'failed');

  const live = adapter(async () => response(200, successPayload()));
  const duplicateStore = new MemoryLedgerStore();
  await execute(['--live', '--confirm-live', '--confirm-cost', '0.30', '--cycle', 'duplicate-cycle'], { now, runId: 'first', ledgerStore: duplicateStore, liveAdapter: live, writeOutput: false });
  await assert.rejects(execute(['--live', '--confirm-live', '--confirm-cost', '0.30', '--cycle', 'duplicate-cycle'], { now, runId: 'second', ledgerStore: duplicateStore, liveAdapter: live, writeOutput: false }), /Duplicate live measurement/);
});
