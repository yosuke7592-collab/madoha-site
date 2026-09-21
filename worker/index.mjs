import { normalizePublicUrl, runFreeCheck } from './free-check.mjs';
import { applyStripeEvent, createCheckout, isIsolatedTestEnvironment, secureTextEqual, verifyCheckoutAccess, verifyStripeSignature } from './paid-diagnosis.mjs';
import { finalizeLiveSmoke, getBuyerDiagnosis, processDiagnosisQueueMessage, reprocessCompletedDiagnosis, resumePendingGoogleAiMode, retryFailedGemini, retryGoogleAiModeLive } from './diagnosis-pipeline.mjs';
import { confirmQuestionSet, getQuestionReview, saveQuestionDraft } from './question-review.mjs';
import { generateAndSaveQuestionDiscovery } from './question-discovery.mjs';
import { handleSalesRequest, applyUpgradeEvent, dispatchSalesOutbox, processSalesQueue } from './sales-flow.mjs';

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }
});

async function processQueueMessage(env, body, options = {}) {
  const order = body?.orderId ? await env.DB.prepare('SELECT * FROM diagnosis_orders WHERE id=?').bind(body.orderId).first() : null;
  return order?.sales_stage ? processSalesQueue(env, order, options) : processDiagnosisQueueMessage(env, body, options);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const salesResponse = await handleSalesRequest(request, env);
    if (salesResponse) return salesResponse;
    if (url.pathname === '/api/integration/enqueue' && request.method === 'POST') {
      if (!isIsolatedTestEnvironment(env) || !env.MADOHA_INTEGRATION_ACCESS_TOKEN) return json({ ok: false, error: 'Not found' }, 404);
      if (!await secureTextEqual(request.headers.get('authorization'), `Bearer ${env.MADOHA_INTEGRATION_ACCESS_TOKEN}`)) return json({ ok: false, error: 'Forbidden' }, 403);
      const body = await request.json();
      if (!/^[0-9a-f-]{36}$/i.test(body?.diagnosis_id || '')) return json({ ok: false, error: 'Invalid diagnosis id' }, 400);
      await env.DIAGNOSIS_QUEUE.send({ orderId: body.diagnosis_id });
      return json({ ok: true, queued: body.diagnosis_id });
    }
    if (url.pathname === '/api/integration/run-diagnosis-batch' && request.method === 'POST') {
      if (!isIsolatedTestEnvironment(env) || !env.MADOHA_INTEGRATION_ACCESS_TOKEN) return json({ ok: false, error: 'Not found' }, 404);
      if (!await secureTextEqual(request.headers.get('authorization'), `Bearer ${env.MADOHA_INTEGRATION_ACCESS_TOKEN}`)) return json({ ok: false, error: 'Forbidden' }, 403);
      const body = await request.json();
      if (!/^[0-9a-f-]{36}$/i.test(body?.diagnosis_id || '')) return json({ ok: false, error: 'Invalid diagnosis id' }, 400);
      const result = await processQueueMessage(env, { orderId: body.diagnosis_id }, { requeue: false });
      return json({ ok: true, state: result.state, processed: result.result?.processed || 0, total_cost: result.result?.total_estimated_cost || 0,
        completed: result.result?.measurements?.filter(row => !row.error && !row.provider_metadata?.pending && row.raw_answer?.trim()).length || 0,
        stopped: result.result?.stopped || null, error: result.error || null });
    }
    if (url.pathname === '/api/integration/resume-dataforseo' && request.method === 'POST') {
      if (!isIsolatedTestEnvironment(env) || !env.MADOHA_INTEGRATION_ACCESS_TOKEN) return json({ ok: false, error: 'Not found' }, 404);
      if (!await secureTextEqual(request.headers.get('authorization'), `Bearer ${env.MADOHA_INTEGRATION_ACCESS_TOKEN}`)) return json({ ok: false, error: 'Forbidden' }, 403);
      try {
        const body = await request.json();
        if (!/^[0-9a-f-]{36}$/i.test(body?.diagnosis_id || '') || !body?.question_id) return json({ ok: false, error: 'Invalid request' }, 400);
        const measurement = await resumePendingGoogleAiMode(env, body.diagnosis_id, body.question_id);
        return json({ ok: true, status: measurement.status, pending: Boolean(measurement.provider_metadata?.pending) });
      } catch (error) { return json({ ok: false, error: error.message }, error.status || 400); }
    }
    if (url.pathname === '/api/integration/retry-gemini' && request.method === 'POST') {
      if (!isIsolatedTestEnvironment(env) || !env.MADOHA_INTEGRATION_ACCESS_TOKEN) return json({ ok: false, error: 'Not found' }, 404);
      if (!await secureTextEqual(request.headers.get('authorization'), `Bearer ${env.MADOHA_INTEGRATION_ACCESS_TOKEN}`)) return json({ ok: false, error: 'Forbidden' }, 403);
      try {
        const body = await request.json();
        if (!/^[0-9a-f-]{36}$/i.test(body?.diagnosis_id || '') || !body?.question_id) return json({ ok: false, error: 'Invalid request' }, 400);
        const measurement = await retryFailedGemini(env, body.diagnosis_id, body.question_id);
        return json({ ok: true, status: measurement.status });
      } catch (error) { return json({ ok: false, error: error.message, code: error.code || null, provider_metadata: error.providerMetadata || null }, error.status || 400); }
    }
    if (url.pathname === '/api/integration/retry-google-ai-mode-live' && request.method === 'POST') {
      if (!isIsolatedTestEnvironment(env) || !env.MADOHA_INTEGRATION_ACCESS_TOKEN) return json({ ok: false, error: 'Not found' }, 404);
      if (!await secureTextEqual(request.headers.get('authorization'), `Bearer ${env.MADOHA_INTEGRATION_ACCESS_TOKEN}`)) return json({ ok: false, error: 'Forbidden' }, 403);
      try {
        const body = await request.json();
        if (!/^[0-9a-f-]{36}$/i.test(body?.diagnosis_id || '') || !body?.question_id) return json({ ok: false, error: 'Invalid request' }, 400);
        return json({ ok: true, measurement: await retryGoogleAiModeLive(env, body.diagnosis_id, body.question_id) });
      } catch (error) { return json({ ok: false, error: error.message, code: error.code || null, provider_metadata: error.providerMetadata || null }, error.status || 400); }
    }
    if (url.pathname === '/api/integration/finalize-live-smoke' && request.method === 'POST') {
      if (!isIsolatedTestEnvironment(env) || !env.MADOHA_INTEGRATION_ACCESS_TOKEN) return json({ ok: false, error: 'Not found' }, 404);
      if (!await secureTextEqual(request.headers.get('authorization'), `Bearer ${env.MADOHA_INTEGRATION_ACCESS_TOKEN}`)) return json({ ok: false, error: 'Forbidden' }, 403);
      try {
        const body = await request.json();
        if (!/^[0-9a-f-]{36}$/i.test(body?.diagnosis_id || '') || !body?.question_id) return json({ ok: false, error: 'Invalid request' }, 400);
        const result = await finalizeLiveSmoke(env, body.diagnosis_id, body.question_id);
        return json({ ok: true, report_query_count: result.report.queries.length, measurement_count: result.measurements.length });
      } catch (error) { return json({ ok: false, error: error.message }, error.status || 400); }
    }
    if (url.pathname === '/api/integration/reprocess-completed-diagnosis' && request.method === 'POST') {
      if (!isIsolatedTestEnvironment(env) || !env.MADOHA_INTEGRATION_ACCESS_TOKEN) return json({ ok: false, error: 'Not found' }, 404);
      if (!await secureTextEqual(request.headers.get('authorization'), `Bearer ${env.MADOHA_INTEGRATION_ACCESS_TOKEN}`)) return json({ ok: false, error: 'Forbidden' }, 403);
      try {
        const body = await request.json();
        if (!/^[0-9a-f-]{36}$/i.test(body?.diagnosis_id || '')) return json({ ok: false, error: 'Invalid request' }, 400);
        const result = await reprocessCompletedDiagnosis(env, body.diagnosis_id);
        return json({ ok: true, measurement_count: result.measurements.length, query_count: result.report.queries.length });
      } catch (error) { return json({ ok: false, error: error.message }, error.status || 400); }
    }
    if (url.pathname === '/api/integration/inspect-dataforseo' && request.method === 'POST') {
      if (!isIsolatedTestEnvironment(env) || !env.MADOHA_INTEGRATION_ACCESS_TOKEN) return json({ ok: false, error: 'Not found' }, 404);
      if (!await secureTextEqual(request.headers.get('authorization'), `Bearer ${env.MADOHA_INTEGRATION_ACCESS_TOKEN}`)) return json({ ok: false, error: 'Forbidden' }, 403);
      try {
        const body = await request.json();
        if (!/^[0-9a-f-]{36}$/i.test(body?.diagnosis_id || '') || !body?.question_id) return json({ ok: false, error: 'Invalid request' }, 400);
        const row = await env.DB.prepare(`SELECT measurement_json FROM paid_measurements
          WHERE diagnosis_id=? AND question_id=? AND channel='google_ai_mode'`).bind(body.diagnosis_id, body.question_id).first();
        const measurement = row?.measurement_json ? JSON.parse(row.measurement_json) : null;
        if (!measurement?.raw_response_ref) return json({ ok: false, error: 'Existing task id not found' }, 404);
        if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) return json({ ok: false, error: 'DataForSEO credentials are not configured' }, 503);
        const authorization = `Basic ${btoa(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`)}`;
        const headers = { authorization };
        const [readyResponse, taskResponse] = await Promise.all([
          fetch('https://api.dataforseo.com/v3/serp/google/ai_mode/tasks_ready', { method: 'GET', headers }),
          fetch(`https://api.dataforseo.com/v3/serp/google/ai_mode/task_get/advanced/${encodeURIComponent(measurement.raw_response_ref)}`, { method: 'GET', headers })
        ]);
        return json({ ok: true, task_id: measurement.raw_response_ref,
          tasks_ready_http_status: readyResponse.status, tasks_ready: await readyResponse.json(),
          task_get_http_status: taskResponse.status, task_get: await taskResponse.json() });
      } catch (error) { return json({ ok: false, error: error.message }, 502); }
    }
    if (url.pathname === '/api/integration/dataforseo-catalog' && request.method === 'POST') {
      if (!isIsolatedTestEnvironment(env) || !env.MADOHA_INTEGRATION_ACCESS_TOKEN) return json({ ok: false, error: 'Not found' }, 404);
      if (!await secureTextEqual(request.headers.get('authorization'), `Bearer ${env.MADOHA_INTEGRATION_ACCESS_TOKEN}`)) return json({ ok: false, error: 'Forbidden' }, 403);
      if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) return json({ ok: false, error: 'DataForSEO credentials are not configured' }, 503);
      try {
        const authorization = `Basic ${btoa(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`)}`; const headers = { authorization };
        const [locationsResponse, languagesResponse] = await Promise.all([
          fetch('https://api.dataforseo.com/v3/serp/google/locations/jp', { method: 'GET', headers }),
          fetch('https://api.dataforseo.com/v3/serp/google/ai_mode/languages', { method: 'GET', headers })
        ]);
        const locationsPayload = await locationsResponse.json(); const languagesPayload = await languagesResponse.json();
        const locations = (locationsPayload.tasks?.[0]?.result || []).filter(item => /Urayasu|Ichikawa|Chiba/i.test(item.location_name || '') || Number(item.location_code) === 2392);
        const languages = (languagesPayload.tasks?.[0]?.result || []).filter(item => item.language_code === 'ja');
        return json({ ok: locationsResponse.ok && languagesResponse.ok, locations_status: locationsPayload.status_code, languages_status: languagesPayload.status_code, locations, languages });
      } catch (error) { return json({ ok: false, error: error.message }, 502); }
    }
    if (url.pathname === '/api/free-check' && request.method === 'POST') {
      try {
        const body = await request.json();
        const result = await runFreeCheck(body?.url);
        return json({ ok: true, result });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : '診断に失敗しました。' }, 400);
      }
    }
    if (url.pathname === '/api/checkout' && request.method === 'POST') {
      if (env.MADOHA_ENABLE_SALES_FLOW === 'true') return json({ error: '無料診断結果から完全版を購入してください。' }, 409);
      try {
        const body = await request.json();
        const targetUrl = normalizePublicUrl(body?.url).href;
        return json({ ok: true, ...(await createCheckout(env, { siteUrl: url.origin, targetUrl })) });
      } catch (error) { return json({ ok: false, error: error.message || '決済を開始できませんでした。' }, 400); }
    }
    if (url.pathname === '/api/stripe/webhook' && request.method === 'POST') {
      const raw = await request.text();
      if (!await verifyStripeSignature(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET)) return json({ ok: false }, 400);
      try { const event = JSON.parse(raw); return json({ ok: true, ...((await applyUpgradeEvent(env, event)) || await applyStripeEvent(env, event)) }); }
      catch (error) { return json({ ok: false, error: error.message }, 400); }
    }
    const questionsMatch = url.pathname.match(/^\/api\/paid-diagnosis\/([0-9a-f-]{36})\/questions(?:\/(confirm|discover))?$/i);
    if (questionsMatch) {
      if (!env.DB) return json({ ok: false, error: '診断機能は準備中です。' }, 503);
      const sessionId = request.headers.get('x-checkout-session');
      if (!await verifyCheckoutAccess(env, questionsMatch[1], sessionId)) return json({ ok: false, error: '閲覧権限を確認できません。' }, 403);
      try {
        if (request.method === 'GET' && !questionsMatch[2]) return json({ ok: true, review: await getQuestionReview(env.DB, questionsMatch[1]) });
        const body = await request.json();
        if (request.method === 'PUT' && !questionsMatch[2]) {
          const result = await saveQuestionDraft(env.DB, questionsMatch[1], body?.questions);
          return json({ ok: result.saved, result }, result.saved ? 200 : 422);
        }
        if (request.method === 'POST' && questionsMatch[2] === 'confirm') {
          const result = await confirmQuestionSet(env.DB, questionsMatch[1], body?.acknowledged_warning_codes);
          return json({ ok: result.confirmed, result }, result.confirmed ? 200 : 422);
        }
        if (request.method === 'POST' && questionsMatch[2] === 'discover') {
          const discovery = await generateAndSaveQuestionDiscovery(env.DB, questionsMatch[1], body?.discovery || body);
          return json({ ok: true, mix: { discovery_count: discovery.mix.discovery_count, brand_count: discovery.mix.brand_count, reason: discovery.mix.reason }, review: await getQuestionReview(env.DB, questionsMatch[1]) });
        }
      } catch (error) { return json({ ok: false, error: error.message }, error.status || 400); }
      return json({ ok: false, error: 'Not found' }, 404);
    }
    const paidMatch = url.pathname.match(/^\/api\/paid-diagnosis\/([0-9a-f-]{36})(?:\/(start))?$/i);
    if (paidMatch && request.method === 'GET' && !paidMatch[2]) {
      if (!env.DB) return json({ ok: false, error: '診断機能は準備中です。' }, 503);
      const sessionId = request.headers.get('x-checkout-session');
      if (!await verifyCheckoutAccess(env, paidMatch[1], sessionId)) return json({ ok: false, error: '閲覧権限を確認できません。' }, 403);
      const order = await getBuyerDiagnosis(env.DB, paidMatch[1]);
      return order ? json({ ok: true, order }) : json({ ok: false, error: '診断申込が見つかりません。' }, 404);
    }
    if (paidMatch?.[2] === 'start' && request.method === 'POST') {
      if (!env.DB || !env.DIAGNOSIS_QUEUE) return json({ ok: false, error: '診断機能は準備中です。' }, 503);
      const sessionId = request.headers.get('x-checkout-session');
      if (!await verifyCheckoutAccess(env, paidMatch[1], sessionId)) return json({ ok: false, error: '決済を確認できません。' }, 403);
      const confirmation = await env.DB.prepare("SELECT questions_confirmed_at,(SELECT COUNT(*) FROM diagnosis_questions WHERE diagnosis_id=? AND confirmed=1) AS confirmed_count FROM diagnosis_orders WHERE id=?").bind(paidMatch[1], paidMatch[1]).first();
      if (!confirmation?.questions_confirmed_at || Number(confirmation.confirmed_count) !== 10) return json({ ok: false, error: '診断する10質問を確認・確定してください。' }, 409);
      const queued = await env.DB.prepare("UPDATE diagnosis_orders SET diagnosis_status='queued',pipeline_state='queued',updated_at=datetime('now') WHERE id=? AND payment_status='paid' AND diagnosis_status='paid' AND questions_confirmed_at IS NOT NULL").bind(paidMatch[1]).run();
      if (Number(queued.meta?.changes || 0) === 1) await env.DIAGNOSIS_QUEUE.send({ orderId: paidMatch[1] });
      const order = await env.DB.prepare('SELECT id,diagnosis_status FROM diagnosis_orders WHERE id=?').bind(paidMatch[1]).first();
      return json({ ok: true, result: order });
    }
    if (url.pathname.startsWith('/api/')) return json({ ok: false, error: 'Not found' }, 404);
    // Real-company fixture assets remain available for internal regression tests, but are
    // never exposed as a permanent public sales sample.
    if (['/sample-kyoudo.html','/sample-kyoudo-data.js','/data/samples/kyoudo-housing-paid-diagnosis.json'].includes(url.pathname)) return new Response('Not Found', {
      status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
    });
    return env.ASSETS.fetch(request);
  },
  async scheduled(_event, env) { await dispatchSalesOutbox(env); },
  async queue(batch, env) {
    for (const message of batch.messages) {
      try { const result = await processQueueMessage(env, message.body); if (result.action === 'ack') message.ack(); else message.retry({ delaySeconds: 60 }); }
      catch { message.retry({ delaySeconds: 60 }); }
    }
  }
};
