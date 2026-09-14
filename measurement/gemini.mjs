import { PaidAdapter } from './paid-pipeline.mjs';

export const GEMINI_MODEL = 'gemini-3.5-flash';
export const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const INPUT_PER_MILLION = 1.5, OUTPUT_PER_MILLION = 9;
const retryAfterMs = response => {
  const value = response.headers?.get?.('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
};
const permanentQuota = payload => /(?:per day|daily|billing|quota[^\n]*(?:zero|0))/iu.test(JSON.stringify(payload?.error || payload || {}));

export class GeminiPaidAdapter extends PaidAdapter {
  constructor(options = {}) { super({ ...options, channel: 'gemini' }); }
  estimateCost() { return 0.016; }
  async execute(input, env) {
    this.assertLive(env);
    if (!env.GEMINI_API_KEY) { const error = new Error('GEMINI_API_KEY is not configured.'); error.code = 'authentication'; error.fatal = true; throw error; }
    let response;
    try { response = await this.fetchImpl(GEMINI_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: JSON.stringify({ contents: [{ parts: [{ text: input.question_text }] }], tools: [{ google_search: {} }] }) }); }
    catch { const error = new Error('Gemini network request failed.'); error.code = 'network'; error.retryable = true; throw error; }
    const payload = await response.json();
    if (!response.ok) {
      const providerError = payload?.error || {};
      const error = new Error(`Gemini request failed with HTTP ${response.status}: ${providerError.message || providerError.status || 'unknown error'}`);
      error.code = response.status === 429 ? 'rate_limit' : response.status === 408 ? 'timeout' : response.status === 401 || response.status === 403 ? 'authentication' : 'provider_error';
      error.retryAfterMs = retryAfterMs(response);
      error.retryable = (response.status === 408 || response.status === 429 || response.status >= 500) && !permanentQuota(payload);
      error.fatal = !error.retryable;
      error.providerMetadata = { http_status: response.status, provider_error_status: providerError.status || null,
        provider_error_code: providerError.code || null, provider_error_message: providerError.message || null,
        provider_error_details: providerError.details || [], permanent_quota: permanentQuota(payload) };
      throw error;
    }
    const candidate = payload.candidates?.[0] || {}; const metadata = candidate.groundingMetadata || {};
    const raw_answer = (candidate.content?.parts || []).map(part => part.text || '').join('\n');
    const supports = metadata.groundingSupports || [];
    const sources = (metadata.groundingChunks || []).map((chunk, index) => ({ url: chunk.web?.uri, title: chunk.web?.title, citation_text: supports.filter(item => item.groundingChunkIndices?.includes(index)).map(item => item.segment?.text).filter(Boolean).join(' '), evidence: 'citation' }));
    const usage = payload.usageMetadata || {}; const inputTokens = usage.promptTokenCount || 0, outputTokens = usage.candidatesTokenCount || 0;
    return this.normalize(input, { raw_answer, sources, usage: { input_tokens: inputTokens, output_tokens: outputTokens, search_queries: metadata.webSearchQueries?.length || 0 }, estimated_cost: inputTokens * INPUT_PER_MILLION / 1e6 + outputTokens * OUTPUT_PER_MILLION / 1e6, raw_response_ref: payload.responseId || null, measured_at: this.now(), provider_metadata: { model: GEMINI_MODEL, grounding_metadata: metadata } });
  }
}
