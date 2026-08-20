export const GUARDRAILS = Object.freeze({
  MAX_MARKETS_PER_RUN: 1, MAX_QUERIES_PER_RUN: 6, MAX_REPETITIONS: 3, MAX_PROVIDER_COUNT: 1,
  MAX_REQUESTS_PER_RUN: 18, MAX_RETRIES_PER_REQUEST: 1, MAX_RUNS_PER_DAY: 2,
  MAX_ESTIMATED_RUN_USD: 0.30, DAILY_HARD_STOP_USD: 0.60, MONTHLY_HARD_STOP_USD: 10.00,
  MAX_OUTPUT_TOKENS: 600, SEARCH_CONTEXT_SIZE: 'low'
});

export const OPENAI_GUARDRAILS = Object.freeze({
  ...GUARDRAILS,
  MAX_ESTIMATED_RUN_USD: 0.28,
  MAX_OUTPUT_TOKENS: 600
});

export function assertGuardrails(plan, estimate, usage = { runsToday: 0, dailyUsd: 0, monthlyUsd: 0 }, limits = GUARDRAILS) {
  const failures = [];
  if (plan.marketCount > limits.MAX_MARKETS_PER_RUN) failures.push('Market limit exceeded.');
  if (plan.queries.length > limits.MAX_QUERIES_PER_RUN) failures.push('Query limit exceeded.');
  if (plan.repetitions > limits.MAX_REPETITIONS) failures.push('Repetition limit exceeded.');
  if (plan.providerCount > limits.MAX_PROVIDER_COUNT) failures.push('Provider limit exceeded.');
  if (estimate.requests > limits.MAX_REQUESTS_PER_RUN) failures.push('Request limit exceeded.');
  if (estimate.max > limits.MAX_ESTIMATED_RUN_USD) failures.push('Estimated run cost limit exceeded.');
  if (usage.runsToday >= limits.MAX_RUNS_PER_DAY) failures.push('Daily run limit exceeded.');
  if (usage.dailyUsd + estimate.max > limits.DAILY_HARD_STOP_USD) failures.push('Daily cost hard stop exceeded.');
  if (usage.monthlyUsd + estimate.max > limits.MONTHLY_HARD_STOP_USD) failures.push('Monthly cost hard stop exceeded.');
  if (failures.length) throw new Error(failures.join(' '));
  return { passed: true, failures: [] };
}
