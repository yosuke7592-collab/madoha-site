import { normalizePublicUrl, runFreeCheck } from './free-check.mjs';
import { applyStripeEvent, createCheckout, isIsolatedTestEnvironment, secureTextEqual, verifyCheckoutAccess, verifyStripeSignature } from './paid-diagnosis.mjs';
import { getBuyerDiagnosis, processDiagnosisQueueMessage } from './diagnosis-pipeline.mjs';

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/integration/enqueue' && request.method === 'POST') {
      if (!isIsolatedTestEnvironment(env) || !env.MADOHA_INTEGRATION_ACCESS_TOKEN) return json({ ok: false, error: 'Not found' }, 404);
      if (!await secureTextEqual(request.headers.get('authorization'), `Bearer ${env.MADOHA_INTEGRATION_ACCESS_TOKEN}`)) return json({ ok: false, error: 'Forbidden' }, 403);
      const body = await request.json();
      if (!/^[0-9a-f-]{36}$/i.test(body?.diagnosis_id || '')) return json({ ok: false, error: 'Invalid diagnosis id' }, 400);
      await env.DIAGNOSIS_QUEUE.send({ orderId: body.diagnosis_id });
      return json({ ok: true, queued: body.diagnosis_id });
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
      try {
        const body = await request.json();
        const targetUrl = normalizePublicUrl(body?.url).href;
        return json({ ok: true, ...(await createCheckout(env, { siteUrl: url.origin, targetUrl })) });
      } catch (error) { return json({ ok: false, error: error.message || '決済を開始できませんでした。' }, 400); }
    }
    if (url.pathname === '/api/stripe/webhook' && request.method === 'POST') {
      const raw = await request.text();
      if (!await verifyStripeSignature(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET)) return json({ ok: false }, 400);
      try { return json({ ok: true, ...(await applyStripeEvent(env, JSON.parse(raw))) }); }
      catch (error) { return json({ ok: false, error: error.message }, 400); }
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
      const queued = await env.DB.prepare("UPDATE diagnosis_orders SET diagnosis_status='queued',pipeline_state='queued',updated_at=datetime('now') WHERE id=? AND payment_status='paid' AND diagnosis_status='paid'").bind(paidMatch[1]).run();
      if (Number(queued.meta?.changes || 0) === 1) await env.DIAGNOSIS_QUEUE.send({ orderId: paidMatch[1] });
      const order = await env.DB.prepare('SELECT id,diagnosis_status FROM diagnosis_orders WHERE id=?').bind(paidMatch[1]).first();
      return json({ ok: true, result: order });
    }
    if (url.pathname.startsWith('/api/')) return json({ ok: false, error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      try { const result = await processDiagnosisQueueMessage(env, message.body); if (result.action === 'ack') message.ack(); else message.retry({ delaySeconds: 60 }); }
      catch { message.retry({ delaySeconds: 60 }); }
    }
  }
};
