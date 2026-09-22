import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalDomain, inferIdentityType, resolveIdentityInput, stableIdentityKey } from '../../worker/identity-resolution.mjs';
import { createSalesDraft, finalizeIdentityForDraft, freeIdentity } from '../../worker/sales-flow.mjs';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';

const fixture = async name => JSON.parse(await readFile(new URL(`../../data/fixtures/question-discovery/${name}.json`, import.meta.url), 'utf8'));

test('company, product and URL-only inputs resolve without making URL mandatory', async () => {
  const company = await resolveIdentityInput({ query: '株式会社協同住宅' });
  assert.equal(company.status, 'confirmation_required');
  assert.equal(company.candidates[0].identity_type, 'company');
  assert.equal(company.candidates[0].canonical_domain, 'kyoudo.jp');

  const product = await resolveIdentityInput({ query: 'kintone' });
  assert.equal(product.candidates[0].name, 'kintone');
  assert.equal(product.candidates[0].identity_type, 'product');
  assert.equal(product.candidates[0].operator_name, 'サイボウズ株式会社');

  const byUrl = await resolveIdentityInput({ query: 'https://kintone.cybozu.co.jp/features/' });
  assert.equal(byUrl.candidates[0].identity_id, product.candidates[0].identity_id);
  assert.equal(stableIdentityKey(byUrl.candidates[0]), stableIdentityKey(product.candidates[0]));
});

test('store, service, product and brand are inferred without asking the user to choose a type', () => {
  assert.equal(inferIdentityType('青空クリニック'), 'store');
  assert.equal(inferIdentityType('暮らし家事代行サービス'), 'service');
  assert.equal(inferIdentityType('案件管理ツール'), 'product');
  assert.equal(inferIdentityType('青空ブランド'), 'brand');
  assert.equal(inferIdentityType('株式会社青空'), 'company');
});

test('same-name businesses remain ambiguous until a region selects one candidate', async () => {
  const catalog = [
    { identity_id: 'store-hikari-tokyo', name: 'ひかり歯科', identity_type: 'store', entity_type: 'company', region: '東京都', industry: '歯科', official_url: 'https://tokyo-hikari.example/' },
    { identity_id: 'store-hikari-osaka', name: 'ひかり歯科', identity_type: 'store', entity_type: 'company', region: '大阪府', industry: '歯科', official_url: 'https://osaka-hikari.example/' }
  ];
  const ambiguous = await resolveIdentityInput({ query: 'ひかり歯科' }, { catalog });
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.candidates.length, 2);
  const selected = await resolveIdentityInput({ query: 'ひかり歯科', region: '大阪府' }, { catalog });
  assert.equal(selected.status, 'confirmation_required');
  assert.equal(selected.candidates[0].identity_id, 'store-hikari-osaka');
});

test('unknown names ask for distinguishing context while keeping URL optional', async () => {
  const result = await resolveIdentityInput({ query: '青空クリニック' }, { catalog: [] });
  assert.equal(result.status, 'needs_details');
  assert.equal(result.candidates[0].official_url, '');
  assert.equal(result.candidates[0].identity_type, 'store');
  assert.match(result.message, /URLは任意/);
});

test('an unregistered URL is inspected safely and keeps the canonical domain', async () => {
  let calls = 0;
  const result = await resolveIdentityInput({ query: 'example.jp' }, { catalog: [], inspectUrl: async url => {
    calls += 1;
    assert.equal(url, 'https://example.jp/');
    return { title: '青空サービス', url, headings: ['サービス案内', '料金'] };
  } });
  assert.equal(calls, 1);
  assert.equal(result.candidates[0].name, '青空サービス');
  assert.equal(result.candidates[0].canonical_domain, 'example.jp');
  assert.equal(canonicalDomain(result.candidates[0].official_url), 'example.jp');
});

test('free reuse merges aliases and URL forms but separates stores, services and products', () => {
  assert.equal(freeIdentity({ name: '株式会社〇〇', entity_type: 'company', official_url: 'https://www.example.jp/a' }), freeIdentity({ name: '〇〇', entity_type: 'company', official_url: 'https://example.jp/b' }));
  assert.notEqual(freeIdentity({ name: '〇〇クリニック 新宿院', identity_type: 'store', entity_type: 'company', region: '新宿', official_url: 'https://example.jp/' }), freeIdentity({ name: '〇〇クリニック 渋谷院', identity_type: 'store', entity_type: 'company', region: '渋谷', official_url: 'https://example.jp/' }));
  assert.notEqual(freeIdentity({ name: '〇〇サービス', entity_type: 'service', official_url: 'https://example.jp/' }), freeIdentity({ name: '〇〇商品', entity_type: 'product', official_url: 'https://example.jp/' }));
});

test('a URL-free confirmed identity can enter the frozen 10-question flow', async t => {
  const db = await sqliteD1(); t.after(() => db.close());
  const input = await fixture('kyoudo');
  input.entity.official_url = '';
  input.entity.identity_type = 'company';
  input.entity.identification_status = 'confirmed';
  const draft = await createSalesDraft({ DB: db, MADOHA_PAID_DIAGNOSIS_MAX_COST_USD: '.70' }, input);
  assert.equal(draft.questions.length, 10);
  const order = await db.prepare('SELECT target_url,identity_key,entity_json FROM diagnosis_orders WHERE id=?').bind(draft.id).first();
  assert.equal(order.target_url, '');
  assert.match(order.identity_key, /^free-v1:company:name:/);
  assert.equal(JSON.parse(order.entity_json).official_url, '');
});

test('details entered after a name-only lookup refine an unknown target without a type selector', () => {
  const entity = finalizeIdentityForDraft({
    name: 'AOZORA', official_url: '', identity_type: 'company', entity_type: 'company',
    industry: '地域の飲食店', region: '東京都', main_services: ['ランチ', 'テイクアウト']
  });
  assert.equal(entity.identity_type, 'store');
  assert.equal(entity.entity_type, 'company');
});

test('the three verified targets regress with the intended identity and no operator substitution', async () => {
  const expected = [
    ['株式会社協同住宅', '株式会社協同住宅', 'company'],
    ['税理士法人チェスター', '税理士法人チェスター', 'company'],
    ['kintone', 'kintone', 'product']
  ];
  for (const [query, name, type] of expected) {
    const result = await resolveIdentityInput({ query });
    assert.equal(result.candidates[0].name, name);
    assert.equal(result.candidates[0].identity_type, type);
  }
  const kintone = (await resolveIdentityInput({ query: 'kintone' })).candidates[0];
  assert.notEqual(kintone.name, kintone.operator_name);
});
