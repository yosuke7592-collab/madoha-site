import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMeasurementRecord, validateRawProviderEnvelope } from '../schema.mjs';
import { MARKET, COMPANY_REGISTRY, SUBJECT, fixtureFor } from '../data.mjs';
import { normalizeCompanyName, extractCompanies, detectRecommendation, detectRelativePosition } from '../extraction.mjs';
import { classifySource } from '../source.mjs';
import { PerplexityFixtureAdapter, ProviderRegistry, LIVE_DISABLED_MESSAGE } from '../provider.mjs';
import { assertGuardrails } from '../guardrails.mjs';
import { aggregateResultData } from '../aggregate.mjs';
import { execute } from '../run.mjs';
import { normalizeResultData } from '../../mock-data.js';

const now = '2026-08-18T00:00:00.000Z';
const adapter = new PerplexityFixtureAdapter({ registry: COMPANY_REGISTRY, fixtureLoader: fixtureFor });
new ProviderRegistry().register(adapter).get('perplexity');

async function recordFor(query = MARKET.queries[0], repetition = 1) {
  const raw = await adapter.fetchRaw({ mode: 'fixture', runId: 'test', now, market: MARKET, query, repetition, provider: 'perplexity', model: 'sonar', searchContextSize: 'low' });
  return adapter.normalizeProviderResponse({ rawEnvelope: raw, runId: 'test', market: MARKET, query, repetition, requestedAt: now });
}

test('validation accepts valid envelope, success and failed records', async () => {
  const success = await recordFor();
  validateMeasurementRecord(success);
  const failed = await recordFor(MARKET.queries[4], 3);
  assert.equal(failed.status, 'failed'); validateMeasurementRecord(failed);
  assert.throws(() => validateRawProviderEnvelope({ schemaVersion: '2.0' }), /schemaVersion/);
});

test('adapter handles target, target absent, citation absent and failure', async () => {
  const present = await recordFor(MARKET.queries[0], 1);
  assert.ok(present.companies.some(item => item.normalizedCompanyId === SUBJECT.id));
  assert.equal(present.citationStatus, 'present');
  const absent = await recordFor(MARKET.queries[0], 3);
  assert.ok(!absent.companies.some(item => item.normalizedCompanyId === SUBJECT.id));
  const partial = await recordFor(MARKET.queries[3], 3);
  assert.equal(partial.citationStatus, 'absent');
  assert.equal((await recordFor(MARKET.queries[4], 3)).status, 'failed');
});

test('company extraction supports canonical, alias, normalization and unknown', () => {
  assert.equal(extractCompanies('世田谷ホーム', COMPANY_REGISTRY)[0].matchMethod, 'canonical_exact');
  const aliasRegistry = [{ id: 'x', canonicalName: 'Fixture Paint', displayName: 'Fixture', aliases: ['別名塗装'], officialDomains: [] }];
  assert.equal(extractCompanies('別名塗装がおすすめです', aliasRegistry)[0].matchMethod, 'registry_alias');
  assert.equal(normalizeCompanyName('（株） 世田谷・ホーム'), '世田谷ホーム');
  assert.equal(extractCompanies('（株） 世田谷・ホームがあります', COMPANY_REGISTRY)[0].normalizedCompanyId, SUBJECT.id);
  const unknown = extractCompanies('候補は次の通りです。\n1. 未知塗装 — fixture候補です。', COMPANY_REGISTRY).find(item => item.rawName === '未知塗装');
  assert.equal(unknown.normalizedCompanyId, null);
  assert.equal(unknown.matchMethod, 'rule_unknown');
  const official = extractCompanies('', COMPANY_REGISTRY, [{ domain: 'tokyo-paint.example' }]);
  assert.equal(official[0].matchMethod, 'official_domain');
});

test('recommendation and relative position rules separate context', () => {
  assert.equal(detectRecommendation('おすすめの候補は世田谷ホームです', '世田谷ホーム'), true);
  assert.equal(detectRecommendation('おすすめの候補は次の通りです。\n1. 世田谷ホーム', '世田谷ホーム'), true);
  assert.equal(detectRecommendation('世田谷ホームを比較しました', '世田谷ホーム'), false);
  assert.equal(detectRecommendation('世田谷ホームはおすすめしないという注意があります', '世田谷ホーム'), false);
  assert.equal(detectRelativePosition('1. 世田谷ホーム\n2. 東京ペイント', '世田谷ホーム'), 1);
  assert.equal(detectRelativePosition('世田谷ホームと東京ペイントがあります', '世田谷ホーム'), null);
});

test('source classification covers official, comparison, reviews, sns and other', () => {
  assert.equal(classifySource('https://www.tokyo-paint.example/a', COMPANY_REGISTRY).sourceType, 'official');
  assert.equal(classifySource('https://comparison.example/a').sourceType, 'comparison');
  assert.equal(classifySource('https://reviews.example/a').sourceType, 'reviews');
  assert.equal(classifySource('https://instagram.com/a').sourceType, 'sns');
  assert.equal(classifySource('https://unknown.example/a').sourceType, 'other');
});

test('fixture aggregation calculates scores and excludes failed records', async () => {
  const output = await execute(['--market', MARKET.id, '--fixture'], { writeOutput: false });
  const { records, resultData } = output;
  assert.equal(records.length, 18);
  assert.equal(records.filter(item => item.status === 'success').length, 16);
  assert.equal(resultData.dataset.scoringVersion, '0.1');
  assert.equal(resultData.scores.accuracy, null);
  assert.equal(resultData.scores.accuracyStatus, 'not_measured');
  assert.equal(resultData.informationIssues.length, 0);
  assert.ok(resultData.scores.visibility > 0);
  assert.ok(resultData.scores.stability !== null);
  assert.deepEqual(resultData.scores.modelCoverage, { detected: 1, total: 1, status: 'measured' });
  const failedOnly = aggregateResultData(records.filter(item => item.status === 'failed'), MARKET, SUBJECT);
  assert.equal(failedOnly.scores.modelCoverage.status, 'not_measured');
  assert.equal(failedOnly.dataset.scoreComponents.relativePosition.status, 'not_measured');
});

test('guardrails allow 18 and block request, repetition, cost, and live violations', () => {
  const plan = { mode: 'dry-run', marketCount: 1, providerCount: 1, queries: MARKET.queries, repetitions: 3 };
  assert.equal(assertGuardrails(plan, { requests: 18, max: .234 }).passed, true);
  assert.throws(() => assertGuardrails(plan, { requests: 19, max: .234 }), /Request limit/);
  assert.throws(() => assertGuardrails({ ...plan, repetitions: 4 }, { requests: 18, max: .234 }), /Repetition limit/);
  assert.throws(() => assertGuardrails(plan, { requests: 18, max: .31 }), /Estimated run cost/);
  assert.throws(() => assertGuardrails({ ...plan, mode: 'live' }, { requests: 18, max: .234 }), new RegExp(LIVE_DISABLED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('generated ResultData passes frontend normalization', async () => {
  const { resultData } = await execute(['--fixture'], { writeOutput: false });
  const normalized = normalizeResultData(resultData);
  assert.equal(normalized.schemaVersion, '1.0');
  assert.equal(normalized.subject.name, SUBJECT.displayName);
  assert.equal(normalized.derived.scores.visibility, resultData.scores.visibility);
  assert.ok(Array.isArray(normalized.derived.graph.nodes));
});
