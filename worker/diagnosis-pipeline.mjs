import { FixturePaidAdapter, D1MeasurementStore, PAID_CHANNELS, measurementsToPaidReport, runPaidMeasurements } from '../measurement/paid-pipeline.mjs';
import { OpenAiPaidAdapter } from '../measurement/openai-paid.mjs';
import { GeminiPaidAdapter } from '../measurement/gemini.mjs';
import { GoogleAiModePaidAdapter } from '../measurement/google-ai-mode.mjs';

export const MEASUREMENTS_PER_QUEUE_RUN = 3;
export const QUESTION_ERROR = 'confirmed_questions_incomplete';

const parseJson = (value, fallback) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };
const fixture = input => ({
  raw_answer: `候補を確認しました。\n1. ${input.entity.name} — 地域で相談できる会社です。\n2. 比較対象株式会社 — 他の候補です。`,
  sources: [{ url: input.entity.official_url || 'https://example.invalid/', title: `${input.entity.name} 公式サイト`, evidence: 'citation' }],
  usage: { fixture: true }, raw_response_ref: `mock-${input.run_id}-${input.question_id}-${input.channel}`,
  provider_metadata: input.channel === 'google_ai_mode' ? { retrieval_mode: 'standard', mock: true } : { mock: true }
});

class WorkerMockPaidAdapter extends FixturePaidAdapter {
  estimateCost(input) { return Number(input.entity.mock_cost_usd || 0); }
  async execute(input) {
    this.calls += 1;
    if (input.entity.mock_fatal_channel === input.channel) {
      const error = new Error(`${input.channel} mock permanent error`);
      error.code = 'mock_permanent_error'; error.fatal = true; throw error;
    }
    if (input.channel === 'google_ai_mode' && input.entity.mock_google_wait && input.question_order === 1 && !input.existing_measurement?.provider_metadata?.pending) {
      return this.normalize(input, { raw_answer: '', sources: [], usage: { queued: true, mock: true }, estimated_cost: this.estimateCost(input),
        raw_response_ref: `mock-task-${input.diagnosis_id}-${input.question_id}`, measured_at: this.now(),
        provider_metadata: { retrieval_mode: 'standard', pending: true, state: 'submitted', mock: true } });
    }
    const value = structuredClone(this.fixtures(input));
    return this.normalize(input, { ...value, estimated_cost: this.estimateCost(input),
      raw_response_ref: input.existing_measurement?.raw_response_ref || value.raw_response_ref,
      measured_at: value.measured_at || this.now(),
      provider_metadata: { ...value.provider_metadata, state: 'completed', mock: true } });
  }
}

export function createWorkerAdapters(env, registry, options = {}) {
  if ((options.mode || env.MADOHA_MEASUREMENT_MODE) === 'mock') return Object.fromEntries(PAID_CHANNELS.map(channel => [channel, new WorkerMockPaidAdapter({ channel, registry, fixtures: options.fixture || fixture })]));
  return {
    chatgpt: new OpenAiPaidAdapter({ registry }), gemini: new GeminiPaidAdapter({ registry }),
    google_ai_mode: new GoogleAiModePaidAdapter({ registry, retrievalMode: env.DATAFORSEO_RETRIEVAL_MODE || 'standard' })
  };
}

export async function loadConfirmedQuestions(db, diagnosisId) {
  const result = await db.prepare(`SELECT question_id,question_order,question_text,intent,selection_reason,source_signals_json,question_kind,measurement_purpose,confirmed
    FROM diagnosis_questions WHERE diagnosis_id=? ORDER BY question_order`).bind(diagnosisId).all();
  const questions = (result.results || []).map(row => ({
    id: row.question_id, order: row.question_order, query: row.question_text, intent: row.intent,
    selection_reason: row.selection_reason, measurement_purpose: row.measurement_purpose || row.selection_reason, source_signals: parseJson(row.source_signals_json, []), kind: row.question_kind, confirmed: Number(row.confirmed) === 1
  }));
  const confirmed = questions.filter(question => question.confirmed).length;
  const valid = questions.length === 10 && confirmed === 10 && questions.every((question, index) => question.order === index + 1 && question.query && question.selection_reason && Array.isArray(question.source_signals));
  if (!valid) throw Object.assign(new Error(`確定済み質問が不足しています（質問${questions.length}/10、確定${confirmed}/10）。`), { code: QUESTION_ERROR, fatal: true });
  return questions;
}

function baseReport(order, questions) {
  const entity = parseJson(order.entity_json, { name: order.target_url, official_url: order.target_url });
  return {
    schemaVersion: 'paid-report-v1', sample: false,
    subject: { ...entity, area: order.location || '', category: entity.category || '' },
    measurement: { snapshotDate: new Date().toISOString().slice(0, 10), queryCount: 10, repetitions: 1 },
    queryDiscovery: { method: '対象企業のサービス、地域、検索需要、関連情報から確定した10問を使用' },
    queries: questions.map(question => ({ id: question.id, query: question.query, intent: question.intent, kind: question.kind, selectionReason: question.selection_reason, measurementPurpose: question.measurement_purpose, channels: [] })),
    sources: [], actions: [
      { target: 'AIが参照できる公式サイト情報を充実させる', change: '会社情報、対応サービス、対応地域を事実に基づいて整理する選択肢です。' },
      { target: '第三者サイト上の企業情報を整理する', change: '公開されている会社情報の名称や内容を確認する選択肢です。' },
      { target: '実績・事例・口コミなど不足情報を補う', change: '公開可能な事実がある場合に情報を追加する選択肢です。' }
    ]
  };
}

async function updateProgress(db, diagnosisId) {
  await db.prepare(`UPDATE diagnosis_orders SET completed_measurements=(SELECT COUNT(*) FROM paid_measurements WHERE diagnosis_id=? AND status='complete'),updated_at=datetime('now') WHERE id=?`).bind(diagnosisId, diagnosisId).run();
}

async function failDiagnosis(db, diagnosisId, error) {
  await db.prepare(`UPDATE diagnosis_orders SET diagnosis_status='failed',pipeline_state='failed',pipeline_error_code=?,error_message=?,runner_lock_token=NULL,runner_lock_until=NULL,updated_at=datetime('now') WHERE id=?`)
    .bind(error.code || 'pipeline_error', error.message, diagnosisId).run();
}

export async function getBuyerDiagnosis(db, diagnosisId) {
  const order = await db.prepare(`SELECT id,target_url,payment_status,diagnosis_status,pipeline_state,completed_measurements,total_measurements,
    pipeline_error_code,error_message,report_json,questions_confirmed_at,created_at,paid_at,started_at,completed_at FROM diagnosis_orders WHERE id=?`).bind(diagnosisId).first();
  if (!order) return null;
  return { ...order, progress: { completed: Number(order.completed_measurements || 0), total: Number(order.total_measurements || 30) }, report: parseJson(order.report_json, null) };
}

export async function resumePendingGoogleAiMode(env, diagnosisId, questionId) {
  const order = await env.DB.prepare('SELECT * FROM diagnosis_orders WHERE id=?').bind(diagnosisId).first();
  if (!order) throw Object.assign(new Error('診断が見つかりません。'), { status: 404 });
  const question = await env.DB.prepare(`SELECT question_id,question_order,question_text,intent,selection_reason,source_signals_json,question_kind,measurement_purpose
    FROM diagnosis_questions WHERE diagnosis_id=? AND question_id=?`).bind(diagnosisId, questionId).first();
  if (!question) throw Object.assign(new Error('質問が見つかりません。'), { status: 404 });
  const entity = parseJson(order.entity_json, { id: diagnosisId, name: order.target_url, official_url: order.target_url });
  const registry = [{ id: entity.id || diagnosisId, canonicalName: entity.name, displayName: entity.name, aliases: entity.aliases || [], officialDomains: entity.official_url ? [new URL(entity.official_url).hostname.replace(/^www\./, '')] : [] }];
  const store = new D1MeasurementStore(env.DB);
  const existing = await store.get(diagnosisId, questionId, 'google_ai_mode');
  if (!existing?.provider_metadata?.pending || !existing.raw_response_ref) throw Object.assign(new Error('再取得可能な既存taskがありません。'), { status: 409 });
  const adapter = new GoogleAiModePaidAdapter({ registry, retrievalMode: 'standard' });
  const input = { diagnosis_id: diagnosisId, run_id: order.run_id || `paid-${diagnosisId}`, entity,
    question_id: question.question_id, question_order: question.question_order, question_text: question.question_text,
    intent: question.intent, selection_reason: question.selection_reason, measurement_purpose: question.measurement_purpose || question.selection_reason,
    source_signals: parseJson(question.source_signals_json, []), question_kind: question.question_kind,
    channel: 'google_ai_mode', channel_order: 3, locale: order.locale || 'ja-JP', location: order.location || '',
    existing_measurement: existing, max_cost: Number(env.MADOHA_PAID_DIAGNOSIS_MAX_COST_USD || 0.2) };
  const measurement = await adapter.execute(input, env);
  await store.save(measurement);
  await updateProgress(env.DB, diagnosisId);
  return measurement;
}

export async function processDiagnosisQueueMessage(env, body, options = {}) {
  const diagnosisId = body?.orderId;
  if (!diagnosisId) return { action: 'ack', state: 'invalid_message' };
  const order = await env.DB.prepare('SELECT * FROM diagnosis_orders WHERE id=?').bind(diagnosisId).first();
  if (!order || ['complete', 'failed'].includes(order.diagnosis_status) || ['completed', 'failed', 'paused_cost_limit'].includes(order.pipeline_state)) return { action: 'ack', state: order?.pipeline_state || 'missing' };

  const lock = crypto.randomUUID();
  const claimed = await env.DB.prepare(`UPDATE diagnosis_orders SET runner_lock_token=?,runner_lock_until=datetime('now','+2 minutes'),diagnosis_status='running',pipeline_state='measuring',started_at=COALESCE(started_at,datetime('now')),updated_at=datetime('now')
    WHERE id=? AND payment_status='paid' AND (runner_lock_until IS NULL OR runner_lock_until < datetime('now')) AND pipeline_state NOT IN ('completed','failed')`).bind(lock, diagnosisId).run();
  if (Number(claimed.meta?.changes || 0) !== 1) return { action: 'ack', state: 'already_processing' };

  try {
    const questions = await loadConfirmedQuestions(env.DB, diagnosisId);
    const entity = parseJson(order.entity_json, { id: diagnosisId, name: order.target_url, official_url: order.target_url });
    const registry = options.registry || [{ id: entity.id || diagnosisId, canonicalName: entity.name, displayName: entity.name, aliases: entity.aliases || [], officialDomains: entity.official_url ? [new URL(entity.official_url).hostname.replace(/^www\./, '')] : [] }];
    const adapters = options.adapters || createWorkerAdapters(env, registry, options);
    const store = options.store || new D1MeasurementStore(env.DB);
    const result = await runPaidMeasurements({
      diagnosis: { id: diagnosisId, run_id: order.run_id || `paid-${diagnosisId}`, entity, locale: order.locale || 'ja-JP', location: order.location || '' },
      questions, adapters, store, env, maxCost: env.MADOHA_PAID_DIAGNOSIS_MAX_COST_USD,
      maxMeasurements: options.maxMeasurements || MEASUREMENTS_PER_QUEUE_RUN,
      onSaved: async () => updateProgress(env.DB, diagnosisId)
    });
    if (result.stopped?.code === 'cost_cap_exceeded') {
      await env.DB.prepare(`UPDATE diagnosis_orders SET diagnosis_status='running',pipeline_state='paused_cost_limit',pipeline_error_code=?,error_message=?,runner_lock_token=NULL,runner_lock_until=NULL,updated_at=datetime('now') WHERE id=?`).bind(result.stopped.code, '設定された費用上限に達したため一時停止しました。', diagnosisId).run();
      return { action: 'ack', state: 'paused_cost_limit', result };
    }
    if (result.stopped) {
      const error = Object.assign(new Error('恒久的なプロバイダーエラーで診断を停止しました。'), { code: result.stopped.code });
      await failDiagnosis(env.DB, diagnosisId, error); return { action: 'ack', state: 'failed', result };
    }
    const complete = result.measurements.filter(row => !row.error && !row.provider_metadata?.pending).length;
    if (complete === 30) {
      const report = measurementsToPaidReport(baseReport(order, questions), result.measurements);
      report.sources = [...new Map(result.measurements.flatMap(row => row.sources).map(source => [source.url, { name: source.title || source.domain, role: source.citation_text || 'AI回答が参照したWeb情報', url: source.url }])).values()];
      await env.DB.prepare(`UPDATE diagnosis_orders SET diagnosis_status='complete',pipeline_state='completed',completed_measurements=30,report_json=?,pipeline_error_code=NULL,error_message=NULL,completed_at=datetime('now'),runner_lock_token=NULL,runner_lock_until=NULL,updated_at=datetime('now') WHERE id=? AND runner_lock_token=?`).bind(JSON.stringify(report), diagnosisId, lock).run();
      return { action: 'ack', state: 'completed', result, report };
    }
    const hasPending = result.measurements.some(row => row.provider_metadata?.pending);
    await env.DB.prepare(`UPDATE diagnosis_orders SET diagnosis_status='running',pipeline_state='measuring',runner_lock_token=NULL,runner_lock_until=NULL,updated_at=datetime('now') WHERE id=? AND runner_lock_token=?`).bind(diagnosisId, lock).run();
    await env.DIAGNOSIS_QUEUE.send({ orderId: diagnosisId }, hasPending ? { delaySeconds: 60 } : undefined);
    return { action: 'ack', state: 'measuring', requeued: true, result };
  } catch (error) {
    await failDiagnosis(env.DB, diagnosisId, error);
    return { action: 'ack', state: 'failed', error: { code: error.code || 'pipeline_error', message: error.message } };
  }
}
