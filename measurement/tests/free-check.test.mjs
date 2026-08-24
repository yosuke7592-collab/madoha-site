import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHtml, normalizePublicUrl, runFreeCheck } from '../../worker/free-check.mjs';

test('rejects local and unsafe URLs', () => {
  for (const value of ['localhost', '127.0.0.1', '10.0.0.1', 'file:///etc/passwd']) assert.throws(() => normalizePublicUrl(value));
});

test('scores public page signals without an AI API', () => {
  const result = analyzeHtml('<html lang="ja"><head><title>株式会社テスト</title><meta name="description" content="これは企業のサービス内容を分かりやすく説明する十分な長さの紹介文です。詳しい情報をご案内します。"><link rel="canonical"><script type="application/ld+json">{"@type":"Organization"}</script></head><body><h1>会社概要</h1><h2>よくある質問 FAQ</h2></body></html>', new URL('https://example.com'));
  assert.equal(result.kind, 'free-site-readiness-check');
  assert.equal(result.score, 100);
  assert.match(result.disclaimer, /順位や推薦状況を測定したものではありません/);
});

test('follows a safe redirect and returns a result', async () => {
  let calls = 0;
  const result = await runFreeCheck('example.com', async () => {
    calls += 1;
    if (calls === 1) return new Response('', { status: 302, headers: { location: 'https://www.example.com/' } });
    return new Response('<html><head><title>Example</title></head><body><h1>Example</h1></body></html>', { headers: { 'content-type': 'text/html' } });
  });
  assert.equal(result.host, 'www.example.com');
  assert.equal(calls, 2);
});
