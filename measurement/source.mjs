const TRACKING_KEYS = /^(utm_.+|fbclid|gclid|yclid)$/i;
const KNOWN = {
  google: ['google.com', 'google.co.jp'],
  comparison: [
    'comparison.example', 'hikaku.example', 'nuri-kae.jp', 'biz.ne.jp', 'meetsmore.com',
    'rehome-navi.com', 'reform-guide.jp', 'gaihekitosou-hotline.com',
    'tokyo-gaihekitosou-guide.com', 'gaiheki-madoguchi.com', 'town-life.jp',
    'gaiheki-partners.jp', 'nurimatch.jp', 'curama.jp', 'myhome.nifty.com', 'paipro.jp',
    'toso-group.co.jp', 'renovemo.co.jp'
  ],
  reviews: ['reviews.example', 'kuchikomi.example', 'g-collect.net', 'outerwallrepair-assist.com', 'paint-exteriorwall.net', 'yanery.com', 'gaiheki-hyouban.com'],
  industry_media: ['industry.example'],
  sns: ['x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'youtube.com', 'youtu.be', 'tiktok.com']
};

export function canonicalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.hash = '';
    [...url.searchParams.keys()].forEach(key => { if (TRACKING_KEYS.test(key)) url.searchParams.delete(key); });
    if (!url.searchParams.size) url.search = '';
    return url.toString();
  } catch {
    return '';
  }
}

function domainMatches(domain, candidate) {
  return domain === candidate || domain.endsWith(`.${candidate}`);
}

export function classifySource(url, registry = []) {
  const canonicalUrl = canonicalizeUrl(url);
  if (!canonicalUrl) return { canonicalUrl: '', domain: '', sourceType: 'other' };
  const domain = new URL(canonicalUrl).hostname;
  const official = registry.some(company => (company.officialDomains || []).some(item => domainMatches(domain, item)));
  if (official) return { canonicalUrl, domain, sourceType: 'official' };
  for (const [sourceType, domains] of Object.entries(KNOWN)) {
    if (domains.some(item => domainMatches(domain, item))) return { canonicalUrl, domain, sourceType };
  }
  return { canonicalUrl, domain, sourceType: 'other' };
}

// note.com remains `other` in v0.2 because corporate and individual authorship is mixed.
export const SOURCE_CLASSIFICATION_VERSION = '0.2';
