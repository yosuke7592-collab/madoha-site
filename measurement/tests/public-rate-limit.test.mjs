import test from 'node:test';
import assert from 'node:assert/strict';
import { limitPublicSalesEntry } from '../../worker/public-rate-limit.mjs';

test('public identity and draft endpoints are rate limited by path and client address', async () => {
  const keys = [];
  const env = { DIAGNOSIS_ENTRY_LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: keys.length < 2 }; } } };
  const headers = { 'cf-connecting-ip': '203.0.113.10' };
  const first = await limitPublicSalesEntry(new Request('https://madoha.jp/api/sales/inspect', { method: 'POST', headers }), env);
  assert.equal(first, null);
  const blocked = await limitPublicSalesEntry(new Request('https://madoha.jp/api/sales/draft', { method: 'POST', headers }), env);
  assert.equal(blocked.status, 429);
  assert.deepEqual(keys, ['/api/sales/inspect:203.0.113.10', '/api/sales/draft:203.0.113.10']);
});

test('public rate limiter does not affect reads or unrelated endpoints', async () => {
  const env = { DIAGNOSIS_ENTRY_LIMITER: { limit: async () => { throw new Error('must not run'); } } };
  assert.equal(await limitPublicSalesEntry(new Request('https://madoha.jp/api/sales/inspect'), env), null);
  assert.equal(await limitPublicSalesEntry(new Request('https://madoha.jp/api/sales/config', { method: 'POST' }), env), null);
});

test('legacy free-check is covered by the same public entry limiter', async () => {
  const keys = [];
  const env = { DIAGNOSIS_ENTRY_LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: true }; } } };
  assert.equal(await limitPublicSalesEntry(new Request('https://madoha.jp/api/free-check', { method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.20' } }), env), null);
  assert.deepEqual(keys, ['/api/free-check:203.0.113.20']);
});
