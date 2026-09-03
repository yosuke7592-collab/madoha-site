import { PaidAdapter } from './paid-pipeline.mjs';

export const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3/serp/google/ai_mode';
function normalizeResult(adapter, input, payload, fallbackCost = 0) {
  const task = payload.tasks?.[0] || {}; const items = task.result?.[0]?.items || [];
  const ai = items.find(item => item.type === 'ai_overview') || {};
  const raw_answer = ai.text || (ai.items || []).map(item => item.text || '').join('\n');
  const sources = (ai.references || []).map(item => ({ url: item.url, title: item.title || item.source, citation_text: item.text, evidence: 'citation' }));
  return adapter.normalize(input, { raw_answer, sources, usage: { tasks: 1 }, estimated_cost: task.cost || input.existing_measurement?.estimated_cost || fallbackCost, raw_response_ref: task.id || input.existing_measurement?.raw_response_ref || null, measured_at: adapter.now(), provider_metadata: { retrieval_mode: adapter.retrievalMode } });
}
export class GoogleAiModePaidAdapter extends PaidAdapter {
  constructor({ retrievalMode = 'standard', ...options } = {}) { super({ ...options, channel: 'google_ai_mode' }); this.retrievalMode = retrievalMode; }
  estimateCost(input) { return input?.existing_measurement?.provider_metadata?.pending ? 0 : this.retrievalMode === 'live' ? 0.004 : 0.0012; }
  async execute(input, env) {
    this.assertLive(env);
    if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) { const error = new Error('DataForSEO credentials are not configured.'); error.code = 'authentication'; error.fatal = true; throw error; }
    const auth = btoa(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`);
    const pendingId = input.existing_measurement?.provider_metadata?.pending && input.existing_measurement.raw_response_ref;
    const mode = pendingId ? `task_get/advanced/${encodeURIComponent(pendingId)}` : this.retrievalMode === 'live' ? 'live/advanced' : 'task_post';
    let response;
    try { response = await this.fetchImpl(`${DATAFORSEO_BASE}/${mode}`, pendingId ? { method: 'GET', headers: { authorization: `Basic ${auth}` } } : { method: 'POST', headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' }, body: JSON.stringify([{ keyword: input.question_text, language_code: String(input.locale).toLowerCase().startsWith('ja') ? 'ja' : 'en', location_name: input.location }]) }); }
    catch { const error = new Error('DataForSEO network request failed.'); error.code = 'network'; error.retryable = true; throw error; }
    const payload = await response.json();
    if (!response.ok || Number(payload.status_code) >= 40000) { const code = response.status === 429 ? 'rate_limit' : response.status === 401 ? 'authentication' : 'provider_error'; const error = new Error(`DataForSEO request failed: ${payload.status_message || response.status}`); error.code = code; error.retryable = response.status === 429 || response.status >= 500; error.fatal = !error.retryable; throw error; }
    if (this.retrievalMode !== 'live' && !pendingId) return this.normalize(input, { raw_answer: '', sources: [], usage: { queued: true }, estimated_cost: this.estimateCost(input), raw_response_ref: payload.tasks?.[0]?.id || null, measured_at: this.now(), provider_metadata: { retrieval_mode: 'standard', pending: true } });
    if (pendingId && !payload.tasks?.[0]?.result?.length) return this.normalize(input, { raw_answer: '', sources: [], usage: { queued: true }, estimated_cost: input.existing_measurement.estimated_cost, raw_response_ref: pendingId, measured_at: this.now(), provider_metadata: { retrieval_mode: 'standard', pending: true } });
    return normalizeResult(this, input, payload, this.estimateCost(input));
  }
}
