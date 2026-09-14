import { PaidAdapter } from './paid-pipeline.mjs';

export const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3/serp/google/ai_mode';
export const DATAFORSEO_LOCATIONS_URL = 'https://api.dataforseo.com/v3/serp/google/locations/jp';
export const DATAFORSEO_LANGUAGES_URL = 'https://api.dataforseo.com/v3/serp/google/ai_mode/languages';
const fatal = (message, code, providerMetadata = {}) => Object.assign(new Error(message), { code, fatal: true, retryable: false, providerMetadata });
const rows = payload => Array.isArray(payload?.tasks?.[0]?.result) ? payload.tasks[0].result : [];

export function resolveDataForSeoTarget(input) {
  const entity = input?.entity || {}; const locationName = String(entity.api_location_name || '').trim();
  const locationCode = Number(entity.api_location_code); const displayRegion = String(entity.display_region || input?.location || '').trim();
  const languageCode = String(entity.api_language_code || (String(input?.locale).toLowerCase().startsWith('ja') ? 'ja' : 'en')).trim();
  if (!locationName || !Number.isInteger(locationCode) || locationCode <= 0) throw fatal('DataForSEOの正式なAPI locationが設定されていません。', 'invalid_location');
  return { displayRegion, locationName, locationCode, languageCode };
}

export async function validateDataForSeoTarget(fetchImpl, authorization, target) {
  const headers = { authorization }; const [locationResponse, languageResponse] = await Promise.all([
    fetchImpl(DATAFORSEO_LOCATIONS_URL, { method: 'GET', headers }), fetchImpl(DATAFORSEO_LANGUAGES_URL, { method: 'GET', headers })
  ]);
  if (!locationResponse.ok || !languageResponse.ok) throw fatal('DataForSEO location/language一覧を確認できませんでした。', 'preflight_failed');
  const [locationPayload, languagePayload] = await Promise.all([locationResponse.json(), languageResponse.json()]);
  const location = rows(locationPayload).find(item => Number(item.location_code) === target.locationCode && item.location_name === target.locationName);
  const language = rows(languagePayload).find(item => item.language_code === target.languageCode);
  if (!location) throw fatal(`DataForSEOで無効なlocationです: ${target.locationName} (${target.locationCode})`, 'invalid_location');
  if (!language) throw fatal(`DataForSEOで無効なlanguageです: ${target.languageCode}`, 'invalid_language');
  return { location, language };
}

function collectText(value, result = []) {
  if (!value) return result;
  if (typeof value === 'string') { if (value.trim()) result.push(value.trim()); return result; }
  if (Array.isArray(value)) { for (const item of value) collectText(item, result); return result; }
  if (typeof value === 'object') {
    for (const key of ['text', 'title', 'description']) if (typeof value[key] === 'string' && value[key].trim()) result.push(value[key].trim());
    for (const key of ['items', 'sections', 'elements']) if (value[key]) collectText(value[key], result);
  }
  return result;
}

function normalizeResult(adapter, input, payload, target, fallbackCost = 0) {
  const task = payload.tasks?.[0] || {}; const result = task.result?.[0] || {}; const items = result.items || [];
  const ai = items.find(item => ['ai_overview', 'ai_mode'].includes(item.type)) || result.ai_mode || {};
  const raw_answer = String(ai.markdown || '').trim() || [...new Set(collectText(ai))].join('\n');
  const references = [...(ai.references || ai.sources || result.references || []), ...(ai.items || []).flatMap(item => item.references || [])];
  const sources = references.map(item => ({ url: item.url || item.link, title: item.title || item.source, citation_text: item.text || item.snippet, evidence: 'citation' })).filter(item => item.url);
  if (!raw_answer.trim()) throw fatal('Google AI Mode returned no answer text.', 'empty_response', { retrieval_mode: adapter.retrievalMode, task_id: task.id || null, item_types: items.map(item => item.type) });
  return adapter.normalize(input, { raw_answer, sources, usage: { tasks: 1 }, estimated_cost: task.cost || input.existing_measurement?.estimated_cost || fallbackCost,
    raw_response_ref: task.id || input.existing_measurement?.raw_response_ref || null, measured_at: adapter.now(), provider_metadata: {
      retrieval_mode: adapter.retrievalMode, display_region: target.displayRegion, api_location_name: target.locationName,
      api_location_code: target.locationCode, language_code: target.languageCode, task_status_code: task.status_code || null
    } });
}

export class GoogleAiModePaidAdapter extends PaidAdapter {
  constructor({ retrievalMode = 'live', ...options } = {}) { super({ ...options, channel: 'google_ai_mode' }); this.retrievalMode = retrievalMode; }
  estimateCost(input) { return input?.existing_measurement?.provider_metadata?.pending ? 0 : this.retrievalMode === 'live' ? 0.004 : 0.0012; }
  async execute(input, env) {
    this.assertLive(env);
    if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) throw fatal('DataForSEO credentials are not configured.', 'authentication');
    const authorization = `Basic ${btoa(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`)}`;
    const pendingId = input.existing_measurement?.provider_metadata?.pending && input.existing_measurement.raw_response_ref; let target = null;
    if (!pendingId) { target = resolveDataForSeoTarget(input); await validateDataForSeoTarget(this.fetchImpl, authorization, target); }
    const mode = pendingId ? `task_get/advanced/${encodeURIComponent(pendingId)}` : this.retrievalMode === 'live' ? 'live/advanced' : 'task_post'; let response;
    try { response = await this.fetchImpl(`${DATAFORSEO_BASE}/${mode}`, pendingId ? { method: 'GET', headers: { authorization } } : {
      method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify([{
        keyword: input.question_text, language_code: target.languageCode, location_code: target.locationCode, device: 'desktop', os: 'windows'
      }])
    }); } catch { const error = new Error('DataForSEO network request failed.'); error.code = 'network'; error.retryable = true; throw error; }
    const payload = await response.json();
    if (!response.ok || Number(payload.status_code) >= 40000) { const code = response.status === 429 ? 'rate_limit' : response.status === 401 ? 'authentication' : 'provider_error'; const error = new Error(`DataForSEO request failed: ${payload.status_message || response.status}`); error.code = code; error.retryable = response.status === 429 || response.status >= 500; error.fatal = !error.retryable; throw error; }
    const task = payload.tasks?.[0];
    if (Number(task?.status_code) >= 40000) throw fatal(`DataForSEO task failed: ${task.status_message || task.status_code}`, Number(task.status_code) === 40401 ? 'task_not_found' : 'provider_task_error', {
      retrieval_mode: this.retrievalMode, task_status_code: task.status_code, task_status_message: task.status_message || null, task_time: task.time || null, task_cost: task.cost || 0, result_count: task.result_count || 0
    });
    if (this.retrievalMode !== 'live' && !pendingId) return this.normalize(input, { raw_answer: '', sources: [], usage: { queued: true }, estimated_cost: this.estimateCost(input), raw_response_ref: task?.id || null, measured_at: this.now(), provider_metadata: { retrieval_mode: 'standard', pending: true, display_region: target.displayRegion, api_location_name: target.locationName, api_location_code: target.locationCode } });
    if (pendingId && !task?.result?.length) return this.normalize(input, { raw_answer: '', sources: [], usage: { queued: true }, estimated_cost: input.existing_measurement.estimated_cost, raw_response_ref: pendingId, measured_at: this.now(), provider_metadata: { ...input.existing_measurement.provider_metadata, retrieval_mode: 'standard', pending: true } });
    target ||= { displayRegion: input.existing_measurement?.provider_metadata?.display_region || input.location || '', locationName: input.existing_measurement?.provider_metadata?.api_location_name || '', locationCode: input.existing_measurement?.provider_metadata?.api_location_code || 0, languageCode: input.existing_measurement?.provider_metadata?.language_code || 'ja' };
    return normalizeResult(this, input, payload, target, this.estimateCost(input));
  }
}
