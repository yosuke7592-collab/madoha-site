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
  let url = normalizePublicUrl(input);
  for (let redirects = 0; redirects < 4; redirects += 1) {
    const response = await fetchImpl(url, { redirect: 'manual', headers: { 'User-Agent': 'MADOHA-Free-Check/1.0', Accept: 'text/html,application/xhtml+xml' }, cf: { cacheTtl: 3600, cacheEverything: true } });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      url = normalizePublicUrl(new URL(response.headers.get('location'), url).href);
      continue;
    }
    if (!response.ok) throw new Error(`サイトを取得できませんでした（${response.status}）。`);
    if (!(response.headers.get('content-type') || '').includes('text/html')) throw new Error('HTMLページのURLを入力してください。');
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_HTML_BYTES) throw new Error('ページサイズが大きすぎます。');
    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    return analyzeHtml(html, url, response.headers);
  }
  throw new Error('リダイレクトが多すぎるため取得できませんでした。');
}
