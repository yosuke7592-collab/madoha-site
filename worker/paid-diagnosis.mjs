const PRODUCT_NAME = 'MADOHA AI詳細診断';
export const PRICE_JPY = 4980;

const encode = value => new TextEncoder().encode(value);
const hex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const safeEqual = (left, right) => left.length === right.length && [...left].every((char, index) => char === right[index]);

export const isIsolatedTestEnvironment = env => env?.ENVIRONMENT === 'integration' || env?.ENVIRONMENT === 'staging';

export async function secureTextEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encode(left)),
    crypto.subtle.digest('SHA-256', encode(right))
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

export async function verifyStripeSignature(payload, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret || !header) return false;
  const pairs = Object.fromEntries(header.split(',').map(part => part.split('=', 2)));
  const timestamp = Number(pairs.t);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > 300 || !pairs.v1) return false;
  const key = await crypto.subtle.importKey('raw', encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = hex(await crypto.subtle.sign('HMAC', key, encode(`${timestamp}.${payload}`)));
  return safeEqual(signature, pairs.v1);
}

export function assertPaidOrder(order) {
  if (!order) throw new Error('診断申込が見つかりません。');
  if (order.payment_status !== 'paid') throw new Error('決済の確認が完了していません。');
  if (!['queued', 'failed'].includes(order.diagnosis_status)) throw new Error('診断はすでに開始されています。');
}

export async function createCheckout(env, { siteUrl, targetUrl }) {
  if (!env.STRIPE_SECRET_KEY || !env.DB) throw new Error('決済機能は準備中です。');
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO diagnosis_orders (id,target_url,amount_jpy,payment_status,diagnosis_status,created_at,updated_at) VALUES (?,?,?,\'pending\',\'locked\',datetime(\'now\'),datetime(\'now\'))')
    .bind(id, targetUrl, PRICE_JPY).run();
  const form = new URLSearchParams({
    mode: 'payment', 'line_items[0][price_data][currency]': 'jpy',
    'line_items[0][price_data][unit_amount]': String(PRICE_JPY),
    'line_items[0][price_data][product_data][name]': PRODUCT_NAME,
    'line_items[0][quantity]': '1', client_reference_id: id,
    success_url: `${siteUrl}/?diagnosis=${id}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/?checkout=cancelled`,
    'metadata[diagnosis_order_id]': id, 'metadata[product_code]': 'madoha_paid_diagnosis_v1',
    'payment_intent_data[metadata][diagnosis_order_id]': id
  });
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST', headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' }, body: form
  });
  const session = await response.json();
  if (!response.ok || !session.url) throw new Error('決済画面を作成できませんでした。');
  await env.DB.prepare('UPDATE diagnosis_orders SET stripe_session_id=?,updated_at=datetime(\'now\') WHERE id=?').bind(session.id, id).run();
  return { id, checkoutUrl: session.url };
}

export async function applyStripeEvent(env, event) {
  if (event?.type !== 'checkout.session.completed') return { accepted: true, ignored: true };
  const session = event.data?.object;
  const id = session?.metadata?.diagnosis_order_id || session?.client_reference_id;
  if (!event.id || !id || session?.metadata?.product_code !== 'madoha_paid_diagnosis_v1' || session.payment_status !== 'paid' || Number(session.amount_total) !== PRICE_JPY || session.currency !== 'jpy') {
    throw new Error('決済内容を確認できません。');
  }
  const existing = await env.DB.prepare('SELECT event_id FROM stripe_events WHERE event_id=?').bind(event.id).first();
  if (existing) return { accepted: true, ignored: true, id };
  await env.DB.batch([
    env.DB.prepare('INSERT INTO stripe_events (event_id,event_type,received_at) VALUES (?,?,datetime(\'now\'))').bind(event.id, event.type),
    env.DB.prepare("UPDATE diagnosis_orders SET payment_status='paid',diagnosis_status=CASE WHEN diagnosis_status='locked' THEN 'paid' ELSE diagnosis_status END,stripe_session_id=?,paid_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND amount_jpy=? AND stripe_session_id=?").bind(session.id, id, PRICE_JPY, session.id)
  ]);
  return { accepted: true, id };
}

export async function verifyCheckoutAccess(env, orderId, sessionId) {
  if (isIsolatedTestEnvironment(env) && env.DB && env.MADOHA_INTEGRATION_ACCESS_TOKEN && await secureTextEqual(sessionId, env.MADOHA_INTEGRATION_ACCESS_TOKEN)) {
    const order = await env.DB.prepare("SELECT id FROM diagnosis_orders WHERE id=? AND payment_status='paid'").bind(orderId).first();
    return Boolean(order);
  }
  if (!sessionId || !env.STRIPE_SECRET_KEY) return false;
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  if (!response.ok) return false;
  const session = await response.json();
  return session.payment_status === 'paid' && session.client_reference_id === orderId && Number(session.amount_total) === PRICE_JPY && session.currency === 'jpy';
}

export async function runPaidDiagnosis(env, order) {
  assertPaidOrder(order);
  // Paid Diagnosis v1 requires 10 questions x 3 channels x one observation.
  // The previous one-shot OpenAI report did not satisfy the formal product specification,
  // so live execution stays fail-closed until all three paid providers are connected.
  throw new Error('正式仕様v1の3チャネル測定は本番接続前です。診断は開始されていません。');
}
