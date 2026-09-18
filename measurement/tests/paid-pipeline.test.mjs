import test from 'node:test';
import assert from 'node:assert/strict';
import { D1MeasurementStore, FixturePaidAdapter, LIVE_LOCK_MESSAGE, MemoryMeasurementStore, PaidAdapter, derivePaidEntities, executeWithRetry, measurementsToPaidReport, runPaidMeasurements, sourceObjects, validatePaidMeasurement } from '../paid-pipeline.mjs';
import { OpenAiPaidAdapter } from '../openai-paid.mjs';
import { GeminiPaidAdapter } from '../gemini.mjs';
import { GoogleAiModePaidAdapter, resolveDataForSeoTarget } from '../google-ai-mode.mjs';

const entity = { id: 'kyoudo', name: '株式会社協同住宅', aliases: ['協同住宅'], display_region: '千葉県浦安市・市川市', api_location_name: 'Urayasu,Chiba,Japan', api_location_code: 1009274, api_language_code: 'ja' };
const registry = [entity, { id: 'a', name: '明和地所', canonicalName: '明和地所' }, { id: 'b', name: '富士屋商事', canonicalName: '富士屋商事' }];
const questions = Array.from({ length: 10 }, (_, index) => ({ id: `q${index + 1}`, query: `質問${index + 1}`, intent: index < 6 ? 'discovery' : 'brand', selection_reason: '利用者の検索場面', source_signals: ['official_site'], order: index + 1 }));
const diagnosis = { id: 'd1', run_id: 'r1', entity, locale: 'ja-JP', location: '千葉県浦安市' };
const fixture = input => ({ raw_answer: input.question_id === 'q2' ? '明和地所を確認できます。' : 'おすすめは明和地所です。\n株式会社協同住宅も相談できます。\n富士屋商事もあります。', sources: input.question_id === 'q3' ? [] : [{ url: 'https://kyoudo.jp/about', title: '協同住宅', evidence: 'citation' }], usage: { fixture: true }, raw_response_ref: `raw-${input.channel}-${input.question_id}` });
const adapters = () => Object.fromEntries(['chatgpt', 'gemini', 'google_ai_mode'].map(channel => [channel, new FixturePaidAdapter({ channel, registry, fixtures: fixture })]));

test('common runner creates 30 compatible measurements and preserves query discovery fields', async () => {
  const store = new MemoryMeasurementStore();
  const result = await runPaidMeasurements({ diagnosis, questions, adapters: adapters(), store, maxCost: 1 });
  assert.equal(result.status, 'complete'); assert.equal(result.measurements.length, 30);
  assert.deepEqual(result.cost_by_channel, { chatgpt: 0, gemini: 0, google_ai_mode: 0 }); assert.equal(Object.keys(result.cost_by_question).length, 10);
  assert.ok(result.measurements.every(row => validatePaidMeasurement(row) && row.selection_reason && row.source_signals.length));
  assert.equal(result.measurements.find(row => row.question_id === 'q3').sources.length, 0);
  assert.equal(result.measurements.find(row => row.question_id === 'q2').target_present, false);
});

test('first appearance is position, explicit numbered list alone is rank, and weak candidate wording is not recommendation', () => {
  const ordered = derivePaidEntities('富士屋商事を確認。株式会社協同住宅は候補です。明和地所も対応。', entity, registry);
  assert.equal(ordered.target_position, 2); assert.equal(ordered.company_count, 3); assert.equal(ordered.explicit_rank, null); assert.equal(ordered.recommendation, false);
  const ranked = derivePaidEntities('1. 明和地所\n2. 株式会社協同住宅 — 第一候補としておすすめです。', entity, registry);
  assert.equal(ranked.explicit_rank, 2); assert.equal(ranked.recommendation, true);
});

test('company extraction recognizes candidate headings without treating prose as a company', () => {
  const answer = `## 第一候補：協同住宅（浦安市）\n有力です。\n## 第二候補：アービックグループ（市川市）\n比較候補です。\n## 第三候補：アイ・シー・ジー（浦安市）\n素材重視です。\n## 性能・自然素材重視なら：DAISHU（市川市）\n別の候補です。`;
  const result = derivePaidEntities(answer, entity, registry);
  assert.deepEqual(result.mentioned_entities.map(item => item.name), ['株式会社協同住宅', 'アービックグループ', 'アイ・シー・ジー', 'DAISHU']);
  assert.equal(result.company_count, 4); assert.equal(result.target_position, 1);
});

test('company extraction recognizes bold company bullets followed by a feature label', () => {
  const answer = `*   **協同住宅（きょうどうじゅうたく）**\n    *   **特徴**: 地域密着です。\n*   **豊友ハウジング（ほうゆうはうじんぐ）**\n    *   **特徴**: 一貫対応です。\n*   **積水ハウス / 三井ホームなど**\n    *   **特徴**: 大手です。`;
  const result = derivePaidEntities(answer, entity, registry);
  assert.deepEqual(result.mentioned_entities.map(item => item.name), ['株式会社協同住宅', '豊友ハウジング', '積水ハウス', '三井ホーム']);
  assert.equal(result.company_count, 4); assert.equal(result.explicit_rank, null);
});

test('company extraction recognizes Google AI Mode detail links and local result labels', () => {
  const answer = '不動産SHOPナカジツ（市川・浦安店）特徴 : ワンストップです。\n詳細は 不動産SHOPナカジツ 市川・浦安店 から確認できます。\nスーモカウンター 5.0 (4) 不動産コンサルタント 営業時間外';
  const result = derivePaidEntities(answer, entity, registry);
  assert.deepEqual(result.mentioned_entities.map(item => item.name), ['不動産SHOPナカジツ 市川・浦安店', 'SUUMOカウンター']);
});

test('company extraction handles numbered headings, comparison tables and local business blocks without treating headings as companies', () => {
  const answer = `### 1. 明和地所｜浦安・新浦安\n説明です。\n#### ■ SHUKEN Re（シューケン）\n説明です。\n| **富士屋商事** | 浦安で探したい人 |\n### 3. 地域密着の老舗・総合\n---\n株式会社清田屋不動産 4.5 (8)\n不動産管理会社\n説明です。`;
  const result = derivePaidEntities(answer, entity, registry);
  assert.deepEqual(result.mentioned_entities.map(item => item.name), ['明和地所', 'SHUKEN Re', '富士屋商事', '株式会社清田屋不動産']);
});

test('company extraction keeps similarly prefixed legal entities separate', () => {
  const answer = '**株式会社協同住宅**は浦安市の不動産会社です。\n**協同住宅ローン株式会社**は別会社です。';
  const result = derivePaidEntities(answer, entity, registry);
  assert.equal(result.target_present, true);
  assert.equal(result.mentioned_entities[0].name, '株式会社協同住宅');
  assert.notEqual(result.mentioned_entities[0].name, '協同住宅ローン株式会社');
});

test('only provider sources are stored and missing citations remain empty', () => {
  assert.equal(sourceObjects([], registry).length, 0);
  assert.equal(sourceObjects([{ url: 'https://kyoudo.jp/a', title: '公式' }, { url: 'https://kyoudo.jp/a', title: '重複' }], registry).length, 1);
});

test('resume skips completed measurements without duplicate calls', async () => {
  const store = new MemoryMeasurementStore(); const firstAdapters = adapters();
  await runPaidMeasurements({ diagnosis, questions, adapters: firstAdapters, store, maxCost: 1 });
  const secondAdapters = adapters(); await runPaidMeasurements({ diagnosis, questions, adapters: secondAdapters, store, maxCost: 1 });
  assert.equal(Object.values(secondAdapters).reduce((sum, adapter) => sum + adapter.calls, 0), 0);
});

test('temporary failure retries twice and then saves a localized failure', async () => {
  let calls = 0;
  class RetryAdapter extends FixturePaidAdapter { async execute(input) { calls += 1; if (calls < 3) { const error = new Error('temporary'); error.retryable = true; throw error; } return super.execute(input); } }
  const custom = adapters(); custom.chatgpt = new RetryAdapter({ channel: 'chatgpt', registry, fixtures: fixture, sleepImpl: async () => {} });
  const result = await runPaidMeasurements({ diagnosis, questions: questions.slice(0, 1), adapters: custom, store: new MemoryMeasurementStore(), maxCost: 1 });
  assert.equal(calls, 3); assert.equal(result.measurements.length, 3);
});

test('cost cap stops before the next call and preserves completed rows', async () => {
  class CostAdapter extends PaidAdapter { estimateCost() { return .1; } async execute(input) { return this.normalize(input, { raw_answer: '株式会社協同住宅', estimated_cost: .1 }); } }
  const costAdapters = Object.fromEntries(['chatgpt', 'gemini', 'google_ai_mode'].map(channel => [channel, new CostAdapter({ channel, registry })]));
  const result = await runPaidMeasurements({ diagnosis, questions: questions.slice(0, 2), adapters: costAdapters, store: new MemoryMeasurementStore(), maxCost: .25 });
  assert.equal(result.status, 'stopped'); assert.equal(result.stopped.code, 'cost_cap_exceeded'); assert.equal(result.measurements.length, 2);
});

test('all live adapters fail closed before network access', async () => {
  let network = 0; const fetchImpl = async () => { network += 1; throw new Error('must not run'); };
  const input = { diagnosis_id: 'd', entity, question_id: 'q', question_text: 'q', channel: 'chatgpt', run_id: 'r', max_cost: 1 };
  for (const adapter of [new OpenAiPaidAdapter({ registry, fetchImpl }), new GeminiPaidAdapter({ registry, fetchImpl }), new GoogleAiModePaidAdapter({ registry, fetchImpl })]) {
    await assert.rejects(() => adapter.execute({ ...input, channel: adapter.channel }, {}), new RegExp(LIVE_LOCK_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.equal(network, 0);
});

test('mocked live adapters normalize answers, citations, usage and provider references', async () => {
  const openai = new OpenAiPaidAdapter({ registry, fetchImpl: async () => ({ ok: true, json: async () => ({ id: 'o1', model: 'gpt-5.6-luna', usage: { input_tokens: 10, output_tokens: 5 }, output: [{ type: 'web_search_call', action: { sources: [{ url: 'https://kyoudo.jp', title: '公式' }] } }, { type: 'message', content: [{ type: 'output_text', text: '株式会社協同住宅をおすすめします。', annotations: [] }] }] }) }) });
  const gemini = new GeminiPaidAdapter({ registry, fetchImpl: async () => ({ ok: true, json: async () => ({ responseId: 'g1', candidates: [{ content: { parts: [{ text: '株式会社協同住宅を推奨します。' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://kyoudo.jp', title: '公式' } }], groundingSupports: [] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }) }) });
  const google = new GoogleAiModePaidAdapter({ registry, retrievalMode: 'live', fetchImpl: async url => {
    if (url.includes('/locations/')) return { ok: true, json: async () => ({ tasks: [{ result: [{ location_code: 1009274, location_name: 'Urayasu,Chiba,Japan' }] }] }) };
    if (url.endsWith('/languages')) return { ok: true, json: async () => ({ tasks: [{ result: [{ language_code: 'ja' }] }] }) };
    return { ok: true, json: async () => ({ status_code: 20000, tasks: [{ id: 'a1', cost: .004, result: [{ items: [{ type: 'ai_overview', text: '株式会社協同住宅は有力候補です。', references: [{ url: 'https://kyoudo.jp', title: '公式', text: '引用' }] }] }] }] }) };
  } });
  const env = { MADOHA_ENABLE_LIVE_MEASUREMENT: 'true', OPENAI_API_KEY: 'mock', GEMINI_API_KEY: 'mock', DATAFORSEO_LOGIN: 'mock', DATAFORSEO_PASSWORD: 'mock' };
  for (const adapter of [openai, gemini, google]) {
    const row = await adapter.execute({ diagnosis_id: 'd', entity, question_id: 'q', question_text: '質問', channel: adapter.channel, run_id: 'r', max_cost: 1 }, env);
    assert.ok(row.raw_answer); assert.equal(row.target_present, true); assert.equal(row.sources.length, 1); assert.ok(row.raw_response_ref);
  }
});

test('OpenAI records response diagnostics, uses 2000 output tokens and rejects incomplete empty answers', async () => {
  let requestBody;
  const adapter = new OpenAiPaidAdapter({ registry, fetchImpl: async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ id: 'o-empty', model: 'gpt-5.6-luna', status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' }, max_output_tokens: 600,
      usage: { input_tokens: 100, output_tokens: 600 }, output: [{ type: 'web_search_call', action: { sources: [{ url: 'https://kyoudo.jp' }] } }] }) };
  } });
  await assert.rejects(() => adapter.execute({ diagnosis_id: 'd', entity, question_id: 'q', question_text: '質問', channel: 'chatgpt', run_id: 'r', max_cost: 1 }, { MADOHA_ENABLE_LIVE_MEASUREMENT: 'true', OPENAI_API_KEY: 'mock' }), error => {
    assert.equal(error.code, 'incomplete_response'); assert.equal(error.providerMetadata.response_status, 'incomplete');
    assert.deepEqual(error.providerMetadata.output_types, ['web_search_call']); return true;
  });
  assert.equal(requestBody.max_output_tokens, 2000);
});

test('OpenAI accepts top-level output_text and preserves response status metadata', async () => {
  const adapter = new OpenAiPaidAdapter({ registry, fetchImpl: async () => ({ ok: true, json: async () => ({
    id: 'o-text', model: 'gpt-5.6-luna', status: 'completed', output_text: '株式会社協同住宅を候補として確認できます。',
    usage: { input_tokens: 10, output_tokens: 20 }, output: [{ type: 'message', content: [] }]
  }) }) });
  const row = await adapter.execute({ diagnosis_id: 'd', entity, question_id: 'q', question_text: '質問', channel: 'chatgpt', run_id: 'r', max_cost: 1 }, { MADOHA_ENABLE_LIVE_MEASUREMENT: 'true', OPENAI_API_KEY: 'mock' });
  assert.match(row.raw_answer, /協同住宅/); assert.equal(row.provider_metadata.response_status, 'completed');
});

test('retry honors Retry-After and otherwise uses exponential backoff with jitter', async () => {
  const waits = []; let attempts = 0;
  class RetryTiming extends PaidAdapter {
    estimateCost() { return 0; }
    async execute(input) { attempts += 1; if (attempts < 3) { const error = new Error('retry'); error.retryable = true; if (attempts === 1) error.retryAfterMs = 7000; throw error; } return this.normalize(input, { raw_answer: entity.name, estimated_cost: 0 }); }
  }
  const adapter = new RetryTiming({ channel: 'gemini', registry, sleepImpl: async ms => waits.push(ms), randomImpl: () => 0 });
  await executeWithRetry(adapter, { diagnosis_id: 'd', entity, question_id: 'q', question_text: '質問', channel: 'gemini', run_id: 'r', max_cost: 1 }, {}, { baseDelayMs: 5000 });
  assert.deepEqual(waits, [7000, 15000]);
});

test('Gemini daily quota 429 is classified as permanent and retains provider details', async () => {
  const adapter = new GeminiPaidAdapter({ registry, fetchImpl: async () => ({ ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Per day quota exceeded', details: [{ reason: 'RATE_LIMIT_EXCEEDED' }] } }) }) });
  await assert.rejects(() => adapter.execute({ diagnosis_id: 'd', entity, question_id: 'q', question_text: '質問', channel: 'gemini', run_id: 'r', max_cost: 1 }, { MADOHA_ENABLE_LIVE_MEASUREMENT: 'true', GEMINI_API_KEY: 'mock' }), error => {
    assert.equal(error.code, 'rate_limit'); assert.equal(error.retryable, false); assert.equal(error.fatal, true);
    assert.equal(error.providerMetadata.permanent_quota, true); return true;
  });
});

test('Gemini rejects a successful HTTP response with no answer text', async () => {
  const adapter = new GeminiPaidAdapter({ registry, fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [] }, groundingMetadata: {} }] }) }) });
  await assert.rejects(() => adapter.execute({ diagnosis_id: 'd', entity, question_id: 'q', question_text: '質問', channel: 'gemini', run_id: 'r', max_cost: 1 }, { MADOHA_ENABLE_LIVE_MEASUREMENT: 'true', GEMINI_API_KEY: 'mock' }), error => error.code === 'empty_response' && error.fatal);
});

test('common measurements adapt to the unchanged Web/PDF report shape', async () => {
  const store = new MemoryMeasurementStore();
  const result = await runPaidMeasurements({ diagnosis, questions, adapters: adapters(), store, maxCost: 1 });
  const base = { subject: { name: entity.name }, queries: questions.map((question, index) => ({ id: question.id, query: question.query, kind: index < 6 ? 'nonbrand' : 'branded', channels: [] })) };
  const report = measurementsToPaidReport(base, result.measurements);
  assert.equal(report.queries.length, 10); assert.ok(report.queries.every(query => query.channels.length === 3));
  assert.equal(typeof report.queries[0].channels[0].answer, 'string'); assert.ok(Array.isArray(report.queries[0].channels[0].sources));
});

test('DataForSEO standard mode stores a task and resumes by polling it', async () => {
  const urls = [];
  const adapter = new GoogleAiModePaidAdapter({ registry, retrievalMode: 'standard', fetchImpl: async url => {
    urls.push(url);
    if (url.includes('/locations/')) return { ok: true, json: async () => ({ tasks: [{ result: [{ location_code: 1009274, location_name: 'Urayasu,Chiba,Japan' }] }] }) };
    if (url.endsWith('/languages')) return { ok: true, json: async () => ({ tasks: [{ result: [{ language_code: 'ja' }] }] }) };
    if (url.endsWith('/task_post')) return { ok: true, json: async () => ({ status_code: 20000, tasks: [{ id: 'task-1', cost: .0012 }] }) };
    return { ok: true, json: async () => ({ status_code: 20000, tasks: [{ id: 'task-1', cost: 0, result: [{ items: [{ type: 'ai_overview', text: '株式会社協同住宅を確認できます。', references: [] }] }] }] }) };
  } });
  const env = { MADOHA_ENABLE_LIVE_MEASUREMENT: 'true', DATAFORSEO_LOGIN: 'mock', DATAFORSEO_PASSWORD: 'mock' };
  const input = { diagnosis_id: 'd', entity, question_id: 'q', question_text: '質問', channel: 'google_ai_mode', run_id: 'r', max_cost: 1 };
  const pending = await adapter.execute(input, env); assert.equal(pending.provider_metadata.pending, true);
  const complete = await adapter.execute({ ...input, existing_measurement: pending }, env);
  assert.equal(complete.target_present, true); assert.ok(urls.some(url => /task_get\/advanced\/task-1$/.test(url)));
});

test('DataForSEO separates display region from validated API location and posts Live once', async () => {
  const calls = []; const adapter = new GoogleAiModePaidAdapter({ registry, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/locations/')) return { ok: true, json: async () => ({ tasks: [{ result: [{ location_code: 1009274, location_name: 'Urayasu,Chiba,Japan' }] }] }) };
    if (url.endsWith('/languages')) return { ok: true, json: async () => ({ tasks: [{ result: [{ language_code: 'ja' }] }] }) };
    return { ok: true, json: async () => ({ status_code: 20000, tasks: [{ id: 'live-1', status_code: 20000, cost: .004, result: [{ items: [{ type: 'ai_overview', markdown: '## 回答\n株式会社協同住宅を候補として確認できます。', items: [{ text: '重複させない本文', references: [{ url: 'https://kyoudo.jp/', source: '協同住宅' }] }] }] }] }] }) };
  } });
  const input = { diagnosis_id: 'd', entity, question_id: 'q', question_text: '質問', channel: 'google_ai_mode', run_id: 'r', max_cost: 1, locale: 'ja-JP', location: '千葉県浦安市・市川市' };
  assert.deepEqual(resolveDataForSeoTarget(input), { displayRegion: '千葉県浦安市・市川市', locationName: 'Urayasu,Chiba,Japan', locationCode: 1009274, languageCode: 'ja' });
  const row = await adapter.execute(input, { MADOHA_ENABLE_LIVE_MEASUREMENT: 'true', DATAFORSEO_LOGIN: 'mock', DATAFORSEO_PASSWORD: 'mock' });
  const paidCalls = calls.filter(call => call.url.endsWith('/live/advanced')); assert.equal(paidCalls.length, 1);
  const body = JSON.parse(paidCalls[0].init.body)[0]; assert.equal(body.location_code, 1009274); assert.equal(body.location_name, undefined);
  assert.equal(row.provider_metadata.display_region, '千葉県浦安市・市川市'); assert.equal(row.provider_metadata.api_location_name, 'Urayasu,Chiba,Japan');
  assert.match(row.raw_answer, /^## 回答/u); assert.doesNotMatch(row.raw_answer, /重複させない本文/u); assert.equal(row.sources.length, 1);
});

test('DataForSEO rejects an invalid API location before a paid Live call', async () => {
  const calls = []; const bad = { ...entity, api_location_code: 9999999 };
  const adapter = new GoogleAiModePaidAdapter({ registry, fetchImpl: async url => { calls.push(url); return { ok: true, json: async () => ({ tasks: [{ result: url.includes('/locations/') ? [{ location_code: 1009274, location_name: 'Urayasu,Chiba,Japan' }] : [{ language_code: 'ja' }] }] }) }; } });
  await assert.rejects(() => adapter.execute({ diagnosis_id: 'd', entity: bad, question_id: 'q', question_text: '質問', channel: 'google_ai_mode', run_id: 'r', max_cost: 1 }, { MADOHA_ENABLE_LIVE_MEASUREMENT: 'true', DATAFORSEO_LOGIN: 'mock', DATAFORSEO_PASSWORD: 'mock' }), error => error.code === 'invalid_location');
  assert.equal(calls.some(url => url.endsWith('/live/advanced')), false);
});

test('DataForSEO Live task errors are fatal and do not become measurements', async () => {
  const adapter = new GoogleAiModePaidAdapter({ registry, fetchImpl: async url => {
    if (url.includes('/locations/')) return { ok: true, json: async () => ({ tasks: [{ result: [{ location_code: 1009274, location_name: 'Urayasu,Chiba,Japan' }] }] }) };
    if (url.endsWith('/languages')) return { ok: true, json: async () => ({ tasks: [{ result: [{ language_code: 'ja' }] }] }) };
    return { ok: true, json: async () => ({ status_code: 20000, tasks: [{ status_code: 40501, status_message: 'Invalid Field' }] }) };
  } });
  await assert.rejects(() => adapter.execute({ diagnosis_id: 'd', entity, question_id: 'q', question_text: '質問', channel: 'google_ai_mode', run_id: 'r', max_cost: 1 }, { MADOHA_ENABLE_LIVE_MEASUREMENT: 'true', DATAFORSEO_LOGIN: 'mock', DATAFORSEO_PASSWORD: 'mock' }), error => error.code === 'provider_task_error');
});

test('DataForSEO task-level 40401 is fatal instead of remaining pending', async () => {
  const adapter = new GoogleAiModePaidAdapter({ registry, retrievalMode: 'standard', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({
    status_code: 20000, status_message: 'Ok.', tasks: [{ id: 'missing-task', status_code: 40401, status_message: 'Task Not Found.', time: '0 sec.', cost: 0, result_count: 0, result: null }]
  }) }) });
  const existing_measurement = { raw_response_ref: 'missing-task', estimated_cost: .0012, provider_metadata: { pending: true } };
  await assert.rejects(() => adapter.execute({ diagnosis_id: 'd', entity, question_id: 'q', question_text: '質問', channel: 'google_ai_mode', run_id: 'r', max_cost: 1, existing_measurement }, { MADOHA_ENABLE_LIVE_MEASUREMENT: 'true', DATAFORSEO_LOGIN: 'mock', DATAFORSEO_PASSWORD: 'mock' }), error => {
    assert.equal(error.code, 'task_not_found'); assert.equal(error.fatal, true); assert.equal(error.providerMetadata.task_status_code, 40401); return true;
  });
});

test('D1 store writes and reads the common measurement JSON with an idempotent key', async () => {
  let stored = null; const statements = [];
  const db = { prepare(sql) { statements.push(sql); return { bind(...values) { return { async run() { stored = JSON.parse(values[8]); return { success: true }; }, async first() { return stored ? { measurement_json: JSON.stringify(stored) } : null; }, async all() { return { results: stored ? [{ measurement_json: JSON.stringify(stored) }] : [] }; } }; } }; } };
  const store = new D1MeasurementStore(db);
  const row = (await runPaidMeasurements({ diagnosis, questions: questions.slice(0, 1), adapters: adapters(), store: new MemoryMeasurementStore(), maxCost: 1 })).measurements[0];
  await store.save(row); const read = await store.get(row.diagnosis_id, row.question_id, row.channel);
  assert.equal(read.raw_answer, row.raw_answer); assert.ok(statements.some(sql => sql.includes('ON CONFLICT(diagnosis_id,question_id,channel)')));
});

test('permanent provider failure is saved once and stops without retrying later channels', async () => {
  let calls = 0;
  class FatalAdapter extends PaidAdapter { estimateCost() { return 0; } async execute() { calls += 1; const error = new Error('bad credentials'); error.code = 'authentication'; error.fatal = true; throw error; } }
  const fatalAdapters = adapters(); fatalAdapters.chatgpt = new FatalAdapter({ channel: 'chatgpt', registry });
  const result = await runPaidMeasurements({ diagnosis, questions: questions.slice(0, 1), adapters: fatalAdapters, store: new MemoryMeasurementStore(), maxCost: 1 });
  assert.equal(calls, 1); assert.equal(result.status, 'stopped'); assert.equal(result.measurements.length, 1); assert.equal(result.measurements[0].error.code, 'authentication');
});
