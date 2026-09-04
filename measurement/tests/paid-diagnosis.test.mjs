import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPaidOrder, PRICE_JPY, runPaidDiagnosis, verifyCheckoutAccess, verifyStripeSignature } from '../../worker/paid-diagnosis.mjs';

test('AI diagnosis is locked unless server-side payment state is paid', () => {
  assert.throws(() => assertPaidOrder(null));
  assert.throws(() => assertPaidOrder({ payment_status: 'pending', diagnosis_status: 'queued' }), /決済/);
  assert.throws(() => assertPaidOrder({ payment_status: 'paid', diagnosis_status: 'complete' }), /開始/);
  assert.doesNotThrow(() => assertPaidOrder({ payment_status: 'paid', diagnosis_status: 'queued' }));
  assert.equal(PRICE_JPY, 4980);
});

test('legacy one-shot AI execution stays fail-closed before v1 production connection', async () => {
  await assert.rejects(
    runPaidDiagnosis({}, { id: 'test', payment_status: 'paid', diagnosis_status: 'queued' }),
    /3チャネル測定は本番接続前/,
  );
});

test('Stripe signature requires valid HMAC and rejects stale events', async () => {
  const payload = '{"id":"evt_test"}';
  const secret = 'whsec_test_only';
  const timestamp = 2000000000;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const signature = [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
  assert.equal(await verifyStripeSignature(payload, `t=${timestamp},v1=${signature}`, secret, timestamp), true);
  assert.equal(await verifyStripeSignature(payload, `t=${timestamp},v1=bad`, secret, timestamp), false);
  assert.equal(await verifyStripeSignature(payload, `t=${timestamp},v1=${signature}`, secret, timestamp + 301), false);
});

test('Stripe-free access is restricted to a paid order in the integration environment', async () => {
  const DB = { prepare: () => ({ bind: orderId => ({ first: async () => orderId === 'paid-id' ? { id: orderId } : null }) }) };
  const integration = { ENVIRONMENT: 'integration', MADOHA_INTEGRATION_ACCESS_TOKEN: 'local-token', DB };
  assert.equal(await verifyCheckoutAccess(integration, 'paid-id', 'local-token'), true);
  assert.equal(await verifyCheckoutAccess({ ...integration, ENVIRONMENT: 'staging' }, 'paid-id', 'local-token'), true);
  assert.equal(await verifyCheckoutAccess(integration, 'missing-id', 'local-token'), false);
  assert.equal(await verifyCheckoutAccess({ ...integration, ENVIRONMENT: 'production' }, 'paid-id', 'local-token'), false);
  assert.equal(await verifyCheckoutAccess(integration, 'paid-id', 'wrong-token'), false);
});
