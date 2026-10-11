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
  assert.match(html, /実際にAIへ送る10の質問です<br>変更したい質問は「編集」から調整できます/);
  assert.doesNotMatch(html, /id="mix-reason"/);
  assert.doesNotMatch(html, /質問文と検索種別を調整できます/);
  assert.match(script, /class="question-number">QUESTION/);
  assert.match(script, /class="edit-question"[^>]*>✎ 編集/);
  assert.match(script, /class="question-readonly"/);
  assert.match(script, /display\.hidden=true;editor\.hidden=false;edit\.hidden=true;button\.hidden=false/);
  assert.match(script, /textarea\.focus\(\)/);
  assert.match(script, /class="commit-question"[^>]*hidden>変更を確定/);
  assert.match(script, /display\.textContent=value/);
  assert.match(script, /display\.hidden=false;editor\.hidden=true;edit\.hidden=false/);
  assert.match(script, /question-edit-status/);
  assert.doesNotMatch(script, /data-kind=/);
  assert.doesNotMatch(script, /<b>選定理由<\/b>/);
  assert.doesNotMatch(script, /<b>この質問で分かること<\/b>/);
  assert.doesNotMatch(script, /scrollIntoView/);
  assert.match(script, /function resetFlowScroll\(\)/);
  assert.match(script, /window\.scrollTo\(\{top:0,left:0,behavior:'auto'\}\)/);
  assert.match(script, /history\.pushState\(flowState\(step\)/);
  assert.match(script, /window\.addEventListener\('popstate'/);
  assert.match(script, /state\.step==='identity'/);
  assert.match(script, /state\.step==='questions'/);
  assert.match(script, /state\.step==='checkout'/);
  assert.match(script, /focus\(\{preventScroll:true\}\)/);
  assert.match(script, /setQuestionReviewActive\(true\)/);
  assert.match(script, /setQuestionReviewActive\(false\)/);
  assert.match(script, /const submitted=readQuestions\(\)/);
  assert.match(script, /kind:q\.kind/);
  assert.match(css, /\.question-edit-card textarea\{[^}]*width:100%/);
  assert.match(css, /\.question-card-head\{[^}]*justify-content:space-between/);
  assert.match(css, /\.edit-question\{[^}]*background:transparent/);
  assert.match(css, /\.question-readonly\{[^}]*font:500 18px/);
  assert.match(css, /\.question-review-active #what-we-measure/);
  assert.match(css, /\.question-review-active #what-we-measure,[\s\S]*\.question-review-active footer\{[\s\S]*display:none!important/);
  assert.match(html, /brand-v4\.css\?v=11/);
  assert.match(css, /@media\(max-width:700px\)[\s\S]*\.question-review\{width:calc\(100% - 24px\)/);
});

test('purchase confirmation isolates the buying decision while sales remain guarded', async () => {
  const [html, script, css] = await Promise.all([load('index.html'), load('sales.js'), load('brand-v4.css')]);
  assert.match(html, /class="product-stage upgrade-value purchase-confirmation"/);
  assert.match(html, /<p class="checkout-price">9,800円<span>（税込）<\/span><\/p>/);
  assert.match(html, />9,800円で診断を開始<\/button>/);
  assert.match(html, /診断結果は実施時点のAI検索結果/);
  assert.match(html, /診断開始後の10質問は測定条件として固定されます/);
  assert.match(html, /掲載・推薦・順位や、改善による効果を保証するものではありません/);
  assert.match(html, /購入時のメールアドレスへ結果URLをお送りします/);
  assert.match(html, /data-open-result-resend/);
  assert.match(html, /info@madoha\.jp/);
  assert.match(html, /legal\.html#terms/);
  assert.match(html, /legal\.html#privacy/);
  assert.match(html, /legal\.html#commerce/);
  assert.match(script, /openResultResendDialog/);
  assert.doesNotMatch(html, /AIへの掲載状況と、会社名なしでも候補に入るか/);
  assert.doesNotMatch(html, /3つのAIごとの違いと質問別の強み・弱み/);
  assert.match(script, /function setCheckoutReviewActive/);
  assert.match(script, /if\(!salesEnabled\)\{\$\('#sales-paused'\)\.hidden=false/);
  assert.match(script, /showCheckoutStage\(\)/);
  assert.match(css, /\.checkout-review-active #what-we-measure/);
  assert.match(css, /\.checkout-review-active \.sample-story/);
  assert.match(css, /\.checkout-review-active #price/);
  assert.doesNotMatch(css, /\.checkout-review-active footer\{display:none/);
});

test('legal page covers service limits, privacy and commerce disclosures', async () => {
  const legal = await load('legal.html');
  assert.match(legal, /id="terms"/);
  assert.match(legal, /id="privacy"/);
  assert.match(legal, /id="commerce"/);
  assert.match(legal, /9,800円（税込）/);
  assert.match(legal, /掲載、推薦、順位および改善効果を保証しません/);
  assert.match(legal, /MADOHAでは保持しません/);
  assert.match(legal, /株式会社SOG/);
  assert.match(legal, /info@madoha\.jp/);
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
  const [script, css, resilienceCss, brandCss, geminiLogo, googleLogo] = await Promise.all([
    load('sample-kyoudo.js'), load('observatory-ui.css'), load('result-resilience.css'),
    load('brand-v4.css'), load('gemini-logo.svg'), load('google-ai-logo.svg')
  ]);
  assert.match(script, /AI SEARCH OBSERVATORY/);
  assert.match(script, /dashboard-summary/);
  assert.match(script, /質問 × 3AI/);
  assert.match(script, /dashboard-matrix/);
  assert.match(script, /href="#evidence-/);
  assert.match(script, /今回の回答で確認された企業/);
  assert.match(script, /今回のAI回答で確認された参照情報/);
  assert.match(script, /今回の測定対象なし/);
  assert.match(script, /確認候補/);
  assert.doesNotMatch(script, /よく参照されたドメイン/);
  assert.match(script, /正常に取得できた結果は/);
  assert.match(script, /measurementProvenance/);
  assert.match(script, /chatgpt-logo\.svg/);
  assert.match(script, /gemini-logo\.svg/);
  assert.match(script, /google-ai-logo\.svg/);
  assert.match(script, /channelIcon\(row\.channel\)/);
  assert.match(css, /@media\(max-width:430px\)/);
  assert.match(resilienceCss, /measurement-provenance/);
  assert.match(resilienceCss, /overflow-wrap: anywhere/);
  assert.match(brandCss, /\.provider-badge\.provider-logo/);
  assert.match(brandCss, /\.source-ranking li>span/);
  assert.match(brandCss, /white-space:normal!important/);
  assert.match(geminiLogo, /linearGradient/);
  assert.match(googleLogo, /#4285F4/);
  assert.match(googleLogo, /#34A853/);
});
