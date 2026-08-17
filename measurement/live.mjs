import { ProviderAdapter } from './provider.mjs';
import { extractCompanies, RECOMMENDATION_RULE_VERSION } from './extraction.mjs';
import { classifySource } from './source.mjs';
import { validateMeasurementRecord, validateRawProviderEnvelope } from './schema.mjs';
import { GUARDRAILS } from './guardrails.mjs';

export const PERPLEXITY_ENDPOINT = 'https://api.perplexity.ai/v1/sonar';
export const KEY_MISSING_MESSAGE = 'PERPLEXITY_API_KEY is not configured.';

const safeFailure = (category, status, retryable, message) => ({ category, httpStatus: status, retryable, message });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function responseMetadata(response, attempts, durationMs) {
  const get = name => response?.headers?.get?.(name) || null;
  return {
    httpStatus: response?.status ?? null, attempts, durationMs,
    rateLimit: {
      retryAfter: get('retry-after'), limit: get('x-ratelimit-limit'),
      remaining: get('x-ratelimit-remaining'), reset: get('x-ratelimit-reset')
    }
  };
}

export class PerplexityLiveAdapter extends ProviderAdapter {
  constructor({ registry, fetchImpl = globalThis.fetch, apiKeyProvider = () => process.env.PERPLEXITY_API_KEY, sleep = delay, timeoutMs = 15_000, now = () => new Date().toISOString() }) {
    super(); this.registry = registry; this.fetchImpl = fetchImpl; this.apiKeyProvider = apiKeyProvider;
    this.sleep = sleep; this.timeoutMs = timeoutMs; this.now = now;
  }
  getProviderInfo() { return { provider: 'perplexity', model: 'sonar', searchContextSize: 'low', fixtureOnly: false }; }
  estimateCost(plan) {
    const requests = plan.queries.length * plan.repetitions;
    return { requests, min: requests * .005, standard: requests * .0057, max: requests * .013, currency: 'USD' };
  }
  validateRequest(plan) {
    if (plan.mode !== 'live') throw new Error('PerplexityLiveAdapter accepts live mode only.');
    if (plan.provider !== 'perplexity' || plan.model !== 'sonar') throw new Error('Live adapter supports only perplexity/sonar.');
    if (plan.searchContextSize !== GUARDRAILS.SEARCH_CONTEXT_SIZE) throw new Error('Live adapter requires low search context.');
    if (!this.apiKeyProvider()) throw new Error(KEY_MISSING_MESSAGE);
    return true;
  }
  buildRequest(plan) {
    this.validateRequest(plan);
    return {
      url: PERPLEXITY_ENDPOINT,
      init: {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKeyProvider()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          model: 'sonar', messages: [{ role: 'user', content: plan.query.text }], stream: false,
          max_tokens: GUARDRAILS.MAX_OUTPUT_TOKENS, language_preference: 'ja',
          web_search_options: { search_context_size: 'low' }
        })
      }
    };
  }
  async fetchRaw(plan) {
    const request = this.buildRequest(plan);
    const started = Date.now();
    let attempts = 0;
    while (attempts <= GUARDRAILS.MAX_RETRIES_PER_REQUEST) {
      if (plan.requestBudget && !plan.requestBudget.consume()) {
        return this.#failureEnvelope(plan, safeFailure('guardrail', null, false, 'Live network request budget exhausted.'), null, attempts, Date.now() - started);
      }
      attempts += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response;
      try {
        response = await this.fetchImpl(request.url, { ...request.init, signal: controller.signal });
      } catch (error) {
        clearTimeout(timeout);
        const timeoutFailure = error?.name === 'AbortError';
        return this.#failureEnvelope(plan, safeFailure(timeoutFailure ? 'timeout' : 'network', null, timeoutFailure, timeoutFailure ? 'Perplexity request timed out.' : 'Perplexity network request failed.'), null, attempts, Date.now() - started);
      }
      clearTimeout(timeout);
      let payload;
      try { payload = await response.json(); }
      catch { return this.#failureEnvelope(plan, safeFailure('malformed_json', response.status, false, 'Perplexity returned malformed JSON.'), null, attempts, Date.now() - started); }
      if (response.ok) {
        return validateRawProviderEnvelope({
          schemaVersion: '1.0', id: `raw-${plan.runId}-${plan.query.id}-r${plan.repetition}`, provider: 'perplexity',
          receivedAt: this.now(), payload, metadata: responseMetadata(response, attempts, Date.now() - started)
        });
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempts <= GUARDRAILS.MAX_RETRIES_PER_REQUEST) {
        const retryAfter = Number(response.headers?.get?.('retry-after'));
        await this.sleep(Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 5000) : 250 * attempts);
        continue;
      }
      const category = response.status === 401 ? 'authentication' : response.status === 429 ? 'rate_limit' : response.status >= 500 ? 'provider' : 'http';
      return this.#failureEnvelope(plan, safeFailure(category, response.status, retryable, `Perplexity request failed with HTTP ${response.status}.`), payload, attempts, Date.now() - started, response);
    }
  }
  #failureEnvelope(plan, failure, payload, attempts, durationMs, response = null) {
    return validateRawProviderEnvelope({
      schemaVersion: '1.0', id: `raw-${plan.runId}-${plan.query.id}-r${plan.repetition}`, provider: 'perplexity', receivedAt: this.now(),
      payload: { providerFailure: failure, providerError: payload ?? null }, metadata: responseMetadata(response, attempts, durationMs)
    });
  }
  normalizeProviderResponse({ rawEnvelope, runId, market, query, repetition, requestedAt, estimatedCost = null }) {
    const payload = rawEnvelope.payload || {};
    const failure = payload.providerFailure || null;
    const answerText = failure ? '' : payload.choices?.[0]?.message?.content || '';
    const status = failure ? 'failed' : answerText ? 'success' : 'partial';
    const results = Array.isArray(payload.search_results) ? payload.search_results : [];
    const resultByUrl = new Map(results.map(item => [item.url, item]));
    const urls = [...new Set([...(Array.isArray(payload.citations) ? payload.citations : []), ...results.map(item => item.url)].filter(Boolean))];
    const citations = failure ? [] : urls.map(url => {
      const item = resultByUrl.get(url) || {};
      const classified = classifySource(url, this.registry);
      return { url, canonicalUrl: classified.canonicalUrl, domain: classified.domain, title: item.title || '', sourceType: classified.sourceType };
    });
    const usage = payload.usage || {};
    const reported = Number.isFinite(Number(usage.cost?.total_cost)) ? Number(usage.cost.total_cost) : null;
    return validateMeasurementRecord({
      schemaVersion: '1.0', id: `measurement-${runId}-${query.id}-r${repetition}`, runId,
      marketId: market.id, queryId: query.id, queryText: query.text, queryIntent: query.intent, queryStyle: query.style,
      provider: 'perplexity', model: payload.model || 'sonar', modelVersion: null, repetition,
      requestedAt, measuredAt: rawEnvelope.receivedAt, durationMs: rawEnvelope.metadata?.durationMs ?? null,
      status, failure, answerText, answerLanguage: 'ja',
      companies: failure ? [] : extractCompanies(answerText, this.registry, citations), citations,
      citationStatus: failure ? 'unavailable' : citations.length ? 'present' : 'absent',
      usage: { inputTokens: usage.prompt_tokens ?? null, outputTokens: usage.completion_tokens ?? null, searchQueries: usage.num_search_queries ?? results.length ?? null },
      cost: { currency: 'USD', estimated: estimatedCost, reported },
      providerMetadata: {
        responseId: payload.id || null, searchContextSize: usage.search_context_size || 'low',
        finishReason: payload.choices?.[0]?.finish_reason || null, attempts: rawEnvelope.metadata?.attempts ?? null,
        rateLimit: rawEnvelope.metadata?.rateLimit || null, recommendationRuleVersion: RECOMMENDATION_RULE_VERSION
      }, rawResponseRef: rawEnvelope.id
    });
  }
}
