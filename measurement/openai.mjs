import { ProviderAdapter } from './provider.mjs';
import { extractCompanies, RECOMMENDATION_RULE_VERSION } from './extraction.mjs';
import { classifySource } from './source.mjs';
import { validateMeasurementRecord, validateRawProviderEnvelope } from './schema.mjs';
import { OPENAI_GUARDRAILS } from './guardrails.mjs';

export const OPENAI_ENDPOINT = 'https://api.openai.com/v1/responses';
export const OPENAI_MODEL = 'gpt-5.6-luna';
export const OPENAI_KEY_MISSING_MESSAGE = 'OPENAI_API_KEY is not configured.';
export const OPENAI_PRICING = Object.freeze({
  pricingVersion: 'openai-api-pricing-2026-08-20', checkedAt: '2026-08-20', currency: 'USD',
  model: OPENAI_MODEL, inputPerMillionTokens: 0.20, outputPerMillionTokens: 1.20,
  webSearchPerThousandCalls: 10.00
});

const profiles = {
  min: { inputTokens: 2150, outputTokens: 200 },
  standard: { inputTokens: 8250, outputTokens: 400 },
  max: { inputTokens: 16500, outputTokens: 600 }
};
const round = value => Math.round(value * 1_000_000) / 1_000_000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const permanent429Codes = new Set(['insufficient_quota', 'billing_not_active', 'billing_hard_limit_reached', 'model_not_found', 'model_not_allowed']);
const transient429Codes = new Set(['rate_limit_exceeded', 'requests_per_minute', 'tokens_per_minute']);
const safeText = value => typeof value === 'string' ? value.slice(0, 500) : null;

export function classifyOpenAiError(status, payload = {}) {
  const error = payload?.error && typeof payload.error === 'object' ? payload.error : {};
  const code = safeText(error.code);
  const type = safeText(error.type);
  const message = safeText(error.message);
  if (status !== 429) return { category: status === 401 ? 'authentication' : status >= 500 ? 'provider' : 'http', retryable: status >= 500, systemic: status === 401, code, type, message };
  const marker = `${code || ''} ${type || ''} ${message || ''}`.toLowerCase();
  const permanent = permanent429Codes.has(code) || /insufficient_quota|billing|credit|model.+(access|permission|not found|unsupported)|usage tier/.test(marker);
  const transient = transient429Codes.has(code) || /rate.?limit|requests per min|tokens per min|\brpm\b|\btpm\b/.test(marker);
  return { category: permanent ? (marker.includes('model') ? 'model_access' : 'insufficient_quota') : 'rate_limit', retryable: !permanent && transient, systemic: permanent, code, type, message };
}

function safeRateLimitMetadata(headers) {
  const get = name => safeText(headers?.get?.(name));
  return {
    retryAfter: get('retry-after'),
    requestLimit: get('x-ratelimit-limit-requests'), requestRemaining: get('x-ratelimit-remaining-requests'),
    tokenLimit: get('x-ratelimit-limit-tokens'), tokenRemaining: get('x-ratelimit-remaining-tokens')
  };
}

export function estimateOpenAiCost(plan) {
  const requests = plan.queries.length * plan.repetitions;
  const calculate = profile => requests * (
    OPENAI_PRICING.webSearchPerThousandCalls / 1000 +
    profile.inputTokens * OPENAI_PRICING.inputPerMillionTokens / 1_000_000 +
    profile.outputTokens * OPENAI_PRICING.outputPerMillionTokens / 1_000_000
  );
  return {
    requests, min: round(calculate(profiles.min)), standard: round(calculate(profiles.standard)), max: round(calculate(profiles.max)),
    currency: 'USD', components: {
      webSearch: { calls: requests, unitUsd: OPENAI_PRICING.webSearchPerThousandCalls / 1000 },
      modelInput: { perMillionTokensUsd: OPENAI_PRICING.inputPerMillionTokens, assumptions: Object.fromEntries(Object.entries(profiles).map(([key, value]) => [key, value.inputTokens])) },
      modelOutput: { perMillionTokensUsd: OPENAI_PRICING.outputPerMillionTokens, assumptions: Object.fromEntries(Object.entries(profiles).map(([key, value]) => [key, value.outputTokens])) }
    }, pricing: OPENAI_PRICING
  };
}

function providerInfo(fixtureOnly) {
  return {
    provider: 'openai', model: OPENAI_MODEL, measurementType: 'openai_web_search', displayLabel: 'OpenAI Search',
    consumerProductReference: 'ChatGPT', consumerProductEquivalent: false, fixtureOnly
  };
}

function collectResponse(response) {
  const output = Array.isArray(response.output) ? response.output : [];
  const textParts = output.flatMap(item => item.type === 'message' ? (item.content || []) : []).filter(item => item.type === 'output_text');
  const answerText = textParts.map(item => item.text || '').join('\n');
  const candidates = [];
  for (const part of textParts) for (const annotation of part.annotations || []) {
    if (annotation.type !== 'url_citation') continue;
    const value = annotation.url_citation || annotation;
    candidates.push({ url: value.url, title: value.title || '', evidence: 'citation' });
  }
  for (const call of output.filter(item => item.type === 'web_search_call')) for (const item of call.action?.sources || []) {
    if (item.url) candidates.push({ url: item.url, title: item.title || '', evidence: 'source' });
  }
  const citations = [...new Map(candidates.filter(item => item.url).map(item => [item.url, item])).values()];
  return { answerText, citations, searchCalls: output.filter(item => item.type === 'web_search_call').length };
}

class OpenAiBaseAdapter extends ProviderAdapter {
  constructor({ registry }) { super(); this.registry = registry; }
  getProviderInfo() { return providerInfo(true); }
  estimateCost(plan) { return estimateOpenAiCost(plan); }
  normalizeProviderResponse({ rawEnvelope, runId, market, query, repetition, requestedAt, estimatedCost = 0 }) {
    const payload = rawEnvelope.payload || {};
    const failure = payload.providerFailure || payload.fixtureError || null;
    const parsed = failure ? { answerText: '', citations: [], searchCalls: 0 } : collectResponse(payload);
    const status = failure ? 'failed' : payload.fixtureStatus === 'partial' || payload.status === 'incomplete' || !parsed.answerText ? 'partial' : 'success';
    const citations = parsed.citations.map(item => {
      const classified = classifySource(item.url, this.registry);
      return { ...item, canonicalUrl: classified.canonicalUrl, domain: classified.domain, sourceType: classified.sourceType };
    });
    const usage = payload.usage || {};
    return validateMeasurementRecord({
      schemaVersion: '1.0', id: `measurement-${runId}-${query.id}-r${repetition}`, runId,
      marketId: market.id, queryId: query.id, queryText: query.text, queryIntent: query.intent, queryStyle: query.style,
      provider: 'openai', model: payload.model || OPENAI_MODEL, modelVersion: payload.model || null, repetition,
      requestedAt, measuredAt: rawEnvelope.receivedAt, durationMs: rawEnvelope.metadata?.durationMs ?? 0, status,
      failure: status === 'failed' ? failure : null, answerText: parsed.answerText, answerLanguage: 'ja',
      companies: failure ? [] : extractCompanies(parsed.answerText, this.registry, citations), citations,
      citationStatus: failure ? 'unavailable' : citations.length ? 'present' : 'absent',
      usage: { inputTokens: usage.input_tokens ?? null, outputTokens: usage.output_tokens ?? null, searchQueries: parsed.searchCalls || null },
      cost: { currency: 'USD', estimated: estimatedCost, reported: null },
      providerMetadata: { ...providerInfo(false), responseId: payload.id || null, recommendationRuleVersion: RECOMMENDATION_RULE_VERSION, store: false, attempts: rawEnvelope.metadata?.attempts ?? null },
      rawResponseRef: rawEnvelope.id
    });
  }
}

export class OpenAiFixtureAdapter extends OpenAiBaseAdapter {
  constructor({ registry, fixtureLoader }) { super({ registry }); this.fixtureLoader = fixtureLoader; }
  validateRequest(plan) {
    if (plan.mode === 'live') throw new Error('OpenAI fixture adapter cannot execute live requests.');
    if (plan.provider !== 'openai' || plan.model !== OPENAI_MODEL) throw new Error(`OpenAI fixture adapter supports only openai/${OPENAI_MODEL}.`);
    return true;
  }
  async fetchRaw(plan) {
    this.validateRequest(plan);
    if (plan.mode !== 'fixture') throw new Error('OpenAI fixture adapter accepts fixture mode only.');
    return validateRawProviderEnvelope({ schemaVersion: '1.0', id: `raw-${plan.runId}-${plan.query.id}-r${plan.repetition}`, provider: 'openai', receivedAt: plan.now, payload: structuredClone(this.fixtureLoader(plan.query, plan.repetition)) });
  }
}

export class OpenAiLiveAdapter extends OpenAiBaseAdapter {
  constructor({ registry, fetchImpl = globalThis.fetch, apiKeyProvider = () => process.env.OPENAI_API_KEY, sleep = delay, timeoutMs = 30_000, now = () => new Date().toISOString() }) {
    super({ registry }); this.fetchImpl = fetchImpl; this.apiKeyProvider = apiKeyProvider; this.sleep = sleep; this.timeoutMs = timeoutMs; this.now = now;
  }
  getProviderInfo() { return providerInfo(false); }
  validateRequest(plan) {
    if (plan.mode !== 'live') throw new Error('OpenAiLiveAdapter accepts live mode only.');
    if (plan.provider !== 'openai' || plan.model !== OPENAI_MODEL) throw new Error(`OpenAI live adapter supports only openai/${OPENAI_MODEL}.`);
    if (!this.apiKeyProvider()) throw new Error(OPENAI_KEY_MISSING_MESSAGE);
    return true;
  }
  buildRequest(plan) {
    this.validateRequest(plan);
    return { url: OPENAI_ENDPOINT, init: { method: 'POST', headers: { Authorization: `Bearer ${this.apiKeyProvider()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: OPENAI_MODEL, input: plan.query.text, tools: [{ type: 'web_search' }], tool_choice: 'required', include: ['web_search_call.action.sources'], max_output_tokens: OPENAI_GUARDRAILS.MAX_OUTPUT_TOKENS, store: false }) } };
  }
  async fetchRaw(plan) {
    const request = this.buildRequest(plan); const started = Date.now(); let attempts = 0;
    while (attempts <= OPENAI_GUARDRAILS.MAX_RETRIES_PER_REQUEST) {
      if (plan.requestBudget && !plan.requestBudget.consume()) return this.#failure(plan, { category: 'guardrail', httpStatus: null, retryable: false, message: 'Live network request budget exhausted.' }, attempts, Date.now() - started);
      attempts += 1; const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs); let response;
      try { response = await this.fetchImpl(request.url, { ...request.init, signal: controller.signal }); }
      catch (error) { clearTimeout(timer); return this.#failure(plan, { category: error?.name === 'AbortError' ? 'timeout' : 'network', httpStatus: null, retryable: error?.name === 'AbortError', message: 'OpenAI request failed before a response was received.' }, attempts, Date.now() - started); }
      clearTimeout(timer); let payload;
      try { payload = await response.json(); } catch { return this.#failure(plan, { category: 'malformed_json', httpStatus: response.status, retryable: false, message: 'OpenAI returned malformed JSON.' }, attempts, Date.now() - started); }
      if (response.ok) return validateRawProviderEnvelope({ schemaVersion: '1.0', id: `raw-${plan.runId}-${plan.query.id}-r${plan.repetition}`, provider: 'openai', receivedAt: this.now(), payload, metadata: { httpStatus: response.status, attempts, durationMs: Date.now() - started } });
      const classified = classifyOpenAiError(response.status, payload);
      const rateLimits = safeRateLimitMetadata(response.headers);
      if (classified.retryable && attempts <= OPENAI_GUARDRAILS.MAX_RETRIES_PER_REQUEST) {
        const retryAfter = Number(rateLimits.retryAfter);
        await this.sleep(Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 5000) : 250 * attempts);
        continue;
      }
      return this.#failure(plan, {
        category: classified.category, httpStatus: response.status, retryable: classified.retryable,
        systemic: classified.systemic, code: classified.code, type: classified.type,
        message: classified.message || `OpenAI request failed with HTTP ${response.status}.`
      }, attempts, Date.now() - started, rateLimits);
    }
  }
  createCircuitBreakerEnvelope(plan, cause) {
    return this.#failure(plan, { category: 'circuit_breaker', httpStatus: null, retryable: false, systemic: true, code: cause?.code || null, type: cause?.type || null, message: 'Run aborted after a systemic OpenAI provider error.' }, 0, 0);
  }
  #failure(plan, failure, attempts, durationMs, rateLimits = undefined) {
    return validateRawProviderEnvelope({ schemaVersion: '1.0', id: `raw-${plan.runId}-${plan.query.id}-r${plan.repetition}`, provider: 'openai', receivedAt: this.now(), payload: { providerFailure: failure }, metadata: { attempts, durationMs, ...(rateLimits ? { rateLimits } : {}) } });
  }
}
