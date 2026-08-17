import { extractCompanies, RECOMMENDATION_RULE_VERSION } from './extraction.mjs';
import { classifySource } from './source.mjs';
import { validateMeasurementRecord, validateRawProviderEnvelope } from './schema.mjs';

export const LIVE_DISABLED_MESSAGE = 'Live provider execution is disabled in Measurement Pipeline v1.';

export class ProviderAdapter {
  getProviderInfo() { throw new Error('getProviderInfo() must be implemented.'); }
  estimateCost() { throw new Error('estimateCost() must be implemented.'); }
  validateRequest() { throw new Error('validateRequest() must be implemented.'); }
  async fetchRaw() { throw new Error(LIVE_DISABLED_MESSAGE); }
  normalizeProviderResponse() { throw new Error('normalizeProviderResponse() must be implemented.'); }
}

export class ProviderRegistry {
  #adapters = new Map();
  register(adapter) { this.#adapters.set(adapter.getProviderInfo().provider, adapter); return this; }
  get(provider) {
    const adapter = this.#adapters.get(provider);
    if (!adapter) throw new Error(`Unknown provider: ${provider}`);
    return adapter;
  }
}

export class PerplexityFixtureAdapter extends ProviderAdapter {
  constructor({ registry, fixtureLoader }) { super(); this.registry = registry; this.fixtureLoader = fixtureLoader; }
  getProviderInfo() { return { provider: 'perplexity', model: 'sonar', searchContextSize: 'low', fixtureOnly: true }; }
  estimateCost(plan) {
    const requests = plan.queries.length * plan.repetitions;
    return { requests, min: requests * 0.005, standard: requests * 0.0057, max: requests * 0.013, currency: 'USD' };
  }
  validateRequest(plan) {
    if (plan.mode === 'live') throw new Error(LIVE_DISABLED_MESSAGE);
    if (plan.provider !== 'perplexity' || plan.model !== 'sonar') throw new Error('Measurement Pipeline v1 supports only perplexity/sonar.');
    if (plan.searchContextSize !== 'low') throw new Error('Measurement Pipeline v1 requires low search context.');
    return true;
  }
  async fetchRaw(plan) {
    this.validateRequest(plan);
    if (plan.mode !== 'fixture') throw new Error(LIVE_DISABLED_MESSAGE);
    const payload = structuredClone(this.fixtureLoader(plan.query, plan.repetition));
    return validateRawProviderEnvelope({ schemaVersion: '1.0', id: `raw-${plan.runId}-${plan.query.id}-r${plan.repetition}`, provider: 'perplexity', receivedAt: plan.now, payload });
  }
  normalizeProviderResponse({ rawEnvelope, runId, market, query, repetition, requestedAt }) {
    const payload = rawEnvelope.payload;
    const status = payload.fixtureStatus || 'success';
    const failed = status === 'failed';
    const answerText = failed ? '' : payload.choices?.[0]?.message?.content || '';
    const searchResults = failed ? [] : Array.isArray(payload.search_results) ? payload.search_results : [];
    const citations = searchResults.map(item => {
      const classified = classifySource(item.url, this.registry);
      return { url: item.url, canonicalUrl: classified.canonicalUrl, domain: classified.domain, title: item.title || '', sourceType: classified.sourceType };
    });
    const usage = payload.usage || {};
    return validateMeasurementRecord({
      schemaVersion: '1.0', id: `measurement-${runId}-${query.id}-r${repetition}`, runId,
      marketId: market.id, queryId: query.id, queryText: query.text, queryIntent: query.intent, queryStyle: query.style,
      provider: 'perplexity', model: payload.model || 'sonar', modelVersion: null, repetition,
      requestedAt, measuredAt: rawEnvelope.receivedAt, durationMs: 0, status,
      failure: failed ? (payload.fixtureError || { code: 'fixture_failure', message: 'Fixture failure.', retryable: false }) : null,
      answerText, answerLanguage: 'ja', companies: failed ? [] : extractCompanies(answerText, this.registry, citations), citations,
      citationStatus: failed ? 'unavailable' : citations.length ? 'present' : 'absent',
      usage: { inputTokens: usage.prompt_tokens ?? null, outputTokens: usage.completion_tokens ?? null, searchQueries: searchResults.length || null },
      cost: { currency: 'USD', estimated: 0, reported: 0 },
      providerMetadata: { responseId: payload.id || null, searchContextSize: 'low', recommendationRuleVersion: RECOMMENDATION_RULE_VERSION },
      rawResponseRef: rawEnvelope.id
    });
  }
}
