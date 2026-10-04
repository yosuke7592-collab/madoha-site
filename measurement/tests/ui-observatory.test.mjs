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
  assert.match(brandCss, /\.fact-icon::after/);
  assert.match(html, /<h2><span>3つのAIから<\/span><span>同じ条件で観測<\/span><\/h2>/);
  assert.doesNotMatch(html, /3つのAIから<br>同じ条件で観測/);
  assert.match(brandCss, /\.preview-competitors i:before/);
  assert.match(html, /<h2><span>実際の診断結果<\/span><span>イメージ<\/span><\/h2>/);
  assert.match(brandCss, /\.sample-proof \.section-kicker\{color:#1767e8\}/);
  assert.match(html, /10[\s\S]*3[\s\S]*30/);
  assert.match(html, /9,800円/);
  assert.match(html, /purchase-story[\s\S]*<a href="index\.html">今すぐ診断する/);
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
  assert.doesNotMatch(html, /地域（地域に依存しない場合は空欄）/);
  assert.match(html, /地域を指定して診断する/);
  assert.match(html, /id="region-enabled"[^>]*role="switch"/);
  assert.match(html, /id="region-condition-list"/);
  assert.match(html, /最大3件/);
  assert.match(html, /診断する業種や質問の方向性を決めるために使用します/);
  assert.match(html, /診断するテーマの候補として使用します/);
  assert.match(html, /入力した内容はAIへの質問候補を作るために使用します/);
  assert.match(html, /id="input-warnings"/);
  assert.match(html, />診断する質問を作成<\/button>/);
  assert.match(html, /id="sales-paused"[\s\S]*現在、診断の受付準備中です/);
  assert.match(html, /id="checkout-controls"/);
  assert.match(script, /faq_entries=faqEntries\(entity\.faq\)/);
  assert.match(script, /renderInputWarnings/);
  assert.match(script, /cfg\.sales_enabled===true/);
  assert.match(script, /#checkout-controls/);
  assert.match(script, /region_conditions=selectedRegionConditions\(\)/);
  assert.match(script, /openIdentityModal/);
  assert.match(script, /closeIdentityModal/);
  assert.match(script, /history\.replaceState/);
  assert.match(script, /function scrollToIdentityEntry\(\)/);
  assert.match(script, /document\.documentElement\.style\.scrollBehavior='auto'/);
  assert.match(script, /scrollTo\(0,0\)/);
  assert.doesNotMatch(script, /target\.scrollIntoView/);
  assert.match(script, /この対象を確認/);
  assert.match(css, /body\.identity-modal-open\{overflow:hidden\}/);
  assert.match(css, /#identity-candidates button\.identity-candidate/);
  assert.match(html, /class="identity-official-url">公式サイト/);
  assert.match(css, /\.identity-official-url input\{margin-top:27\.5px\}/);
  assert.match(css, /@media\(max-width:700px\)[\s\S]*\.identity-official-url input\{margin-top:7px\}/);
});

test('ten-question review keeps the metadata internal and presents direct editing only', async () => {
  const [html, script, css] = await Promise.all([load('index.html'), load('sales.js'), load('brand-v4.css')]);
  assert.match(html, /MADOHAが設計した10質問を確認/);
  assert.match(html, /実際にAIへ送る質問文です<br>必要に応じて質問文を調整できます/);
  assert.doesNotMatch(html, /id="mix-reason"/);
  assert.doesNotMatch(html, /質問文と検索種別を調整できます/);
  assert.match(script, /class="question-number">QUESTION/);
  assert.match(script, /class="commit-question"[^>]*hidden>変更を確定/);
  assert.match(script, /question-edit-status/);
  assert.doesNotMatch(script, /data-kind=/);
  assert.doesNotMatch(script, /<b>選定理由<\/b>/);
  assert.doesNotMatch(script, /<b>この質問で分かること<\/b>/);
  assert.doesNotMatch(script, /scrollIntoView/);
  assert.match(script, /setQuestionReviewActive\(true\)/);
  assert.match(script, /setQuestionReviewActive\(false\)/);
  assert.match(script, /const submitted=readQuestions\(\)/);
  assert.match(script, /kind:q\.kind/);
  assert.match(css, /\.question-edit-card textarea\{[^}]*width:100%/);
  assert.match(css, /\.question-review-active #what-we-measure/);
  assert.match(css, /@media\(max-width:700px\)[\s\S]*\.question-review\{width:calc\(100% - 24px\)/);
});

test('sample chrome keeps only the compact MADOHA and diagnosis footer links', async () => {
  const [html, script] = await Promise.all([load('sample.html'), load('sample-kyoudo.js')]);
  assert.doesNotMatch(html, /class="header-cta"/);
  assert.doesNotMatch(html, /sample-next-step/);
  assert.match(script, /<footer class="end"><a class="brand"/);
  assert.match(script, /<a href="index\.html">AI検索診断<\/a><\/footer>/);
  assert.doesNotMatch(script, /index\.html#identity-search/);
  assert.doesNotMatch(script, /検索結果 \+ 参照情報 \+ 必要最小限の見解/);
});

test('about page shares the TOP brand system and explains MADOHA visually', async () => {
  const [html, css, hero, lenses] = await Promise.all([
    load('company.html'),
    load('about-v2.css'),
    readFile(new URL('../../assets/about/about-ai-search-hero.webp', import.meta.url)),
    readFile(new URL('../../assets/about/about-three-ai-lenses.webp', import.meta.url)),
  ]);
  assert.match(html, /class="global-header"/);
  assert.match(html, /MADOHA <small>AI SEARCH OBSERVATORY<\/small>/);
  assert.match(html, /<h1><span>AIに<\/span><span>あなたの会社は<\/span><em>どう見えているか<\/em><\/h1>/);
  assert.match(html, /assets\/about\/about-ai-search-hero\.webp/);
  assert.match(html, /assets\/about\/about-three-ai-lenses\.webp/);
  assert.match(html, /10<\/strong> QUESTIONS[\s\S]*3<\/strong> AI CHANNELS[\s\S]*30<\/strong> RESULTS/);
  assert.match(html, /会社名なしで質問/);
  assert.match(html, /注文住宅を建てるなら<br>どの会社がいい？/);
  assert.doesNotMatch(html, /浦安で注文住宅/);
  assert.match(html, /about-v2-hero-chatgpt[\s\S]*about-v2-hero-gemini[\s\S]*about-v2-hero-google/);
  assert.match(html, /about-v2-difference-title"><span>選ばれ方が<\/span><span>変わった<\/span>/);
  assert.match(css, /about-v2-difference>\.about-v2-shell\{[^}]*align-items:center/);
  assert.match(html, /従来検索[\s\S]*AI検索/);
  assert.match(html, /href="index\.html">AI検索診断を始める/);
  assert.doesNotMatch(html, /index\.html#identity-search/);
  assert.doesNotMatch(html, /styles\.css|polish\.css|polish\.js/);
  assert.match(css, /@media\(max-width:390px\)/);
  assert.ok(hero.length > 20_000);
  assert.ok(lenses.length > 20_000);
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
