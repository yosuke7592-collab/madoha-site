import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKET, COMPANY_REGISTRY, SUBJECT, fixtureFor } from './data.mjs';
import { PerplexityFixtureAdapter, ProviderRegistry, LIVE_DISABLED_MESSAGE } from './provider.mjs';
import { assertGuardrails } from './guardrails.mjs';
import { aggregateResultData } from './aggregate.mjs';

export async function execute(args = process.argv.slice(2), options = {}) {
  const marketId = args.includes('--market') ? args[args.indexOf('--market') + 1] : MARKET.id;
  const mode = args.includes('--fixture') ? 'fixture' : args.includes('--live') ? 'live' : 'dry-run';
  if (marketId !== MARKET.id) throw new Error(`Unknown market: ${marketId}`);
  if (mode === 'live') throw new Error(LIVE_DISABLED_MESSAGE);
  const repetitions = 3;
  const runId = options.runId || 'fixture-run-v1';
  const now = options.now || '2026-08-18T00:00:00.000Z';
  const registry = new ProviderRegistry();
  const adapter = new PerplexityFixtureAdapter({ registry: COMPANY_REGISTRY, fixtureLoader: fixtureFor });
  registry.register(adapter);
  const plan = { mode, provider: 'perplexity', model: 'sonar', searchContextSize: 'low', marketCount: 1, providerCount: 1, queries: MARKET.queries, repetitions };
  adapter.validateRequest({ ...plan, mode: mode === 'dry-run' ? 'fixture' : mode });
  const estimate = adapter.estimateCost(plan);
  const guardrail = assertGuardrails(plan, estimate);
  const summary = { market: MARKET.label, marketId: MARKET.id, provider: plan.provider, model: plan.model, queryCount: plan.queries.length, repetitions, totalRequests: estimate.requests, estimate, guardrail };
  if (mode === 'dry-run') return { summary, envelopes: [], records: [], resultData: null };

  const envelopes = [];
  const records = [];
  for (const query of MARKET.queries) for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    const context = { mode: 'fixture', runId, now, market: MARKET, query, repetition, provider: plan.provider, model: plan.model, searchContextSize: plan.searchContextSize };
    const envelope = await adapter.fetchRaw(context);
    envelopes.push(envelope);
    records.push(adapter.normalizeProviderResponse({ rawEnvelope: envelope, runId, market: MARKET, query, repetition, requestedAt: now }));
  }
  const resultData = aggregateResultData(records, MARKET, SUBJECT);
  if (options.writeOutput !== false) {
    const root = resolve(fileURLToPath(new URL('.', import.meta.url)), 'output');
    await mkdir(root, { recursive: true });
    await Promise.all([
      writeFile(resolve(root, 'raw-provider-envelopes.json'), JSON.stringify(envelopes, null, 2)),
      writeFile(resolve(root, 'measurement-records.json'), JSON.stringify(records, null, 2)),
      writeFile(resolve(root, 'result-data-v1.json'), JSON.stringify(resultData, null, 2))
    ]);
  }
  return { summary, envelopes, records, resultData };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  execute().then(output => {
    console.log(JSON.stringify(output.summary, null, 2));
    if (output.resultData) console.log(JSON.stringify({ records: output.records.length, visibility: output.resultData.scores.visibility, stability: output.resultData.scores.stability, modelCoverage: output.resultData.scores.modelCoverage, scoreCompleteness: output.resultData.dataset.scoreCompleteness }, null, 2));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
