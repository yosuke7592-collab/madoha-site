const TRACKING_KEYS = /^(utm_.+|fbclid|gclid|yclid)$/i;
const KNOWN = {
  google: ['google.com', 'google.co.jp'],
  comparison: ['comparison.example', 'hikaku.example'],
  reviews: ['reviews.example', 'kuchikomi.example'],
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

export const SOURCE_CLASSIFICATION_VERSION = '0.1';
