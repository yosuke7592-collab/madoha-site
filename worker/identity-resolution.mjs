import { normalizePublicUrl } from './free-check.mjs';

const clean = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const nameKey = value => clean(value).toLowerCase()
  .replace(/^(株式会社|有限会社|合同会社|税理士法人|医療法人(?:社団)?)/, '')
  .replace(/[\s・･,，.。()（）「」『』]/g, '');

export const IDENTITY_TYPE_LABELS = Object.freeze({
  company: '会社・法人', store: '店舗・施設', service: 'サービス', product: '商品・製品', brand: 'ブランド'
});

export const KNOWN_IDENTITIES = Object.freeze([
  {
    identity_id: 'company-kyoudo-housing', name: '株式会社協同住宅', aliases: ['協同住宅'],
    identity_type: 'company', entity_type: 'company', official_url: 'https://www.kyoudo.jp/',
    region: '浦安・市川', industry: '住宅・不動産', operator_name: '株式会社協同住宅',
    main_services: ['住宅購入', '賃貸', '注文住宅', 'リフォーム', '不動産売却', '中古住宅購入とリフォーム'],
    faq: ['土地を買って注文住宅を建てるまでの流れ', '今の家に住みながら売却できるか', '中古住宅を購入してリフォームまで相談する'],
    headings: ['物件を買う', '物件を借りる', '注文住宅', 'リフォーム', '物件を売る・貸す']
  },
  {
    identity_id: 'company-chester-tax', name: '税理士法人チェスター', aliases: ['チェスター'],
    identity_type: 'company', entity_type: 'company', official_url: 'https://chester-tax.com/',
    region: '全国', industry: '相続税務', operator_name: '税理士法人チェスター',
    main_services: ['相続税申告', '国際相続税申告', 'セカンドオピニオン', '相続手続きサポート', '生前対策'],
    faq: ['相続税の申告期限が近い場合の相談', '申告後の税務調査のフォロー', '土地評価に関する事例', '海外資産がある国際相続'],
    headings: ['相続税申告プラン', '国際相続専門部署', '相続税の削減事例']
  },
  {
    identity_id: 'product-kintone', name: 'kintone', aliases: ['キントーン', 'Kintone'],
    identity_type: 'product', entity_type: 'product', official_url: 'https://kintone.cybozu.co.jp/',
    region: '', industry: '業務改善クラウドサービス', operator_name: 'サイボウズ株式会社',
    main_services: ['顧客・案件管理', 'ワークフロー', 'プロジェクト管理', '問い合わせ管理', '社内情報共有', '外部サービス連携'],
    faq: ['Excelから案件管理を移行したい', '複数部署で案件情報を共有したい', '専門知識なしでノーコード開発できる', '利用人数とコースの違い', '料金と無料お試し', '外部サービス連携とプラグイン'],
    headings: ['基本機能', '用途別の活用方法', '料金', '導入事例']
  }
]);

export function canonicalDomain(value) {
  if (!value) return '';
  try { return normalizePublicUrl(value).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}

export function inferIdentityType(value, hints = {}) {
  const text = `${clean(value)} ${clean(hints.industry)} ${clean(hints.context)}`;
  if (/(店|院|クリニック|医院|歯科|美容室|サロン|レストラン|食堂|カフェ|支店|営業所)$/.test(clean(value)) || /(店舗|医療|飲食|美容院|歯科)/.test(text)) return 'store';
  if (/(アプリ|ソフト|ツール|製品|商品|SaaS|クラウド)/i.test(text)) return 'product';
  if (/(サービス|代行|プラン)/.test(text)) return 'service';
  if (/(ブランド|シリーズ)/.test(text)) return 'brand';
  return 'company';
}

const downstreamType = identityType => identityType === 'store' ? 'company' : identityType;
const asCandidate = value => {
  const identityType = value.identity_type || inferIdentityType(value.name, value);
  const officialUrl = value.official_url ? normalizePublicUrl(value.official_url).href : '';
  return {
    ...value,
    identity_id: value.identity_id || '',
    name: clean(value.name),
    aliases: [...new Set((value.aliases || []).map(clean).filter(Boolean))],
    identity_type: identityType,
    entity_type: value.entity_type || downstreamType(identityType),
    official_url: officialUrl,
    canonical_domain: canonicalDomain(officialUrl),
    region: clean(value.region),
    industry: clean(value.industry),
    operator_name: clean(value.operator_name),
    main_services: [...new Set((value.main_services || []).map(clean).filter(Boolean))],
    main_products: [...new Set((value.main_products || []).map(clean).filter(Boolean))],
    faq: [...new Set((value.faq || []).map(clean).filter(Boolean))],
    headings: [...new Set((value.headings || []).map(clean).filter(Boolean))],
    identification_status: 'confirmation_required'
  };
};

const looksLikeUrl = value => /^https?:\/\//i.test(value) || /^[^\s/]+\.[a-z]{2,}(?:[\/?#]|$)/i.test(value);
const matchesName = (record, query) => [record.name, ...(record.aliases || [])].some(value => nameKey(value) === nameKey(query));

export async function resolveIdentityInput(input = {}, options = {}) {
  const query = clean(typeof input === 'string' ? input : input.query || input.url || input.name);
  if (!query) throw new TypeError('会社名・店舗名・サービス名・URLを入力してください。');
  const catalog = options.catalog || KNOWN_IDENTITIES;

  if (looksLikeUrl(query)) {
    const normalizedUrl = normalizePublicUrl(query).href;
    const domain = canonicalDomain(normalizedUrl);
    const known = catalog.filter(item => canonicalDomain(item.official_url) === domain);
    if (known.length === 1) return { status: 'confirmation_required', query, candidates: [asCandidate(known[0])] };
    if (known.length > 1) return { status: 'ambiguous', query, message: '同じ公式サイトに複数の診断対象があります。診断する対象を選んでください。', candidates: known.map(asCandidate) };
    if (!options.inspectUrl) return { status: 'needs_details', query, message: '公式サイトは確認できました。対象情報を確認してください。', candidates: [asCandidate({ name: domain, official_url: normalizedUrl })] };
    const site = await options.inspectUrl(normalizedUrl);
    return { status: 'confirmation_required', query, candidates: [asCandidate({
      name: site.title || domain, official_url: site.url || normalizedUrl, identity_type: inferIdentityType(site.title, site),
      industry: '', main_services: (site.headings || []).slice(0, 8), headings: site.headings || [], site_title: site.title || ''
    })] };
  }

  let matches = catalog.filter(item => matchesName(item, query));
  const region = clean(input.region);
  const industry = clean(input.industry);
  if (matches.length > 1 && region) {
    const narrowed = matches.filter(item => clean(item.region).includes(region) || region.includes(clean(item.region)));
    if (narrowed.length) matches = narrowed;
  }
  if (matches.length > 1 && industry) {
    const narrowed = matches.filter(item => clean(item.industry).includes(industry) || industry.includes(clean(item.industry)));
    if (narrowed.length) matches = narrowed;
  }
  if (matches.length === 1) return { status: 'confirmation_required', query, candidates: [asCandidate(matches[0])] };
  if (matches.length > 1) return { status: 'ambiguous', query, message: '同じ名前の対象が複数見つかりました。診断する対象を選んでください。', candidates: matches.map(asCandidate) };

  const identityType = inferIdentityType(query, input);
  return {
    status: 'needs_details', query,
    message: '対象を一意に確認するため、分かる範囲で地域・業種・公式サイトを補足してください。URLは任意です。',
    candidates: [asCandidate({ name: query, identity_type: identityType, entity_type: downstreamType(identityType), region, industry })]
  };
}

export function stableIdentityKey(entity = {}) {
  const type = clean(entity.identity_type || entity.entity_type || 'company').toLowerCase();
  if (entity.identity_id) return `${type}:id:${clean(entity.identity_id).toLowerCase()}`;
  const domain = canonicalDomain(entity.official_url);
  const scope = nameKey(entity.name);
  if (domain && type === 'company') return `${type}:domain:${domain}`;
  if (domain) return `${type}:domain:${domain}:scope:${scope}`;
  return `${type}:name:${scope}:region:${nameKey(entity.region)}:operator:${nameKey(entity.operator_name)}`;
}
