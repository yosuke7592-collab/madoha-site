import { LIVE_DISABLED_MESSAGE } from './provider.mjs';

export const GUARDRAILS = Object.freeze({
  MAX_MARKETS_PER_RUN: 1, MAX_QUERIES_PER_RUN: 6, MAX_REPETITIONS: 3, MAX_PROVIDER_COUNT: 1,
  MAX_REQUESTS_PER_RUN: 18, MAX_RETRIES_PER_REQUEST: 1, MAX_RUNS_PER_DAY: 2,
  MAX_ESTIMATED_RUN_USD: 0.30, DAILY_HARD_STOP_USD: 0.60, MONTHLY_HARD_STOP_USD: 10.00,
  MAX_OUTPUT_TOKENS: 600, SEARCH_CONTEXT_SIZE: 'low'
});

export function assertGuardrails(plan, estimate, usage = { runsToday: 0, dailyUsd: 0, monthlyUsd: 0 }) {
  const failures = [];
  if (plan.mode === 'live') failures.push(LIVE_DISABLED_MESSAGE);
  if (plan.marketCount > GUARDRAILS.MAX_MARKETS_PER_RUN) failures.push('Market limit exceeded.');
  if (plan.queries.length > GUARDRAILS.MAX_QUERIES_PER_RUN) failures.push('Query limit exceeded.');
  if (plan.repetitions > GUARDRAILS.MAX_REPETITIONS) failures.push('Repetition limit exceeded.');
  if (plan.providerCount > GUARDRAILS.MAX_PROVIDER_COUNT) failures.push('Provider limit exceeded.');
  if (estimate.requests > GUARDRAILS.MAX_REQUESTS_PER_RUN) failures.push('Request limit exceeded.');
  if (estimate.max > GUARDRAILS.MAX_ESTIMATED_RUN_USD) failures.push('Estimated run cost limit exceeded.');
  if (usage.runsToday >= GUARDRAILS.MAX_RUNS_PER_DAY) failures.push('Daily run limit exceeded.');
  if (usage.dailyUsd + estimate.max > GUARDRAILS.DAILY_HARD_STOP_USD) failures.push('Daily cost hard stop exceeded.');
  if (usage.monthlyUsd + estimate.max > GUARDRAILS.MONTHLY_HARD_STOP_USD) failures.push('Monthly cost hard stop exceeded.');
  if (failures.length) throw new Error(failures.join(' '));
  return { passed: true, failures: [] };
}
