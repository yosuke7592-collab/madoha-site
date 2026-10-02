import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const load = name => readFile(new URL(`../../${name}`, import.meta.url), 'utf8');

test('TOP uses the lightweight AI observatory design and keeps the sales contract', async () => {
  const [html, css, brandCss] = await Promise.all([load('index.html'), load('top-v3.css'), load('brand-v4.css')]);
  assert.match(html, /ai-observation-visual/);
  assert.match(html, /ChatGPT/);
  assert.match(html, /Gemini/);
  assert.match(html, /Google AI Mode/);
  assert.match(html, /<h1>AIは<br>/);
  assert.doesNotMatch(html, /<h1>AIは、/);
  assert.doesNotMatch(html, /class="header-cta"/);
  assert.equal((html.match(/<span class="fact-icon/g) || []).length, 4);
  assert.match(brandCss, /\.fact-icon svg/);
  assert.match(brandCss, /\.preview-competitors i:before/);
  assert.match(html, /10[\s\S]*3[\s\S]*30/);
  assert.match(html, /9,800円/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(`${html}\n${css}`, /three\.js|webgl|<canvas|<video/i);
});

test('identity resolution uses a clear modal and releases the anchored page scroll', async () => {
  const [html, script, css] = await Promise.all([load('index.html'), load('sales.js'), load('brand-v4.css')]);
  assert.match(html, /id="identity-modal"/);
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /id="close-identity-modal"/);
  assert.match(html, /id="entity-form"[^>]*autocomplete="off"/);
  assert.match(html, /name="official_url"[^>]*autocomplete="off"[^>]*autocapitalize="none"/);
  assert.match(script, /openIdentityModal/);
  assert.match(script, /closeIdentityModal/);
  assert.match(script, /history\.replaceState/);
  assert.match(script, /function scrollToIdentityEntry\(\)/);
  assert.match(script, /scrollTo\(\{top:0/);
  assert.doesNotMatch(script, /target\.scrollIntoView/);
  assert.match(script, /この対象を確認/);
  assert.match(css, /body\.identity-modal-open\{overflow:hidden\}/);
  assert.match(css, /#identity-candidates button\.identity-candidate/);
});

test('sample chrome keeps only the compact MADOHA and diagnosis footer links', async () => {
  const [html, script] = await Promise.all([load('sample.html'), load('sample-kyoudo.js')]);
  assert.doesNotMatch(html, /class="header-cta"/);
  assert.doesNotMatch(html, /sample-next-step/);
  assert.match(script, /<footer class="end"><a class="brand"/);
  assert.match(script, />AI検索診断<\/a><\/footer>/);
  assert.doesNotMatch(script, /検索結果 \+ 参照情報 \+ 必要最小限の見解/);
});

test('paid dashboard exposes executive summary, provider comparison, matrix and Evidence navigation', async () => {
  const [script, css] = await Promise.all([load('sample-kyoudo.js'), load('observatory-ui.css')]);
  assert.match(script, /AI SEARCH OBSERVATORY/);
  assert.match(script, /dashboard-summary/);
  assert.match(script, /10質問 × 3AI/);
  assert.match(script, /dashboard-matrix/);
  assert.match(script, /href="#evidence-/);
  assert.match(script, /改善候補/);
  assert.match(css, /@media\(max-width:430px\)/);
});
