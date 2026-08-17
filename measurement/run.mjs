import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKET, COMPANY_REGISTRY, SUBJECT, QUERY_SET_VERSION, fixtureFor } from './data.mjs';
import { PerplexityFixtureAdapter, ProviderRegistry } from './provider.mjs';
import { PerplexityLiveAdapter, KEY_MISSING_MESSAGE } from './live.mjs';
import { GUARDRAILS, assertGuardrails } from './guardrails.mjs';
import { aggregateResultData } from './aggregate.mjs';
import { FileLedgerStore, assertNoDuplicate, createRunFingerprint, ledgerUsage, recordCompletedRun } from './ledger.mjs';

const moduleRoot = fileURLToPath(new URL('.', import.meta.url));
const valueAfter = (args, flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : null;
const round = value => Math.round(value * 1_000_000) / 1_000_000;

function parseMode(args) {
  const live = args.includes('--live');
  const fixture = args.includes('--fixture');
  const confirmLive = args.includes('--confirm-live');
  if (live && fixture) throw new Error('Choose either --live or --fixture, not both.');
  if (confirmLive && !live) throw new Error('--confirm-live requires --live.');
  return live ? 'live' : fixture ? 'fixture' : 'dry-run';
}

function assertLiveConfirmation(args) {
  if (!args.includes('--confirm-live')) throw new Error('Live execution requires --confirm-live.');
  const confirmedCost = Number(valueAfter(args, '--confirm-cost'));
  if (!Number.isFinite(confirmedCost) || confirmedCost !== GUARDRAILS.MAX_ESTIMATED_RUN_USD) {
    throw new Error(`Live execution requires --confirm-cost ${GUARDRAILS.MAX_ESTIMATED_RUN_USD.toFixed(2)}.`);
  }
}

function createNetworkBudget() {
  return {
    used: 0, max: GUARDRAILS.MAX_REQUESTS_PER_RUN,
    consume() { if (this.used >= this.max) return false; this.used += 1; return true; }
  };
}

function outputSummary(plan, estimate, guardrail, usage) {
  return {
    market: MARKET.label, marketId: MARKET.id, provider: plan.provider, model: plan.model,
    queryCount: plan.queries.length, repetitions: plan.repetitions, totalRequests: estimate.requests,
    estimate: { ...estimate, min: round(estimate.min), standard: round(estimate.standard), max: round(estimate.max) },
    limits: {
      perRunUsd: GUARDRAILS.MAX_ESTIMATED_RUN_USD, dailyUsd: GUARDRAILS.DAILY_HARD_STOP_USD,
      monthlyUsd: GUARDRAILS.MONTHLY_HARD_STOP_USD, maxNetworkRequests: GUARDRAILS.MAX_REQUESTS_PER_RUN
    }, ledgerUsage: usage, guardrail
  };
}

async function writeOutputs({ runId, envelopes, records, resultData, saveRaw }) {
  const root = resolve(moduleRoot, 'output', runId);
  await mkdir(root, { recursive: true });
  const writes = [
    writeFile(resolve(root, 'measurement-records.json'), JSON.stringify(records, null, 2)),
    writeFile(resolve(root, 'result-data-v1.json'), JSON.stringify(resultData, null, 2))
  ];
  if (saveRaw) writes.push(writeFile(resolve(root, 'raw-provider-envelopes.json'), JSON.stringify(envelopes, null, 2)));
  await Promise.all(writes);
  return root;
}

export async function execute(args = process.argv.slice(2), options = {}) {
  const marketId = valueAfter(args, '--market') || MARKET.id;
  const mode = parseMode(args);
  if (marketId !== MARKET.id) throw new Error(`Unknown market: ${marketId}`);
  const repetitions = 3;
  const now = options.now || new Date().toISOString();
  const cycleId = valueAfter(args, '--cycle') || now.slice(0, 10);
  const runId = options.runId || `${mode}-run-${now.replace(/[:.]/g, '-')}`;
  const basePlan = {
    mode, provider: 'perplexity', model: 'sonar', searchContextSize: 'low', marketCount: 1,
    providerCount: 1, queries: MARKET.queries, repetitions, runId, cycleId, querySetVersion: QUERY_SET_VERSION
  };
  const fixtureAdapter = new PerplexityFixtureAdapter({ registry: COMPANY_REGISTRY, fixtureLoader: fixtureFor });
  const liveAdapter = options.liveAdapter || new PerplexityLiveAdapter({ registry: COMPANY_REGISTRY });
  const adapter = mode === 'live' ? liveAdapter : fixtureAdapter;
  new ProviderRegistry().register(adapter).get('perplexity');
  const estimate = adapter.estimateCost(basePlan);
  const ledgerStore = options.ledgerStore || new FileLedgerStore(resolve(moduleRoot, 'state', 'run-ledger.json'));
  const ledger = await ledgerStore.load(now);
  const usage = ledgerUsage(ledger);
  const guardrail = assertGuardrails(basePlan, estimate, usage);
  const summary = outputSummary(basePlan, estimate, guardrail, usage);
  options.onPlan?.(summary);
  if (mode === 'dry-run') return { summary, envelopes: [], records: [], resultData: null, run: null };

  if (mode === 'live') {
    assertLiveConfirmation(args);
    liveAdapter.validateRequest(basePlan);
  } else {
    fixtureAdapter.validateRequest(basePlan);
  }

  const fingerprint = createRunFingerprint({ marketId, provider: basePlan.provider, model: basePlan.model, querySetVersion: QUERY_SET_VERSION, repetitions, cycleId });
  if (mode === 'live') assertNoDuplicate(ledger, fingerprint, now);
  const startedAt = now;
  const requestBudget = createNetworkBudget();
  const envelopes = [];
  const records = [];
  for (const query of MARKET.queries) for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    const requestedAt = options.clock?.() || now;
    const context = {
      ...basePlan, mode: mode === 'live' ? 'live' : 'fixture', now: requestedAt, market: MARKET,
      query, repetition, requestBudget
    };
    const envelope = await adapter.fetchRaw(context);
    envelopes.push(envelope);
    records.push(adapter.normalizeProviderResponse({
      rawEnvelope: envelope, runId, market: MARKET, query, repetition, requestedAt,
      estimatedCost: mode === 'live' ? estimate.standard / estimate.requests : 0
    }));
  }
  const resultData = aggregateResultData(records, MARKET, SUBJECT);
  const reportedValues = records.map(record => record.cost.reported).filter(Number.isFinite);
  const reportedCostUsd = reportedValues.length ? round(reportedValues.reduce((sum, value) => sum + value, 0)) : null;
  const failed = records.filter(record => record.status === 'failed').length;
  const completedAt = options.clock?.() || now;
  const run = {
    runId, cycleId, fingerprint, startedAt, completedAt, provider: basePlan.provider, model: basePlan.model,
    querySetVersion: QUERY_SET_VERSION, repetitions, plannedRequests: estimate.requests,
    networkRequests: mode === 'live' ? requestBudget.used : 0, estimatedCostUsd: mode === 'live' ? estimate.max : 0,
    reportedCostUsd, costDifferenceUsd: reportedCostUsd === null ? null : round(reportedCostUsd - estimate.max),
    status: failed === records.length ? 'failed' : failed ? 'partial' : 'completed'
  };
  if (mode === 'live') {
    recordCompletedRun(ledger, run);
    await ledgerStore.save(ledger);
  }
  const outputPath = options.writeOutput === false ? null : await writeOutputs({ runId, envelopes, records, resultData, saveRaw: !args.includes('--no-raw') });
  return { summary, envelopes, records, resultData, run, outputPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let planned = false;
  execute(process.argv.slice(2), {
    onPlan: summary => { planned = true; console.log(JSON.stringify(summary, null, 2)); }
  }).then(output => {
    if (!planned) console.log(JSON.stringify(output.summary, null, 2));
    if (output.resultData) console.log(JSON.stringify({
      records: output.records.length, visibility: output.resultData.scores.visibility,
      stability: output.resultData.scores.stability, modelCoverage: output.resultData.scores.modelCoverage,
      scoreCompleteness: output.resultData.dataset.scoreCompleteness, run: output.run, outputPath: output.outputPath
    }, null, 2));
  }).catch(error => {
    const safeMessage = error.message === KEY_MISSING_MESSAGE ? KEY_MISSING_MESSAGE : error.message;
    console.error(safeMessage); process.exitCode = 1;
  });
}
