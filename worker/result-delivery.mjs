const encoder = new TextEncoder();
const decoder = new TextDecoder();

const fail = (message, status = 500) => { throw Object.assign(new Error(message), { status }); };
const bytesToBase64Url = bytes => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};
const base64UrlToBytes = value => {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};
const randomValue = (length = 24) => { const bytes = new Uint8Array(length); crypto.getRandomValues(bytes); return bytesToBase64Url(bytes); };
const digestHex = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const secureEqual = (left, right) => {
  const a = encoder.encode(String(left || ''));
  const b = encoder.encode(String(right || ''));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] || 0) ^ (b[index] || 0);
  return difference === 0;
};
const importHmacKey = secret => crypto.subtle.importKey('raw', base64UrlToBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const hmacBytes = async (secret, value) => new Uint8Array(await crypto.subtle.sign('HMAC', await importHmacKey(secret), encoder.encode(value)));
const requiredSecret = (env, name) => {
  const value = String(env?.[name] || '');
  if (!value) fail(`${name} is not configured`, 503);
  return value;
};

export function normalizeBuyerEmail(value) {
  const email = String(value || '').normalize('NFKC').trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) fail('購入者メールを確認できません。', 400);
  return email;
}

export async function emailLookupHash(env, email) {
  const normalized = normalizeBuyerEmail(email);
  return bytesToBase64Url(await hmacBytes(requiredSecret(env, 'MADOHA_EMAIL_LOOKUP_SECRET'), `madoha-email-v1:${normalized}`));
}

export async function encryptBuyerEmail(env, email) {
  const keyBytes = base64UrlToBytes(requiredSecret(env, 'MADOHA_EMAIL_ENCRYPTION_KEY'));
  if (keyBytes.length !== 32) fail('メール暗号化設定を確認してください。', 503);
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(normalizeBuyerEmail(email))));
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(ciphertext)}`;
}

export async function decryptBuyerEmail(env, encrypted) {
  const [version, ivValue, ciphertextValue] = String(encrypted || '').split('.');
  if (version !== 'v1' || !ivValue || !ciphertextValue) fail('購入者メールを復号できません。', 500);
  const keyBytes = base64UrlToBytes(requiredSecret(env, 'MADOHA_EMAIL_ENCRYPTION_KEY'));
  if (keyBytes.length !== 32) fail('メール暗号化設定を確認してください。', 503);
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlToBytes(ivValue) }, key, base64UrlToBytes(ciphertextValue));
    return normalizeBuyerEmail(decoder.decode(plain));
  } catch { fail('購入者メールを復号できません。', 500); }
}

export async function resultTokenFromNonce(env, diagnosisId, nonce) {
  if (!/^[0-9a-f-]{36}$/i.test(String(diagnosisId || '')) || !nonce) fail('結果URLを作成できません。', 500);
  return bytesToBase64Url(await hmacBytes(requiredSecret(env, 'MADOHA_RESULT_TOKEN_SECRET'), `madoha-result-v1:${diagnosisId}:${nonce}`));
}

export const hashResultToken = digestHex;

export async function storeBuyerEmail(env, diagnosisId, email) {
  const normalized = normalizeBuyerEmail(email);
  const [ciphertext, lookupHash] = await Promise.all([encryptBuyerEmail(env, normalized), emailLookupHash(env, normalized)]);
  await env.DB.prepare(`INSERT INTO diagnosis_delivery
    (diagnosis_id,buyer_email_ciphertext,buyer_email_lookup_hash,completion_email_status,created_at,updated_at)
    VALUES (?,?,?,'pending',datetime('now'),datetime('now'))
    ON CONFLICT(diagnosis_id) DO UPDATE SET
      buyer_email_ciphertext=excluded.buyer_email_ciphertext,
      buyer_email_lookup_hash=excluded.buyer_email_lookup_hash,
      updated_at=datetime('now')`)
    .bind(diagnosisId, ciphertext, lookupHash).run();
}

async function ensurePendingResultToken(env, diagnosisId, delivery) {
  let nonce = delivery.pending_result_token_nonce;
  if (!nonce) {
    nonce = randomValue();
    const token = await resultTokenFromNonce(env, diagnosisId, nonce);
    const tokenHash = await hashResultToken(token);
    await env.DB.prepare(`UPDATE diagnosis_delivery SET
      pending_result_token_hash=?,pending_result_token_nonce=?,last_email_error=NULL,updated_at=datetime('now')
      WHERE diagnosis_id=?`).bind(tokenHash, nonce, diagnosisId).run();
    return { token, tokenHash, nonce };
  }
  const token = await resultTokenFromNonce(env, diagnosisId, nonce);
  return { token, tokenHash: await hashResultToken(token), nonce };
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const resultUrl = (env, diagnosisId, token) => `${String(env.PUBLIC_SITE_URL || 'https://madoha.jp').replace(/\/$/, '')}/?diagnosis=${encodeURIComponent(diagnosisId)}#result_token=${encodeURIComponent(token)}`;

async function sendResultEmail(env, { to, targetName, url, idempotencyKey }) {
  const fetchImpl = typeof env.RESULT_EMAIL_FETCH === 'function' ? env.RESULT_EMAIL_FETCH : fetch;
  const subject = 'MADOHA｜AI検索診断が完了しました';
  const safeName = escapeHtml(targetName || '診断対象');
  const safeUrl = escapeHtml(url);
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      authorization: `Bearer ${requiredSecret(env, 'RESEND_API_KEY')}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey
    },
    body: JSON.stringify({
      from: 'MADOHA <results@madoha.jp>',
      to: [to],
      reply_to: 'info@madoha.jp',
      subject,
      text: `${targetName || '診断対象'}のAI検索診断が完了しました。\n\n結果を見る：${url}\n\nこのURLから診断結果を後から再閲覧できます。\nお問い合わせ：info@madoha.jp`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans JP',sans-serif;color:#071526;line-height:1.8;max-width:620px;margin:auto"><p style="font-family:Georgia,serif;font-weight:700;letter-spacing:.08em">MADOHA</p><h1 style="font-size:24px">AI検索診断が完了しました</h1><p><strong>${safeName}</strong>の診断結果をご確認いただけます。</p><p style="margin:30px 0"><a href="${safeUrl}" style="display:inline-block;background:#071526;color:#fff;text-decoration:none;padding:14px 24px;border-radius:6px;font-weight:700">診断結果を見る</a></p><p>このURLから診断結果を後から再閲覧できます。</p><p style="color:#53657a;font-size:14px">お問い合わせ：<a href="mailto:info@madoha.jp">info@madoha.jp</a></p></div>`
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id) fail('結果メールを送信できませんでした。', 502);
  return payload.id;
}

export async function ensureCompletionEmail(env, diagnosisId) {
  const order = await env.DB.prepare(`SELECT o.id,o.payment_status,o.sales_stage,o.diagnosis_status,o.entity_json,
    d.buyer_email_ciphertext,d.result_token_hash,d.pending_result_token_hash,d.pending_result_token_nonce,d.completion_email_sent_at
    FROM diagnosis_orders o LEFT JOIN diagnosis_delivery d ON d.diagnosis_id=o.id WHERE o.id=?`).bind(diagnosisId).first();
  if (!order || order.payment_status !== 'paid' || order.sales_stage !== 'completed' || order.diagnosis_status !== 'complete') return { sent: false, reason: 'not_completed' };
  if (!order.buyer_email_ciphertext) return { sent: false, reason: 'email_missing' };
  if (order.completion_email_sent_at) return { sent: false, reason: 'already_sent' };
  const pending = await ensurePendingResultToken(env, diagnosisId, order);
  const email = await decryptBuyerEmail(env, order.buyer_email_ciphertext);
  const entity = (() => { try { return JSON.parse(order.entity_json || '{}'); } catch { return {}; } })();
  try {
    await sendResultEmail(env, { to: email, targetName: entity.name, url: resultUrl(env, diagnosisId, pending.token), idempotencyKey: `diagnosis-complete/${diagnosisId}` });
    await env.DB.prepare(`UPDATE diagnosis_delivery SET
      result_token_hash=?,result_token_nonce=?,pending_result_token_hash=NULL,pending_result_token_nonce=NULL,
      completion_email_status='sent',completion_email_sent_at=datetime('now'),last_email_error=NULL,updated_at=datetime('now')
      WHERE diagnosis_id=? AND completion_email_sent_at IS NULL AND pending_result_token_hash=?`)
      .bind(pending.tokenHash, pending.nonce, diagnosisId, pending.tokenHash).run();
    return { sent: true };
  } catch (error) {
    await env.DB.prepare("UPDATE diagnosis_delivery SET last_email_error='send_failed',updated_at=datetime('now') WHERE diagnosis_id=?")
      .bind(diagnosisId).run();
    throw error;
  }
}

export async function authorizeResultToken(db, diagnosisId, token) {
  if (!token || token.length > 128) return null;
  const row = await db.prepare(`SELECT o.* FROM diagnosis_orders o JOIN diagnosis_delivery d ON d.diagnosis_id=o.id
    WHERE o.id=? AND o.payment_status='paid' AND o.sales_stage='completed' AND o.diagnosis_status='complete'`)
    .bind(diagnosisId).first();
  if (!row) return null;
  const delivery = await db.prepare('SELECT result_token_hash FROM diagnosis_delivery WHERE diagnosis_id=?').bind(diagnosisId).first();
  return delivery?.result_token_hash && secureEqual(await digestHex(token), delivery.result_token_hash) ? row : null;
}

const RESEND_REQUEST_TTL_DAYS = 2;
const RESEND_COOLDOWN_MINUTES = 15;
const RESEND_DAILY_LIMIT = 3;
const RESEND_GLOBAL_DAILY_LIMIT = 200;
const RESEND_QUEUE_LIMIT = 100;
const RESEND_PROCESS_BATCH = 20;
const DELIVERY_CLEANUP_BATCH = 50;

const limit = (env, key, fallback) => {
  const value = Number(env?.[key] ?? fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

export async function queueResultResend(env, email) {
  let lookupHash;
  try { lookupHash = await emailLookupHash(env, email); } catch { return { accepted: true, queued: false }; }
  const queueLimit = Math.min(RESEND_QUEUE_LIMIT, limit(env, 'MADOHA_RESULT_RESEND_QUEUE_LIMIT', RESEND_QUEUE_LIMIT));
  // Keep both retained and pending public requests bounded without looking up
  // orders. Processed entries may be recycled, but a pending entry is never
  // evicted by another public request.
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM result_resend_requests
      WHERE email_lookup_hash=(SELECT email_lookup_hash FROM result_resend_requests
        WHERE processed_at IS NOT NULL ORDER BY requested_at LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM result_resend_requests WHERE email_lookup_hash=?)
        AND (SELECT COUNT(*) FROM result_resend_requests)>=?`)
      .bind(lookupHash, queueLimit),
    env.DB.prepare(`INSERT INTO result_resend_requests (email_lookup_hash,requested_at,available_at,processed_at,expires_at)
      SELECT ?,datetime('now'),datetime('now'),NULL,datetime('now','+${RESEND_REQUEST_TTL_DAYS} days')
      WHERE (SELECT COUNT(*) FROM result_resend_requests WHERE processed_at IS NULL AND expires_at>datetime('now'))<?
      ON CONFLICT(email_lookup_hash) DO UPDATE SET
        requested_at=excluded.requested_at,available_at=excluded.available_at,processed_at=NULL,
        expires_at=excluded.expires_at
      WHERE result_resend_requests.available_at<=datetime('now')
        AND (result_resend_requests.processed_at IS NULL
          OR (SELECT COUNT(*) FROM result_resend_requests WHERE processed_at IS NULL AND expires_at>datetime('now'))<?)`)
      .bind(lookupHash, queueLimit, queueLimit)
  ]);
  return { accepted: true, queued: true };
}

async function reserveGlobalResend(env) {
  const max = limit(env, 'MADOHA_RESULT_RESEND_GLOBAL_DAILY_LIMIT', RESEND_GLOBAL_DAILY_LIMIT);
  const result = await env.DB.prepare(`INSERT INTO diagnosis_daily_limits (scope,day,count) VALUES ('result_resend',date('now'),1)
    ON CONFLICT(scope,day) DO UPDATE SET count=count+1 WHERE count<?`).bind(max).run();
  return Number(result.meta?.changes || 0) === 1;
}

async function claimRecipientResend(env, diagnosisId) {
  const max = limit(env, 'MADOHA_RESULT_RESEND_DAILY_LIMIT', RESEND_DAILY_LIMIT);
  const result = await env.DB.prepare(`UPDATE diagnosis_delivery SET
    resend_lock_until=datetime('now','+2 minutes'),
    resend_cooldown_until=datetime('now','+${RESEND_COOLDOWN_MINUTES} minutes'),
    resend_window_count=CASE WHEN resend_window_started_at IS NULL OR resend_window_started_at<datetime('now','-1 day') THEN 1 ELSE resend_window_count+1 END,
    resend_window_started_at=CASE WHEN resend_window_started_at IS NULL OR resend_window_started_at<datetime('now','-1 day') THEN datetime('now') ELSE resend_window_started_at END,
    updated_at=datetime('now')
    WHERE diagnosis_id=?
      AND (resend_lock_until IS NULL OR resend_lock_until<datetime('now'))
      AND (resend_cooldown_until IS NULL OR resend_cooldown_until<datetime('now'))
      AND (resend_window_started_at IS NULL OR resend_window_started_at<datetime('now','-1 day') OR resend_window_count<?)`)
    .bind(diagnosisId, max).run();
  return Number(result.meta?.changes || 0) === 1;
}

async function deliverQueuedResultResend(env, lookupHash) {
  const order = await env.DB.prepare(`SELECT o.id,o.entity_json,d.* FROM diagnosis_orders o JOIN diagnosis_delivery d ON d.diagnosis_id=o.id
    WHERE d.buyer_email_lookup_hash=? AND o.payment_status='paid' AND o.sales_stage='completed' AND o.diagnosis_status='complete'
    ORDER BY o.completed_at DESC LIMIT 1`).bind(lookupHash).first();
  if (!order || !(await claimRecipientResend(env, order.id)) || !(await reserveGlobalResend(env))) return { accepted: true };
  const nonce = randomValue();
  const token = await resultTokenFromNonce(env, order.id, nonce);
  const tokenHash = await hashResultToken(token);
  await env.DB.prepare(`UPDATE diagnosis_delivery SET pending_result_token_hash=?,pending_result_token_nonce=?,last_email_error=NULL,updated_at=datetime('now') WHERE diagnosis_id=?`)
    .bind(tokenHash, nonce, order.id).run();
  const entity = (() => { try { return JSON.parse(order.entity_json || '{}'); } catch { return {}; } })();
  try {
    await sendResultEmail(env, { to: await decryptBuyerEmail(env, order.buyer_email_ciphertext), targetName: entity.name, url: resultUrl(env, order.id, token), idempotencyKey: `diagnosis-resend/${order.id}/${nonce}` });
    await env.DB.prepare(`UPDATE diagnosis_delivery SET result_token_hash=?,result_token_nonce=?,pending_result_token_hash=NULL,
      pending_result_token_nonce=NULL,resend_lock_until=NULL,last_email_error=NULL,updated_at=datetime('now')
      WHERE diagnosis_id=? AND pending_result_token_hash=?`).bind(tokenHash, nonce, order.id, tokenHash).run();
  } catch {
    await env.DB.prepare(`UPDATE diagnosis_delivery SET pending_result_token_hash=NULL,pending_result_token_nonce=NULL,
      resend_lock_until=NULL,last_email_error='send_failed',updated_at=datetime('now') WHERE diagnosis_id=? AND pending_result_token_hash=?`)
      .bind(order.id, tokenHash).run();
  }
  return { accepted: true };
}

export async function processQueuedResultResends(env, maximum = 20) {
  if (!env?.DB) return;
  const rows = await env.DB.prepare(`SELECT email_lookup_hash FROM result_resend_requests
    WHERE processed_at IS NULL AND available_at<=datetime('now') AND expires_at>datetime('now')
    ORDER BY CASE WHEN EXISTS (
      SELECT 1 FROM diagnosis_delivery d JOIN diagnosis_orders o ON o.id=d.diagnosis_id
      WHERE d.buyer_email_lookup_hash=result_resend_requests.email_lookup_hash
        AND o.payment_status='paid' AND o.sales_stage='completed' AND o.diagnosis_status='complete'
    ) THEN 0 ELSE 1 END, requested_at
    LIMIT ?`).bind(Math.max(1, Math.min(100, Number(maximum) || RESEND_PROCESS_BATCH))).all();
  for (const row of rows.results || []) {
    await env.DB.prepare("UPDATE result_resend_requests SET processed_at=datetime('now'),available_at=datetime('now','+15 minutes') WHERE email_lookup_hash=? AND processed_at IS NULL")
      .bind(row.email_lookup_hash).run();
    try { await deliverQueuedResultResend(env, row.email_lookup_hash); } catch { /* keep a uniform public acknowledgement */ }
  }
}

export async function cleanupExpiredDeliverySecurityRows(env) {
  if (!env?.DB) return;
  const batch = Math.min(DELIVERY_CLEANUP_BATCH, limit(env, 'MADOHA_DELIVERY_CLEANUP_BATCH', DELIVERY_CLEANUP_BATCH));
  // Keep unrelated cleanup independent: a draft with unexpected child data must
  // not roll back expired resend-request cleanup.
  await env.DB.prepare(`DELETE FROM result_resend_requests WHERE email_lookup_hash IN (
    SELECT email_lookup_hash FROM result_resend_requests WHERE expires_at<datetime('now') ORDER BY expires_at LIMIT ?
  )`).bind(batch).run();
  const expired = await env.DB.prepare(`SELECT id FROM diagnosis_orders
    WHERE payment_status='pending' AND draft_expires_at IS NOT NULL AND draft_expires_at<datetime('now')
    ORDER BY draft_expires_at LIMIT ?`).bind(batch).all();
  const ids = (expired.results || []).map(row => row.id).filter(Boolean);
  if (!ids.length) return;
  const marks = ids.map(() => '?').join(',');
  // Recheck pending/expiry inside every DELETE. Selection and deletion can be
  // separated by a verified webhook, so the earlier SELECT is never authority.
  const eligible = `SELECT id FROM diagnosis_orders WHERE id IN (${marks})
    AND payment_status='pending' AND draft_expires_at IS NOT NULL AND draft_expires_at<datetime('now')`;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM diagnosis_measurement_attempts WHERE diagnosis_id IN (${eligible})`).bind(...ids),
    env.DB.prepare(`DELETE FROM paid_measurements WHERE diagnosis_id IN (${eligible})`).bind(...ids),
    env.DB.prepare(`DELETE FROM diagnosis_questions WHERE diagnosis_id IN (${eligible})`).bind(...ids),
    env.DB.prepare(`DELETE FROM diagnosis_events WHERE diagnosis_id IN (${eligible})`).bind(...ids),
    env.DB.prepare(`DELETE FROM diagnosis_outbox WHERE diagnosis_id IN (${eligible})`).bind(...ids),
    env.DB.prepare(`DELETE FROM diagnosis_orders WHERE id IN (${eligible})`).bind(...ids)
  ]);
}

// Retained for internal callers. Public requests use queueResultResend and are
// processed after the response so order existence does not affect timing.
export async function resendCompletedResult(env, email) {
  await queueResultResend(env, email);
  return { accepted: true };
}

export const RESULT_RESEND_MESSAGE = '該当する診断結果がある場合はメールを送信しました';
