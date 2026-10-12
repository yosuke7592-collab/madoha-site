import { PaidAdapter } from './paid-pipeline.mjs';

export const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3/serp/google/ai_mode';
export const DATAFORSEO_LOCATIONS_URL = 'https://api.dataforseo.com/v3/serp/google/locations/jp';
export const DATAFORSEO_LANGUAGES_URL = 'https://api.dataforseo.com/v3/serp/google/ai_mode/languages';
export const DATAFORSEO_JAPAN_LOCATION = Object.freeze({ locationName: 'Japan', locationCode: 2392 });
const fatal = (message, code, providerMetadata = {}) => Object.assign(new Error(message), { code, fatal: true, retryable: false, providerMetadata });
const isTransientDataForSeoStatus = statusCode => {
  const code = Number(statusCode);
  return Number.isInteger(code) && code >= 50000 && code < 60000;
};
const retryAfterMs = response => {
  const value = response?.headers?.get?.('retry-after');
  if (value === null || value === undefined || String(value).trim() === '') return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 30_000) : undefined;
};
const rows = payload => Array.isArray(payload?.tasks?.[0]?.result) ? payload.tasks[0].result : [];
const responseJson = response => response.json().catch(() => ({}));
const catalogStatus = (response, payload) => ({
  http_status: Number(response?.status) || null,
  api_status_code: Number(payload?.status_code) || null,
  api_status_message: typeof payload?.status_message === 'string' ? payload.status_message : null,
  task_status_code: Number(payload?.tasks?.[0]?.status_code) || null,
  task_status_message: typeof payload?.tasks?.[0]?.status_message === 'string' ? payload.tasks[0].status_message : null
});

export function resolveDataForSeoTarget(input) {
  const entity = input?.entity || {}; let locationName = String(entity.api_location_name || '').trim();
  let locationCode = Number(entity.api_location_code); const diagnosisRegion = typeof entity.diagnosis_region === 'string' ? entity.diagnosis_region : (Array.isArray(entity.diagnosis_region) ? entity.diagnosis_region[0] : ''); const displayRegion = String(input?.location || diagnosisRegion || entity.display_region || '').trim();
  const languageCode = String(entity.api_language_code || (String(input?.locale).toLowerCase().startsWith('ja') ? 'ja' : 'en')).trim();
  const missingName = !locationName; const missingCode = !Number.isInteger(locationCode) || locationCode <= 0;
  if (missingName && missingCode && languageCode === 'ja') {
    ({ locationName, locationCode } = DATAFORSEO_JAPAN_LOCATION);
  }
  if (!locationName || !Number.isInteger(locationCode) || locationCode <= 0) throw fatal('DataForSEOの正式なAPI locationが設定されていません。', 'invalid_location');
  return { displayRegion, locationName, locationCode, languageCode };
}

export async function validateDataForSeoTarget(fetchImpl, authorization, target) {
  const headers = { authorization }; const [locationResponse, languageResponse] = await Promise.all([
    fetchImpl(DATAFORSEO_LOCATIONS_URL, { method: 'GET', headers }), fetchImpl(DATAFORSEO_LANGUAGES_URL, { method: 'GET', headers })
  ]);
  const [locationPayload, languagePayload] = await Promise.all([responseJson(locationResponse), responseJson(languageResponse)]);
  const providerMetadata = {
    locations: catalogStatus(locationResponse, locationPayload),
    languages: catalogStatus(languageResponse, languagePayload)
  };
  if (!locationResponse.ok || !languageResponse.ok) throw fatal('DataForSEO location/language一覧を確認できませんでした。', 'preflight_failed', providerMetadata);
  if ((providerMetadata.locations.api_status_code && providerMetadata.locations.api_status_code !== 20000)
    || (providerMetadata.languages.api_status_code && providerMetadata.languages.api_status_code !== 20000)) {
    throw fatal('DataForSEO location/language一覧がエラーを返しました。', 'preflight_failed', providerMetadata);
  }
  const location = rows(locationPayload).find(item => Number(item.location_code) === target.locationCode && item.location_name === target.locationName);
  const language = rows(languagePayload).find(item => item.language_code === target.languageCode);
  if (!location) throw fatal(`DataForSEOで無効なlocationです: ${target.locationName} (${target.locationCode})`, 'invalid_location');
  if (!language) throw fatal(`DataForSEOで無効なlanguageです: ${target.languageCode}`, 'invalid_language');
  return { location, language };
}

export async function inspectDataForSeoPreflight(fetchImpl, authorization) {
  const headers = { authorization }; const [locationResponse, languageResponse] = await Promise.all([
    fetchImpl(DATAFORSEO_LOCATIONS_URL, { method: 'GET', headers }), fetchImpl(DATAFORSEO_LANGUAGES_URL, { method: 'GET', headers })
  ]);
  const [locationPayload, languagePayload] = await Promise.all([responseJson(locationResponse), responseJson(languageResponse)]);
  const location = rows(locationPayload).find(item => Number(item.location_code) === 2392 && item.location_name === 'Japan');
  const language = rows(languagePayload).find(item => item.language_code === 'ja');
  return {
    locations: { ...catalogStatus(locationResponse, locationPayload), target_found: Boolean(location) },
    languages: { ...catalogStatus(languageResponse, languagePayload), target_found: Boolean(language) }
  };
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
    if (!response.ok || Number(payload.status_code) >= 40000) {
      const apiStatusCode = Number(payload.status_code) || null;
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500 || isTransientDataForSeoStatus(apiStatusCode);
      const code = response.status === 429 ? 'rate_limit' : response.status === 401 || response.status === 403 ? 'authentication' : 'provider_error';
      const error = new Error(`DataForSEO request failed: ${payload.status_message || response.status}`);
      error.code = code; error.retryable = retryable; error.fatal = !retryable; error.retryAfterMs = retryAfterMs(response);
      error.providerMetadata = { retrieval_mode: this.retrievalMode, http_status: Number(response.status) || null,
        api_status_code: apiStatusCode, api_status_message: payload.status_message || null };
      throw error;
    }
    const task = payload.tasks?.[0];
    if (Number(task?.status_code) >= 40000) {
      const taskStatusCode = Number(task.status_code);
      const providerMetadata = { retrieval_mode: this.retrievalMode, task_status_code: taskStatusCode,
        task_status_message: task.status_message || null, task_time: task.time || null, task_cost: task.cost || 0, result_count: task.result_count || 0 };
      if (isTransientDataForSeoStatus(taskStatusCode)) {
        const error = new Error(`DataForSEO task failed: ${task.status_message || taskStatusCode}`);
        error.code = 'provider_task_error'; error.retryable = true; error.fatal = false; error.providerMetadata = providerMetadata;
        throw error;
      }
      throw fatal(`DataForSEO task failed: ${task.status_message || taskStatusCode}`, taskStatusCode === 40401 ? 'task_not_found' : 'provider_task_error', providerMetadata);
    }
    if (this.retrievalMode !== 'live' && !pendingId) return this.normalize(input, { raw_answer: '', sources: [], usage: { queued: true }, estimated_cost: this.estimateCost(input), raw_response_ref: task?.id || null, measured_at: this.now(), provider_metadata: { retrieval_mode: 'standard', pending: true, display_region: target.displayRegion, api_location_name: target.locationName, api_location_code: target.locationCode } });
    if (pendingId && !task?.result?.length) return this.normalize(input, { raw_answer: '', sources: [], usage: { queued: true }, estimated_cost: input.existing_measurement.estimated_cost, raw_response_ref: pendingId, measured_at: this.now(), provider_metadata: { ...input.existing_measurement.provider_metadata, retrieval_mode: 'standard', pending: true } });
    target ||= { displayRegion: input.existing_measurement?.provider_metadata?.display_region || input.location || '', locationName: input.existing_measurement?.provider_metadata?.api_location_name || '', locationCode: input.existing_measurement?.provider_metadata?.api_location_code || 0, languageCode: input.existing_measurement?.provider_metadata?.language_code || 'ja' };
    return normalizeResult(this, input, payload, target, this.estimateCost(input));
  }
}
