import { PaidAdapter } from './paid-pipeline.mjs';
import { OPENAI_ENDPOINT, OPENAI_MODEL } from './openai.mjs';

export class OpenAiPaidAdapter extends PaidAdapter {
  constructor(options = {}) { super({ ...options, channel: 'chatgpt' }); }
  estimateCost() { return 0.0122; }
  async execute(input, env) {
    this.assertLive(env);
    if (!env.OPENAI_API_KEY) { const error = new Error('OPENAI_API_KEY is not configured.'); error.code = 'authentication'; error.fatal = true; throw error; }
    let response;
    try { response = await this.fetchImpl(OPENAI_ENDPOINT, { method: 'POST', headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({
      model: OPENAI_MODEL, input: input.question_text,
      instructions: 'Web検索結果を踏まえ、質問へ日本語で簡潔かつ具体的に回答してください。候補企業名と判断理由を明記し、確認できないことは断定しないでください。',
      tools: [{ type: 'web_search' }], tool_choice: 'required', include: ['web_search_call.action.sources'],
      max_output_tokens: 2000, store: false
    }) }); }
    catch { const error = new Error('OpenAI network request failed.'); error.code = 'network'; error.retryable = true; throw error; }
    const payload = await response.json();
    if (!response.ok) { const error = new Error(`OpenAI request failed with HTTP ${response.status}.`); error.code = response.status === 429 ? 'rate_limit' : response.status === 401 ? 'authentication' : 'provider_error'; error.retryable = response.status === 429 || response.status >= 500; error.fatal = !error.retryable; throw error; }
    const output = payload.output || [];
    const parts = output.flatMap(item => item.type === 'message' ? item.content || [] : []).filter(item => item.type === 'output_text');
    const raw_answer = String(payload.output_text || parts.map(item => item.text || '').join('\n')).trim(); const sources = [];
    for (const part of parts) for (const item of part.annotations || []) if (item.type === 'url_citation') sources.push({ url: item.url_citation?.url || item.url, title: item.url_citation?.title || item.title, evidence: 'citation' });
    for (const call of output.filter(item => item.type === 'web_search_call')) for (const item of call.action?.sources || []) sources.push({ url: item.url, title: item.title, evidence: 'source' });
    const usage = payload.usage || {}; const searchQueries = (payload.output || []).filter(item => item.type === 'web_search_call').length;
    const estimated_cost = searchQueries * .01 + (usage.input_tokens || 0) * .2 / 1e6 + (usage.output_tokens || 0) * 1.2 / 1e6;
    const providerMetadata = { model: payload.model || OPENAI_MODEL, store: false, response_status: payload.status || null,
      incomplete_details: payload.incomplete_details || null, output_types: output.map(item => item.type),
      message_count: output.filter(item => item.type === 'message').length, output_text_present: Boolean(raw_answer), max_output_tokens: payload.max_output_tokens ?? 2000 };
    if (!raw_answer) {
      const error = new Error(`OpenAI returned no answer text (${payload.incomplete_details?.reason || payload.status || 'unknown'}).`);
      error.code = payload.status === 'incomplete' ? 'incomplete_response' : 'empty_response'; error.fatal = true;
      error.providerMetadata = { ...providerMetadata, source_count: sources.length, usage };
      throw error;
    }
    return this.normalize(input, { raw_answer, sources, usage: { input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0, search_queries: searchQueries }, estimated_cost, raw_response_ref: payload.id || null, measured_at: this.now(), provider_metadata: providerMetadata });
  }
}
