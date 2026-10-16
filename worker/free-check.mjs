const MAX_HTML_BYTES = 1_000_000;

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  return false;
}

export function normalizePublicUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('URLを入力してください。');
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try { url = new URL(candidate); } catch { throw new Error('正しいURLを入力してください。'); }
  if (!['http:', 'https:'].includes(url.protocol) || isPrivateHost(url.hostname) || !url.hostname.includes('.')) {
    throw new Error('公開されているWebサイトのURLを入力してください。');
  }
  url.username = ''; url.password = ''; url.hash = '';
  return url;
}

const textOf = (html, pattern) => (html.match(pattern)?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const count = (html, pattern) => (html.match(pattern) || []).length;
const clean = value => String(value || '').replace(/&(?:nbsp|#160);/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, ' ').trim();
const uniq = values => [...new Set(values.map(clean).filter(Boolean))];
const htmlText = html => clean(String(html || '').replace(/<img\b[^>]*\balt=["']([^"']+)["'][^>]*>/gi, ' $1 ').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
const headingsOf = html => [...String(html || '').matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map(match => clean(match[1].replace(/<[^>]*>/g, ' '))).filter(Boolean);
const BUSINESS_LINK = /事業案内|事業内容|サービス(?:案内)?|商品(?:案内)?|製品(?:案内)?|\b(?:service|services|business|product|products|solution|solutions)\b/i;
const NON_BUSINESS_LINK = /採用|求人|社員|スタッフ|会社案内|会社概要|企業情報|代表|メッセージ|沿革|ニュース|お知らせ|問い合わせ|アクセス|福利厚生|キャリア|一日の流れ|\b(?:recruit|career|staff|company|about|news|contact|access|message)\b/i;
const GENERIC_HEADING = /^(?:事業案内|事業内容|サービス(?:案内)?|商品(?:案内)?|製品(?:案内)?|当社の特徴|特徴|対応エリア|対応地域|サービス提供地域|配送エリア|ホーム|一覧|詳細|もっと見る|business|service|services|product|products|solution|solutions)$/i;
const SERVICE_EXCLUSION = /採用|求人|社員|スタッフ|会社案内|会社概要|企業情報|代表挨拶|メッセージ|沿革|ニュース|新着|お知らせ|問い合わせ|アクセス|福利厚生|キャリア|一日の流れ|よくある質問|FAQ/i;
const INDUSTRY_RULES = [
  [/軽貨物|宅配|配送|運送|物流/, '軽貨物運送・物流'],
  [/不動産|住宅|物件|注文住宅|リフォーム/, '住宅・不動産'],
  [/相続税|税務|税理士|会計/, '税務・会計'],
  [/歯科|医院|クリニック|診療|治療/, '医療'],
  [/SaaS|クラウド|業務システム|ソフトウェア|アプリ/i, '業務支援サービス']
];

function normalizeServiceHeading(value) {
  const normalized = clean(value).replace(/^[A-Z][A-Z\s-]{2,}(?=[ぁ-んァ-ヶ一-龠])/i, '').trim();
  if (!normalized || normalized.length > 80 || GENERIC_HEADING.test(normalized) || SERVICE_EXCLUSION.test(normalized)) return '';
  return normalized;
}

function extractIdentityName(html, title = '') {
  for (const match of String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const queue = [JSON.parse(match[1])];
      while (queue.length) {
        const value = queue.shift();
        if (Array.isArray(value)) { queue.push(...value); continue; }
        if (!value || typeof value !== 'object') continue;
        const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
        if (types.some(type => /^(?:Organization|Corporation|LocalBusiness|ProfessionalService)$/i.test(String(type || ''))) && clean(value.name)) return clean(value.name);
        queue.push(...Object.values(value).filter(item => item && typeof item === 'object'));
      }
    } catch {}
  }
  const siteName = textOf(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)/i)
    || textOf(html, /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:site_name["']/i);
  if (siteName && !GENERIC_HEADING.test(siteName)) return siteName;
  const logoAlt = [...String(html || '').matchAll(/<img\b[^>]*\balt=["']([^"']+)["'][^>]*>/gi)].map(match => clean(match[1])).find(value => /株式会社|有限会社|合同会社|税理士法人|医療法人/.test(value) && value.length <= 60);
  if (logoAlt) return logoAlt;
  const corporate = clean(title).match(/(?:株式会社|有限会社|合同会社|税理士法人|医療法人(?:社団)?)[A-Za-zＡ-Ｚａ-ｚ0-9０-９ぁ-んァ-ヶ一-龠・･\s]{1,40}$/)?.[0];
  if (corporate) return clean(corporate);
  const h1 = headingsOf(html).find(value => !GENERIC_HEADING.test(value) && !SERVICE_EXCLUSION.test(value) && value.length <= 60);
  return h1 || clean(title).split(/[|｜–—]/)[0].trim();
}

function extractInternalBusinessLinks(html, baseUrl) {
  const links = [];
  for (const match of String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = clean(match[2].replace(/<[^>]*>/g, ' '));
    let url;
    try { url = new URL(match[1], baseUrl); } catch { continue; }
    const signal = `${label} ${url.pathname}`;
    if (url.hostname !== baseUrl.hostname || !BUSINESS_LINK.test(signal) || NON_BUSINESS_LINK.test(signal)) continue;
    url.hash = ''; url.search = '';
    if (!links.some(item => item.href === url.href)) links.push(url);
    if (links.length >= 3) break;
  }
  return links;
}

function extractServiceRegions(html) {
  const text = htmlText(html), regions = [];
  for (const match of text.matchAll(/(?:対応エリア|対応地域|サービス提供地域|配送エリア)[：:\s-]*([^。]{0,100})/gi)) {
    for (const region of match[1].matchAll(/(?:北海道|東京都|京都府|大阪府|.{2,3}県)(?:全域|内|一円)?/g)) regions.push(region[0]);
  }
  return uniq(regions);
}

function inferIndustry(text) { return INDUSTRY_RULES.find(([pattern]) => pattern.test(text))?.[1] || ''; }

async function readLimitedHtml(response, signal) {
  if (!response.body) return (await response.text()).slice(0, MAX_HTML_BYTES);
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      if (signal?.aborted) throw new Error('サイトの取得に時間がかかっています。');
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_HTML_BYTES) throw new Error('ページサイズが大きすぎます。');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  } finally { reader.cancel().catch(() => {}); }
}

async function fetchPublicHtml(input, fetchImpl) {
  let url = normalizePublicUrl(input);
  for (let redirects = 0; redirects < 4; redirects += 1) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10_000);
    let response;
    try {
      response = await fetchImpl(url, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'MADOHA-Free-Check/1.0', Accept: 'text/html,application/xhtml+xml' }, cf: { cacheTtl: 3600, cacheEverything: true } });
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) { url = normalizePublicUrl(new URL(response.headers.get('location'), url).href); continue; }
      if (!response.ok) throw new Error(`サイトを取得できませんでした（${response.status}）。`);
      if (!(response.headers.get('content-type') || '').includes('text/html')) throw new Error('HTMLページのURLを入力してください。');
      const declared = Number(response.headers.get('content-length') || 0); if (declared > MAX_HTML_BYTES) throw new Error('ページサイズが大きすぎます。');
      return { url, response, html: await readLimitedHtml(response, controller.signal) };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('サイトの取得に時間がかかっています。');
      throw error;
    } finally { clearTimeout(timer); }
  }
  throw new Error('リダイレクトが多すぎるため取得できませんでした。');
}

export function analyzeHtml(html, url, headers = new Headers()) {
  const title = textOf(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1] || '';
  const h1Count = count(html, /<h1\b/gi);
  const hasSchema = /<script[^>]+type=["']application\/ld\+json["']/i.test(html);
  const hasFaq = /FAQPage|よくある質問|FAQ/i.test(html);
  const hasOrganization = /Organization|LocalBusiness|会社概要|企業情報/i.test(html);
  const hasCanonical = /<link[^>]+rel=["']canonical["']/i.test(html);
  const langJa = /<html[^>]+lang=["']ja/i.test(html);
  const checks = [
    ['title', 'ページタイトル', Boolean(title), title ? `${title.length}文字` : '未検出'],
    ['description', '説明文', description.length >= 40, description ? `${description.length}文字` : '未検出'],
    ['headings', '見出し構造', h1Count === 1, h1Count ? `H1が${h1Count}件` : 'H1未検出'],
    ['structured', '構造化データ', hasSchema, hasSchema ? '検出' : '未検出'],
    ['entity', '会社・事業情報', hasOrganization, hasOrganization ? '検出' : '要確認'],
    ['faq', '質問への回答情報', hasFaq, hasFaq ? '検出' : '未検出'],
    ['canonical', '正規URL', hasCanonical, hasCanonical ? '設定済み' : '未検出'],
    ['language', '言語設定', langJa, langJa ? '日本語' : '要確認']
  ].map(([id, label, passed, detail]) => ({ id, label, status: passed ? 'pass' : 'improve', detail }));
  const passed = checks.filter(item => item.status === 'pass').length;
  const score = Math.round(passed / checks.length * 100);
  return {
    kind: 'free-site-readiness-check', version: '1.0', url: url.href, host: url.hostname,
    fetchedAt: new Date().toISOString(), title: title || url.hostname, score,
    headings: [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map(m => m[1].replace(/<[^>]*>/g, '').trim()).filter(Boolean).slice(0, 40),
    band: score >= 75 ? '良好' : score >= 50 ? '改善余地あり' : '要改善', checks,
    disclaimer: '公開Webページの技術・情報要素をルールベースで確認した簡易結果です。ChatGPT等での表示順位や推薦状況を測定したものではありません。',
    cache: headers.get('cf-cache-status') || null
  };
}

export async function runFreeCheck(input, fetchImpl = fetch) {
  const page = await fetchPublicHtml(input, fetchImpl);
  return analyzeHtml(page.html, page.url, page.response.headers);
}

export async function inspectIdentitySite(input, fetchImpl = fetch) {
  const root = await fetchPublicHtml(input, fetchImpl), rootAnalysis = analyzeHtml(root.html, root.url, root.response.headers);
  const pages = [{ ...root, priority: false }];
  for (const link of extractInternalBusinessLinks(root.html, root.url)) {
    try { const page = await fetchPublicHtml(link, fetchImpl); if (page.url.hostname === root.url.hostname) pages.push({ ...page, priority: true }); } catch {}
  }
  const priorityServices = uniq(pages.filter(page => page.priority).flatMap(page => headingsOf(page.html).map(normalizeServiceHeading).filter(Boolean)));
  const rootServices = uniq(headingsOf(root.html).map(normalizeServiceHeading).filter(Boolean));
  const mainServices = priorityServices.length ? priorityServices : rootServices;
  const combinedText = pages.map(page => htmlText(page.html)).join(' ');
  return {
    ...rootAnalysis,
    identity_name: extractIdentityName(root.html, rootAnalysis.title),
    industry: inferIndustry(combinedText),
    main_services: mainServices.slice(0, 8),
    service_regions: uniq(pages.flatMap(page => extractServiceRegions(page.html))).slice(0, 3),
    headings: uniq(pages.flatMap(page => headingsOf(page.html))).slice(0, 40)
  };
}
