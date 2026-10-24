import test from 'node:test';
import assert from 'node:assert/strict';
import { mainText, pickBusinessLinks, sanitizeSummary, summarizeSite, DEFAULT_SUMMARY_MODEL, FALLBACK_SUMMARY_MODEL } from '../../worker/site-summary.mjs';
import { inspectIdentitySite } from '../../worker/free-check.mjs';
import { searchPlaces } from '../../worker/place-search.mjs';
import { resolveIdentityInput } from '../../worker/identity-resolution.mjs';
import { createSalesDraft, handleSalesRequest } from '../../worker/sales-flow.mjs';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';

const html = '<html><title>株式会社サンプル</title><nav>会社概要 お知らせ</nav><h1>くらしを豊かに。</h1><p>ホームセンター。園芸用品と家具を販売しています。</p></html>';
const pages = [{ url: new URL('https://example.jp/'), html }];
const summary = { name: '株式会社サンプル', industry: 'ホームセンター', main_services: ['園芸用品', '家具', '会社概要', 'くらしを豊かに。'], region: '埼玉県本庄市', confidence: 'high' };

test('AI summary removes navigation and slogans while preserving concrete products', () => {
  assert.doesNotMatch(mainText(html), /会社概要|お知らせ/);
  assert.deepEqual(sanitizeSummary(summary).main_services, ['園芸用品', '家具']);
  assert.deepEqual(sanitizeSummary(null).main_services, []);
});

test('business link selection skips invalid escapes and external or unsafe links', () => {
  const links = pickBusinessLinks('<a href="/bad%ZZ">サービス</a><a href="https://elsewhere.jp/service">事業</a><a href="javascript:alert(1)">事業</a><a href="/service/">商品</a>', pages[0].url);
  assert.deepEqual(links.map(url => url.href), ['https://example.jp/service/']);
});

test('AI extraction overrides incidental logistics keywords and keeps provenance through URL resolution', async () => {
  const env = { AI: { run: async () => ({ choices: [{ message: { content: JSON.stringify(summary) } }] }) } };
  const fetchImpl = async () => new Response(html + '<p>配送 配送 配送</p>', { headers: { 'content-type': 'text/html' } });
  const result = await resolveIdentityInput({ query: 'https://example.jp/' }, { inspectUrl: (url, hints) => inspectIdentitySite(url, fetchImpl, { env, hints }) });
  const candidate = result.candidates[0];
  assert.equal(candidate.industry, 'ホームセンター');
  assert.equal(candidate.extraction.method, 'ai_summary');
  assert.equal(candidate.extraction.model, DEFAULT_SUMMARY_MODEL);
  assert.deepEqual(candidate.main_services, ['園芸用品', '家具']);
});

test('malformed primary AI output falls back to the configured available model', async () => {
  const calls = [];
  const result = await summarizeSite({ AI: { run: async model => { calls.push(model); return { response: calls.length === 1 ? 'invalid' : JSON.stringify(summary) }; } } }, pages);
  assert.deepEqual(calls, [DEFAULT_SUMMARY_MODEL, FALLBACK_SUMMARY_MODEL]);
  assert.equal(result.model, FALLBACK_SUMMARY_MODEL);
  assert.equal(await summarizeSite({}, pages), null);
});

test('AI failure retains rule extraction and a lone delivery word cannot set logistics industry', async () => {
  const result = await inspectIdentitySite('https://example.jp/', async () => new Response(html + '<p>配送</p>', { headers: { 'content-type': 'text/html' } }), { env: { AI: { run: async () => ({ response: 'invalid' }) } } });
  assert.equal(result.extraction.method, 'rules');
  assert.equal(result.industry, '');
});

test('Places without a key makes no external requests and unknown names remain editable', async () => {
  assert.equal(await searchPlaces({}, 'ナナガーデン 浦安', () => { throw new Error('unexpected network'); }), null);
  const result = await resolveIdentityInput({ query: 'ナナガーデン' }, { searchPlaces: () => searchPlaces({}, 'ナナガーデン') });
  assert.equal(result.status, 'needs_details');
});

test('inspect enforces IP limiter before fetching pages or invoking AI', async () => {
  let limiterKey;
  const response = await handleSalesRequest(new Request('https://madoha.jp/api/sales/inspect', { method: 'POST', headers: { 'cf-connecting-ip': '192.0.2.1' }, body: JSON.stringify({ query: 'https://example.jp/' }) }), { DIAGNOSIS_ENTRY_LIMITER: { limit: async ({ key }) => { limiterKey = key; return { success: false }; } } });
  assert.equal(response.status, 429);
  assert.equal(limiterKey, 'inspect:192.0.2.1');
});

test('removed services cannot return through hidden headings or products in the saved questions', async t => {
  const db = await sqliteD1();
  t.after(() => db.close());
  const entity = { name: '検証ホームセンター', industry: '小売業', main_services: ['園芸用品'], headings: ['削除したキャッチコピー', '家具販売'], main_products: ['家具販売'], region_enabled: false };
  const draft = await createSalesDraft({ DB: db }, { entity });
  assert.ok(draft.questions.length >= 4 && draft.questions.length <= 10);
  assert.doesNotMatch(JSON.stringify(draft.questions), /削除したキャッチコピー|家具販売/);
  const row = await db.prepare('SELECT entity_json FROM diagnosis_orders WHERE id=?').bind(draft.id).first();
  const saved = JSON.parse(row.entity_json);
  assert.deepEqual(saved.headings, []);
  assert.deepEqual(saved.main_products, []);
});
