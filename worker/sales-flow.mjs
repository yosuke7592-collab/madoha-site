import { normalizePublicUrl, runFreeCheck } from './free-check.mjs';
import { generateQuestionDiscovery } from '../measurement/question-discovery.mjs';
import { validateQuestionSet } from './question-review.mjs';
import { secureTextEqual, verifyStripeSignature, PRICE_JPY } from './paid-diagnosis.mjs';
import { createWorkerAdapters, loadConfirmedQuestions, baseReport } from './diagnosis-pipeline.mjs';
import { D1MeasurementStore, runPaidMeasurements, measurementsToPaidReport } from '../measurement/paid-pipeline.mjs';
import { inferIdentityType, resolveIdentityInput, stableIdentityKey } from './identity-resolution.mjs';

const parse = (value, fallback = null) => { try { return JSON.parse(value) ?? fallback; } catch { return fallback; } };
const encode = value => new TextEncoder().encode(value);
const now = () => Math.floor(Date.now() / 1000);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
const config = (env, name, fallback) => { const n = Number(env[name] ?? fallback); if (!Number.isFinite(n) || n < 0) fail('診断設定を確認してください。', 503); return n; };
export const hashToken = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
export async function hashIp(ip, secret) {
  if (!secret) fail('無料診断は準備中です。', 503);
  const key = await crypto.subtle.importKey('raw', encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encode(ip)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export function freeIdentity(entity) {
  return `free-v1:${stableIdentityKey(entity)}`;
}
export function selectFreeQuestions(questions) {
  if (questions.length !== 10) fail('10問が必要です。');
  const score = q => (/利用判断|課題解決|比較/.test(q.intent) ? 4 : 0) + (/信頼|会社理解|製品理解|サービス理解|ブランド理解/.test(q.intent) ? 3 : 0) + Math.min((q.source_signals || []).length, 2);
  const ranked = [...questions].sort((a, b) => score(b) - score(a) || a.order - b.order);
  const discovery = ranked.find(q => q.kind === 'nonbrand');
  const brand = ranked.find(q => q.kind === 'branded');
  if (!discovery || !brand) fail('無料診断には候補検索と会社名検索の両方が必要です。');
  const third = ranked.find(q => q.id !== discovery.id && q.id !== brand.id && q.intent !== discovery.intent && q.intent !== brand.intent)
    || ranked.find(q => q.id !== discovery.id && q.id !== brand.id);
  return [discovery.id, brand.id, third.id];
}
export function finalizeIdentityForDraft(rawEntity = {}) {
  const identityType = rawEntity.identity_id
    ? rawEntity.identity_type || rawEntity.entity_type
    : inferIdentityType(rawEntity.name, {
        industry: rawEntity.industry,
        context: [...(rawEntity.main_services || []), ...(rawEntity.main_products || [])].join(' ')
      });
  return {
    ...rawEntity,
    identity_type: identityType,
    entity_type: identityType === 'store' ? 'company' : identityType
  };
}
export async function verifyTurnstile(env, token, hostname, fetchImpl = fetch) {
  if (!env.TURNSTILE_SECRET_KEY || !token || token.length > 2048) return false;
  const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token })
  });
  if (!response.ok) return false;
  const result = await response.json();
  return result.success === true && result.hostname === hostname && result.action === 'free_diagnosis';
}
export async function salesEvent(db, id, event) {
  await db.prepare("INSERT OR IGNORE INTO diagnosis_events VALUES (?,?,datetime('now'))").bind(id, event).run();
}
export async function authorizeSales(db, id, token) {
  if (!token || token.length > 128) return null;
  const order = await db.prepare('SELECT * FROM diagnosis_orders WHERE id=?').bind(id).first();
  return order?.sales_stage && order.access_token_hash && await secureTextEqual(await hashToken(token), order.access_token_hash) ? order : null;
}

export async function createSalesDraft(env, input) {
  const rawEntity = input.entity || input;
  const entityInput = finalizeIdentityForDraft(rawEntity);
  const discovery = generateQuestionDiscovery({ ...input, entity: entityInput });
  const entity = { ...discovery.entity, official_url: discovery.entity.official_url ? normalizePublicUrl(discovery.entity.official_url).href : '' };
  const ids = selectFreeQuestions(discovery.questions);
  const id = crypto.randomUUID(), token = crypto.randomUUID() + crypto.randomUUID();
  const statements = [env.DB.prepare(`INSERT INTO diagnosis_orders
    (id,target_url,amount_jpy,payment_status,diagnosis_status,created_at,updated_at,sales_stage,access_token_hash,identity_key,entity_json,location,question_mix_reason,question_discovery_json,free_question_ids_json,cost_cap_usd)
    VALUES (?,?,4980,'pending','locked',datetime('now'),datetime('now'),'questions_ready',?,?,?,?,?,?,?,?)`)
    .bind(id, entity.official_url || '', await hashToken(token), freeIdentity(entity), JSON.stringify(entity), entity.region || '', discovery.mix.reason, JSON.stringify(discovery), JSON.stringify(ids), config(env, 'MADOHA_PAID_DIAGNOSIS_MAX_COST_USD', .70))];
  for (const q of discovery.questions) statements.push(env.DB.prepare(`INSERT INTO diagnosis_questions
    (diagnosis_id,question_id,question_order,question_text,intent,selection_reason,source_signals_json,question_kind,created_at,measurement_purpose,alternatives_json,proposed_question_text,proposed_question_kind,discovery_evidence_json,generation_source,generation_rule)
    VALUES (?,?,?,?,?,?,?,?,datetime('now'),?,?,?,?,?,?,?)`).bind(id, q.id, q.order, q.question_text, q.intent, q.selection_reason, JSON.stringify(q.source_signals), q.kind, q.measurement_purpose, JSON.stringify(q.alternatives), q.question_text, q.kind, JSON.stringify(q.discovery_evidence), q.generation_source, q.generation_rule));
  await env.DB.batch(statements);
  return { id, token, questions: discovery.questions, free_question_ids: ids, mix: discovery.mix };
}

async function queueStage(env, id, stage) {
  await env.DB.prepare("INSERT INTO diagnosis_outbox VALUES (?,?,datetime('now'),NULL) ON CONFLICT(diagnosis_id) DO UPDATE SET stage=excluded.stage,sent_at=NULL").bind(id, stage).run();
  await dispatchSalesOutbox(env);
}
export async function dispatchSalesOutbox(env) {
  if (!env.DB || !env.DIAGNOSIS_QUEUE) return;
  const rows = await env.DB.prepare('SELECT * FROM diagnosis_outbox WHERE sent_at IS NULL LIMIT 20').all();
  for (const row of rows.results || []) {
    await env.DIAGNOSIS_QUEUE.send({ orderId: row.diagnosis_id });
    await env.DB.prepare("UPDATE diagnosis_outbox SET sent_at=datetime('now') WHERE diagnosis_id=? AND stage=?").bind(row.diagnosis_id, row.stage).run();
  }
}

export async function startFree(env, order, ipHash) {
  if (order.sales_stage !== 'questions_ready') { await dispatchSalesOutbox(env); return { started: true, reused: Boolean(order.free_source_id) }; }
  const cap = config(env, 'FREE_DIAGNOSIS_COST_CAP_USD', .21), daily = config(env, 'FREE_DIAGNOSIS_DAILY_COST_CAP_USD', 5);
  const recentLimit = config(env, 'FREE_DIAGNOSIS_IP_HOURLY_LIMIT', 12), dayLimit = config(env, 'FREE_DIAGNOSIS_IP_DAILY_LIMIT', 40);
  const timestamp = now(), day = new Date().toISOString().slice(0, 10), expires = timestamp + config(env, 'FREE_DIAGNOSIS_REUSE_SECONDS', 86400);
  // D1 batch serializes allowance acquisition, cache election, budget reservation and the state transition.
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO free_requests SELECT ?,?,?,?,1 WHERE
      (SELECT COUNT(*) FROM free_requests WHERE ip_hash=? AND started_at>?)<? AND
      (SELECT COUNT(*) FROM free_requests WHERE ip_hash=? AND started_at>?)<?`)
      .bind(order.id, ipHash, order.identity_key, timestamp, ipHash, timestamp - 3600, recentLimit, ipHash, timestamp - 86400, dayLimit),
    env.DB.prepare(`INSERT INTO free_identity_cache SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM free_requests WHERE diagnosis_id=?)
      ON CONFLICT(identity_key) DO UPDATE SET diagnosis_id=excluded.diagnosis_id,expires_at=excluded.expires_at WHERE free_identity_cache.expires_at<?`)
      .bind(order.identity_key, order.id, expires, order.id, timestamp),
    env.DB.prepare(`INSERT OR IGNORE INTO free_budget(diagnosis_id,day,reserved_usd)
      SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM free_identity_cache WHERE identity_key=? AND diagnosis_id=?)
      AND EXISTS(SELECT 1 FROM diagnosis_orders WHERE id=? AND sales_stage='questions_ready' AND free_budget_day IS NULL)
      AND COALESCE((SELECT SUM(reserved_usd) FROM free_budget WHERE day=?),0)+?<=?`)
      .bind(order.id, day, cap, order.identity_key, order.id, order.id, day, cap, daily),
    env.DB.prepare(`UPDATE diagnosis_orders SET free_budget_day=? WHERE id=? AND sales_stage='questions_ready'
      AND EXISTS(SELECT 1 FROM free_budget WHERE diagnosis_id=? AND day=?)`).bind(day, order.id, order.id, day),
    env.DB.prepare(`UPDATE diagnosis_orders SET free_source_id=(SELECT diagnosis_id FROM free_identity_cache WHERE identity_key=?),sales_stage='free_measuring',diagnosis_status='running',pipeline_state='queued',updated_at=datetime('now')
      WHERE id=? AND sales_stage='questions_ready' AND EXISTS(SELECT 1 FROM free_requests WHERE diagnosis_id=?)
      AND EXISTS(SELECT 1 FROM free_identity_cache WHERE identity_key=? AND (diagnosis_id<>? OR free_budget_day IS NOT NULL))`)
      .bind(order.identity_key, order.id, order.id, order.identity_key, order.id),
    env.DB.prepare(`UPDATE diagnosis_questions SET confirmed=1,confirmed_at=datetime('now') WHERE diagnosis_id=? AND EXISTS(SELECT 1 FROM diagnosis_orders WHERE id=? AND sales_stage='free_measuring')`).bind(order.id, order.id),
    env.DB.prepare(`UPDATE diagnosis_orders SET questions_confirmed_at=datetime('now') WHERE id=? AND sales_stage='free_measuring'`).bind(order.id),
    env.DB.prepare(`INSERT OR IGNORE INTO diagnosis_outbox SELECT id,'free_measuring',datetime('now'),NULL FROM diagnosis_orders WHERE id=? AND sales_stage='free_measuring'`).bind(order.id)
  ]);
  const current = await env.DB.prepare('SELECT * FROM diagnosis_orders WHERE id=?').bind(order.id).first();
  if (current.sales_stage === 'questions_ready') {
    await env.DB.prepare('DELETE FROM free_budget WHERE diagnosis_id=?').bind(order.id).run();
    await env.DB.prepare('DELETE FROM free_identity_cache WHERE diagnosis_id=? AND NOT EXISTS(SELECT 1 FROM diagnosis_orders WHERE id=? AND free_budget_day IS NOT NULL)').bind(order.id, order.id).run();
    fail(results[0].meta.changes ? '本日の無料診断受付上限に達しました。既存結果は引き続き閲覧できます。' : '短時間の診断が多いため、時間をおいてお試しください。', 429);
  }
  await salesEvent(env.DB, order.id, 'free_started'); await dispatchSalesOutbox(env);
  return { started: true, reused: current.free_source_id !== order.id };
}

export async function editRemainingQuestions(db, order, submitted, acknowledgements = []) {
  if (order.sales_stage !== 'free_completed') fail('現在は質問を変更できません。', 409);
  const stored = (await db.prepare('SELECT * FROM diagnosis_questions WHERE diagnosis_id=? ORDER BY question_order').bind(order.id).all()).results;
  const locked = new Set(parse(order.free_question_ids_json, []));
  if (!Array.isArray(submitted) || submitted.length !== 10 || new Set(submitted.map(q => q.id)).size !== 10) fail('10問の識別情報を確認してください。');
  const questions = stored.map(row => {
    const q = submitted.find(q => q.id === row.question_id); if (!q) fail('質問が不足しています。');
    if (locked.has(q.id) && (q.question_text !== row.question_text || q.kind !== row.question_kind)) fail('無料測定済みの質問は変更できません。', 409);
    return { id: q.id, question_text: String(q.question_text || '').trim(), kind: q.kind };
  });
  const qa = validateQuestionSet(questions, parse(order.entity_json, {}));
  if (questions.some(q => q.question_text.length > 2000)) fail('質問が長すぎます。');
  if (qa.errors.length || qa.warnings.some(w => !acknowledgements.includes(w.code))) return { saved: false, ...qa };
  const updates = stored.filter(row => !locked.has(row.question_id)).map(row => {
    const q = questions.find(q => q.id === row.question_id);
    return db.prepare(`UPDATE diagnosis_questions SET question_text=?,question_kind=?,user_modified=?,confirmed=1,confirmed_at=datetime('now'),warning_acknowledgements_json=?
      WHERE diagnosis_id=? AND question_id=? AND EXISTS(SELECT 1 FROM diagnosis_orders WHERE id=? AND sales_stage='free_completed')
      AND NOT EXISTS(SELECT 1 FROM paid_measurements WHERE diagnosis_id=? AND question_id=?)`)
      .bind(q.question_text, q.kind, +(q.question_text !== row.proposed_question_text || q.kind !== row.proposed_question_kind), JSON.stringify(acknowledgements), order.id, row.question_id, order.id, order.id, row.question_id);
  });
  await db.batch(updates); return { saved: true, ...qa };
}

export async function createUpgradeCheckout(env, order, origin, fetchImpl = fetch) {
  if (!/^(?:sk|rk)_test_/.test(env.STRIPE_SECRET_KEY || '')) fail('Stripeテスト決済の設定待ちです。', 503);
  if (order.payment_status === 'paid') fail('決済は完了しています。', 409);
  if (!['free_completed', 'checkout_pending'].includes(order.sales_stage)) fail('無料診断の完了後に購入できます。', 409);
  const expires = order.checkout_expires_at || now() + 3600;
  if (expires <= now()) fail('決済画面の有効期限が切れました。決済状況を確認してから再発行してください。', 409);
  await env.DB.prepare("UPDATE diagnosis_orders SET sales_stage='checkout_pending',checkout_expires_at=COALESCE(checkout_expires_at,?) WHERE id=? AND sales_stage='free_completed'").bind(expires, order.id).run();
  const current = await env.DB.prepare('SELECT * FROM diagnosis_orders WHERE id=?').bind(order.id).first();
  const form = new URLSearchParams({ mode: 'payment', 'payment_method_types[0]': 'card', 'line_items[0][price_data][currency]': 'jpy',
    'line_items[0][price_data][unit_amount]': String(PRICE_JPY), 'line_items[0][price_data][product_data][name]': 'MADOHA AI検索診断 完全版',
    'line_items[0][price_data][tax_behavior]': 'inclusive', 'line_items[0][quantity]': '1', client_reference_id: order.id,
    'metadata[diagnosis_order_id]': order.id, 'metadata[product_code]': 'madoha_free_upgrade_v1', expires_at: String(current.checkout_expires_at),
    success_url: `${origin}/diagnose.html?diagnosis=${order.id}&checkout=returned`, cancel_url: `${origin}/diagnose.html?diagnosis=${order.id}&checkout=cancelled` });
  const response = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `upgrade-${order.id}-${current.checkout_attempt}` }, body: form });
  const session = await response.json();
  if (!response.ok || !session.url || session.livemode) fail('決済画面を作成できませんでした。', 502);
  await env.DB.prepare('UPDATE diagnosis_orders SET stripe_session_id=? WHERE id=? AND payment_status=\'pending\'').bind(session.id, order.id).run();
  await salesEvent(env.DB, order.id, 'checkout_started'); return { checkoutUrl: session.url };
}

export async function applyUpgradeEvent(env, event) {
  const session = event.data?.object;
  if (session?.metadata?.product_code !== 'madoha_free_upgrade_v1') return null;
  const id = session.metadata.diagnosis_order_id;
  const order = await env.DB.prepare('SELECT * FROM diagnosis_orders WHERE id=?').bind(id).first();
  if (!order || event.livemode !== false || session.livemode !== false) fail('テスト決済を確認できません。');
  if (event.type === 'checkout.session.expired') {
    await env.DB.prepare("UPDATE diagnosis_orders SET sales_stage='free_completed',stripe_session_id=NULL,checkout_expires_at=NULL,checkout_attempt=checkout_attempt+1 WHERE id=? AND stripe_session_id=? AND payment_status='pending'").bind(id, session.id).run();
    return { accepted: true };
  }
  if (event.type !== 'checkout.session.completed') return { accepted: true, ignored: true };
  if (!event.id || session.payment_status !== 'paid' || session.amount_total !== 4980 || session.currency !== 'jpy' || session.client_reference_id !== id) fail('支払内容が一致しません。');
  // A webhook can arrive before the Session-create response; retrieve/bind only to our frozen pending checkout.
  if (order.stripe_session_id && order.stripe_session_id !== session.id) fail('決済セッションが一致しません。');
  if (!['checkout_pending','paid','paid_measuring','completed'].includes(order.sales_stage)) fail('購入状態が一致しません。');
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO stripe_events VALUES (?,?,datetime('now'))").bind(event.id, event.type),
    env.DB.prepare("UPDATE diagnosis_orders SET payment_status='paid',sales_stage='paid',diagnosis_status='queued',pipeline_state='queued',stripe_session_id=?,paid_at=datetime('now') WHERE id=? AND payment_status='pending' AND sales_stage='checkout_pending'").bind(session.id, id),
    env.DB.prepare("INSERT OR IGNORE INTO diagnosis_outbox SELECT id,'paid',datetime('now'),NULL FROM diagnosis_orders WHERE id=? AND sales_stage='paid'").bind(id),
    env.DB.prepare("INSERT OR IGNORE INTO diagnosis_events VALUES (?,'payment_completed',datetime('now'))").bind(id)
  ]);
  // Renew the consumed free-stage outbox only while payment has queued paid work.
  await env.DB.prepare("UPDATE diagnosis_outbox SET stage='paid',sent_at=NULL WHERE diagnosis_id=? AND stage='free_measuring' AND EXISTS(SELECT 1 FROM diagnosis_orders WHERE id=? AND sales_stage='paid')").bind(id, id).run();
  await dispatchSalesOutbox(env); return { accepted: true, id };
}

async function collectReport(order, questions, rows) {
  const report = measurementsToPaidReport(baseReport(order, questions), rows);
  report.measurement.queryCount = questions.length;
  report.sources = [...new Map(rows.flatMap(r => r.sources || []).map(s => [s.url, { name: s.title || s.domain, url: s.url, role: s.citation_text || 'AI回答の参照情報' }])).values()];
  return report;
}
export async function processSalesQueue(env, order, options = {}) {
  if (!['free_measuring','paid','paid_measuring'].includes(order.sales_stage)) return { action: 'ack', state: order.sales_stage };
  const free = order.sales_stage === 'free_measuring';
  if (!free && order.payment_status !== 'paid') return { action: 'ack', state: 'unpaid' };
  const lock = crypto.randomUUID();
  const claim = await env.DB.prepare(`UPDATE diagnosis_orders SET runner_lock_token=?,runner_lock_until=datetime('now','+10 minutes') WHERE id=? AND sales_stage=? AND (runner_lock_until IS NULL OR runner_lock_until<datetime('now'))`).bind(lock, order.id, order.sales_stage).run();
  if (claim.meta.changes !== 1) return { action: 'retry', state: 'already_processing' };
  try {
    let questions = await loadConfirmedQuestions(env.DB, order.id);
    let freeIds = parse(order.free_question_ids_json, []);
    const store = options.store || new D1MeasurementStore(env.DB);
    if (free && order.free_source_id && order.free_source_id !== order.id) {
      const source = await env.DB.prepare('SELECT * FROM diagnosis_orders WHERE id=?').bind(order.free_source_id).first();
      if (source?.sales_stage === 'failed') fail('再利用元の無料診断に失敗しました。', 503);
      if (!source?.free_report_json) return { action: 'retry', state: 'awaiting_cached_result' };
      // Copy only public measurement/question data into this purchaser's own diagnosis. Never copy access/payment fields.
      const sourceQuestions = await loadConfirmedQuestions(env.DB, source.id);
      freeIds = parse(source.free_question_ids_json, []);
      const updates = sourceQuestions.map(q => env.DB.prepare(`UPDATE diagnosis_questions SET question_text=?,question_kind=?,intent=?,selection_reason=?,measurement_purpose=?,source_signals_json=?,confirmed=1 WHERE diagnosis_id=? AND question_id=?`)
        .bind(q.query, q.kind, q.intent, q.selection_reason, q.measurement_purpose, JSON.stringify(q.source_signals), order.id, q.id));
      updates.push(env.DB.prepare('UPDATE diagnosis_orders SET free_question_ids_json=? WHERE id=?').bind(JSON.stringify(freeIds), order.id));
      await env.DB.batch(updates); questions = sourceQuestions;
      const sourceRows = (await new D1MeasurementStore(env.DB).list(source.id)).filter(r => freeIds.includes(r.question_id));
      if (sourceRows.length !== 9 || sourceRows.some(r => r.error || !r.raw_answer)) fail('再利用結果を確認できません。');
      for (const row of sourceRows) if (!await store.get(order.id, row.question_id, row.channel)) await store.save({ ...row, diagnosis_id: order.id, run_id: `reuse-${order.id}`, estimated_cost: 0, provider_metadata: { ...row.provider_metadata, reused: true, original_cost_usd: row.estimated_cost } });
    }
    const entity = parse(order.entity_json, {});
    const registry = [{ id: entity.id || entity.identity_id || order.id, canonicalName: entity.name, displayName: entity.name, aliases: entity.aliases || [], officialDomains: entity.official_url ? [new URL(entity.official_url).hostname.replace(/^www\./,'')] : [] }];
    const selected = free ? questions.filter(q => freeIds.includes(q.id)) : questions;
    const cap = free ? Math.min(order.cost_cap_usd, config(env,'FREE_DIAGNOSIS_COST_CAP_USD',.21)) : order.cost_cap_usd;
    const result = await runPaidMeasurements({ diagnosis: { id: order.id, run_id: `sales-${order.id}`, entity, locale: order.locale, location: order.location },
      questions: selected, adapters: options.adapters || createWorkerAdapters(env, registry), store, env, maxCost: cap, maxMeasurements: 3,
      onSaved: async () => { await env.DB.prepare("UPDATE diagnosis_orders SET completed_measurements=(SELECT COUNT(*) FROM paid_measurements WHERE diagnosis_id=? AND status='complete'),sales_stage=?,pipeline_state='measuring' WHERE id=? AND runner_lock_token=?").bind(order.id, free ? 'free_measuring' : 'paid_measuring', order.id, lock).run(); }
    });
    if (result.stopped) {
      await env.DB.prepare('UPDATE diagnosis_orders SET sales_stage=\'failed\',pipeline_state=?,pipeline_error_code=?,error_message=? WHERE id=?').bind(result.stopped.code === 'cost_cap_exceeded' ? 'paused_cost_limit' : 'failed', result.stopped.code, '診断処理を停止しました。完了済み結果は保存されています。', order.id).run();
      return { action: 'ack', state: 'failed', result };
    }
    const rows = result.measurements.filter(r => !r.error && !r.provider_metadata?.pending && r.raw_answer?.trim());
    if (rows.length === (free ? 9 : 30)) {
      const report = await collectReport(order, selected, rows);
      await env.DB.prepare(`UPDATE diagnosis_orders SET sales_stage=?,diagnosis_status=?,pipeline_state=?,completed_measurements=?,${free ? 'free_report_json' : 'report_json'}=?,completed_at=datetime('now') WHERE id=? AND runner_lock_token=?`)
        .bind(free ? 'free_completed' : 'completed', free ? 'locked' : 'complete', free ? 'pending' : 'completed', rows.length, JSON.stringify(report), order.id, lock).run();
      await salesEvent(env.DB, order.id, free ? 'free_completed' : 'full_diagnosis_completed');
      return { action: 'ack', state: free ? 'free_completed' : 'completed', result, report };
    }
    await queueStage(env, order.id, free ? 'free_measuring' : 'paid');
    return { action: 'ack', state: free ? 'free_measuring' : 'paid_measuring', result };
  } finally {
    await env.DB.prepare('UPDATE diagnosis_orders SET runner_lock_token=NULL,runner_lock_until=NULL WHERE id=? AND runner_lock_token=?').bind(order.id, lock).run();
  }
}

export async function handleSalesRequest(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/sales/')) return null;
  if (env.MADOHA_ENABLE_SALES_FLOW !== 'true') return json({ error: '販売導線は準備中です。' }, 503);
  try {
    if (request.method !== 'GET' && request.headers.get('origin') && request.headers.get('origin') !== url.origin) fail('アクセス元を確認できません。', 403);
    const body = async () => { const text = await request.text(); if (text.length > 30000) fail('入力が長すぎます。', 413); return JSON.parse(text); };
    if (url.pathname === '/api/sales/config') return json({ turnstile_site_key: env.TURNSTILE_SITE_KEY || '', price_jpy: PRICE_JPY });
    if (url.pathname === '/api/sales/inspect' && request.method === 'POST') { const input = await body(); return json(await resolveIdentityInput(input, { inspectUrl: value => runFreeCheck(value) })); }
    if (url.pathname === '/api/sales/draft' && request.method === 'POST') return json(await createSalesDraft(env, await body()));
    const match = url.pathname.match(/^\/api\/sales\/([0-9a-f-]{36})(?:\/(start|questions|checkout|event|report))?$/i);
    if (!match) return json({ error: 'Not found' }, 404);
    const order = await authorizeSales(env.DB, match[1], request.headers.get('x-diagnosis-token'));
    if (!order) fail('閲覧権限を確認できません。', 403);
    if (request.method === 'GET' && match[2] === 'report') {
      if (order.payment_status !== 'paid' || order.sales_stage !== 'completed') fail('完全版は決済・診断完了後に閲覧できます。', 403);
      return json({ report: parse(order.report_json) });
    }
    if (request.method === 'GET' && !match[2]) {
      const questions = (await env.DB.prepare('SELECT question_id AS id,question_text,question_kind AS kind,selection_reason,measurement_purpose,alternatives_json FROM diagnosis_questions WHERE diagnosis_id=? ORDER BY question_order').bind(order.id).all()).results;
      return json({ id: order.id, stage: order.sales_stage, payment_status: order.payment_status, completed: order.completed_measurements,
        total: ['questions_ready','free_measuring','free_completed'].includes(order.sales_stage) ? 9 : 30, free_question_ids: parse(order.free_question_ids_json, []), questions,
        report: parse(order.free_report_json), full_report: order.payment_status === 'paid' && order.sales_stage === 'completed' ? parse(order.report_json) : null, error: order.error_message });
    }
    if (request.method === 'POST' && match[2] === 'start') {
      const input = await body();
      const ipHash = await hashIp(request.headers.get('cf-connecting-ip') || 'local', env.FREE_DIAGNOSIS_IP_HASH_SECRET);
      // The edge limiter is target-scoped so a shared office/mobile IP does not block unrelated companies.
      // D1 still detects one actor rapidly starting many different targets.
      if (env.FREE_START_LIMITER && !(await env.FREE_START_LIMITER.limit({ key: order.identity_key })).success) fail('同じ対象への診断が続いています。時間をおいてお試しください。',429);
      if (!await verifyTurnstile(env, input.turnstile_token, url.hostname)) fail('確認の有効期限が切れました。もう一度お試しください。',403);
      return json(await startFree(env, order, ipHash));
    }
    if (request.method === 'PUT' && match[2] === 'questions') { const input = await body(); return json(await editRemainingQuestions(env.DB, order, input.questions, input.acknowledged_warning_codes)); }
    if (request.method === 'POST' && match[2] === 'checkout') return json(await createUpgradeCheckout(env, order, env.PUBLIC_SITE_URL || url.origin));
    if (request.method === 'POST' && match[2] === 'event') { const input = await body(); if (input.event !== 'paid_cta_viewed') fail('イベントが不正です。'); await salesEvent(env.DB, order.id, input.event); return json({ ok: true }); }
    return json({ error: 'Not found' },404);
  } catch (error) { return json({ error: error.message }, error.status || 400); }
}
