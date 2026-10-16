import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHtml, inspectIdentitySite, normalizePublicUrl, runFreeCheck } from '../../worker/free-check.mjs';

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

test('rejects an oversized streamed HTML response before parsing it', async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1_000_001)); controller.close(); } });
  await assert.rejects(() => runFreeCheck('example.com', async () => new Response(stream, { headers: { 'content-type': 'text/html' } })), /ページサイズが大きすぎます/);
});

test('identity inspection prefers same-domain business pages and separates explicit service regions from company location',async()=>{
  const pages=new Map([
    ['https://example.jp/',`<html><head><title>配送のことなら株式会社Example Logistics</title></head><body><header><img alt="株式会社Example Logistics"><a href="/business/">事業案内</a><a href="/recruit/">採用情報</a></header><h2>MESSAGE</h2><h2>社員紹介</h2><p>所在地 東京都港区</p></body></html>`],
    ['https://example.jp/business/',`<html><head><title>事業案内</title></head><body><h1>BUSINESS 事業案内</h1><h2>事業内容</h2><h3>DELIVERY SERVICE 個人宅への軽貨物宅配サービス</h3><h2>対応エリア</h2><img alt="千葉県全域"></body></html>`]
  ]);
  const result=await inspectIdentitySite('https://example.jp/',async url=>new Response(pages.get(url.href)||'',{status:pages.has(url.href)?200:404,headers:{'content-type':'text/html'}}));
  assert.equal(result.identity_name,'株式会社Example Logistics');
  assert.equal(result.industry,'軽貨物運送・物流');
  assert.deepEqual(result.main_services,['個人宅への軽貨物宅配サービス']);
  assert.deepEqual(result.service_regions,['千葉県全域']);
  assert.ok(result.main_services.every(value=>!/採用|社員|MESSAGE/i.test(value)));
  assert.ok(!result.service_regions.includes('東京都港区'));
});
