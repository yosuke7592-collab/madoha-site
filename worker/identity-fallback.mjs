// Fallback identity sources, used only when Google Maps (Places) finds nothing.
//  1. Google Knowledge Graph Search API  (famous companies / services / products)
//  2. gBizINFO (Ministry of Economy, Trade and Industry; registered corporations)
// Every source is optional: a missing key means the source is silently skipped.

const clean = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const TIMEOUT_MS = 5000;

async function getJson(url, init = {}, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) { console.warn('identity fallback http', response.status, String(url).split('?')[0]); return null; }
    return await response.json();
  } catch (error) {
    console.warn('identity fallback error', String(url).split('?')[0], error?.message || error);
    return null;
  } finally { clearTimeout(timer); }
}

const kgType = types => {
  const list = (Array.isArray(types) ? types : [types]).map(String);
  if (list.some(type => /^Product$|SoftwareApplication/i.test(type))) return 'product';
  if (list.some(type => /^Brand$/i.test(type))) return 'brand';
  if (list.some(type => /^Service$/i.test(type))) return 'service';
  return 'company';
}

export async function searchKnowledgeGraph(env, query, fetchImpl = fetch) {
  const key = env?.GOOGLE_KG_API_KEY || env?.GOOGLE_PLACES_API_KEY;
  const text = clean(query);
  if (!key || !text) return [];
  const params = new URLSearchParams({ query: text, key, limit: '3', languages: 'ja', indent: 'false' });
  const data = await getJson(`https://kgsearch.googleapis.com/v1/entities:search?${params}`, {}, fetchImpl);
  return (data?.itemListElement || []).map(item => item?.result).filter(Boolean)
    .filter(result => clean(result.name) && (!result['@type'] || [].concat(result['@type']).some(type => /Organization|Corporation|Brand|Product|Service|LocalBusiness|SoftwareApplication/i.test(String(type)))))
    .map(result => ({
      name: clean(result.name),
      identity_type: kgType(result['@type']),
      industry: clean(result.description).slice(0, 60),
      official_url: /^https?:\/\//i.test(clean(result.url)) ? clean(result.url) : '',
      source: 'google_kg'
    }));
}

const cityOfAddress = address => {
  const value = clean(address).replace(/^〒?\d{3}-?\d{4}\s*/, '');
  const match = value.match(/^(.{2,4}?[都道府県])?(.{1,6}?[市区町村郡])/);
  return match ? `${match[1] || ''}${match[2]}` : value.slice(0, 20);
};

// gBizINFO REST API. The base URL is overridable (GBIZINFO_API_BASE) because the
// public API has versions; the response keys are read defensively.
export async function searchGBizInfo(env, query, fetchImpl = fetch) {
  const token = env?.GBIZINFO_API_TOKEN;
  const [name, ...rest] = clean(query).split(' ').filter(Boolean);
  if (!token || !name) return [];
  const base = env.GBIZINFO_API_BASE || 'https://info.gbiz.go.jp/hojin/v1/hojin';
  const params = new URLSearchParams({ name, page: '1', limit: '10' });
  const data = await getJson(`${base}?${params}`, { headers: { Accept: 'application/json', 'X-hojinInfo-api-token': token } }, fetchImpl);
  const rows = data?.['hojin-infos'] || data?.hojin_infos || data?.hojinInfos || [];
  const place = rest.join('');
  return rows
    .filter(row => clean(row?.name) && (!place || clean(row.location).includes(place)))
    .slice(0, 3)
    .map(row => ({
      name: clean(row.name),
      identity_type: 'company',
      region: cityOfAddress(row.location),
      company_location: clean(row.location),
      industry: clean(row.business_summary).slice(0, 60),
      official_url: /^https?:\/\//i.test(clean(row.company_url || row.companyUrl)) ? clean(row.company_url || row.companyUrl) : '',
      operator_name: clean(row.name),
      source: 'gbizinfo'
    }));
}

export async function searchFallbackSources(env, query, fetchImpl = fetch) {
  const settled = await Promise.allSettled([searchKnowledgeGraph(env, query, fetchImpl), searchGBizInfo(env, query, fetchImpl)]);
  return settled.flatMap(item => item.status === 'fulfilled' ? item.value : []);
}
