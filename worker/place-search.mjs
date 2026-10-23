// Name → candidate lookup via Google Places API (Text Search, New).
// Active only when GOOGLE_PLACES_API_KEY is configured. Without the key the
// identity flow keeps its previous behaviour (ask the user for a URL).
// Google Maps Platform gives a free monthly allowance per SKU; MADOHA's
// volume is expected to stay inside it.

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.shortFormattedAddress',
  'places.primaryTypeDisplayName', 'places.types', 'places.websiteUri', 'places.businessStatus'
].join(',');

const STORE_TYPES = /(?:^|_)(?:store|shop|florist|restaurant|cafe|bakery|bar|food|salon|spa|beauty|hair|clinic|dentist|doctor|hospital|pharmacy|gym|lodging|hotel|car_repair|laundry|veterinary|school)(?:_|$)/;

const clean = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();

export function cityOf(address) {
  const value = clean(address).replace(/^日本[、,]\s*/, '').replace(/〒?\d{3}-\d{4}\s*/, '');
  const match = value.match(/^(.{2,4}?[都道府県])?(.{1,6}?[市区町村郡])/);
  return match ? `${match[1] || ''}${match[2]}` : value.slice(0, 20);
}

export function placeToCandidate(place = {}) {
  const types = Array.isArray(place.types) ? place.types : [];
  const typeLabel = clean(place.primaryTypeDisplayName?.text);
  const address = clean(place.formattedAddress);
  return {
    name: clean(place.displayName?.text),
    identity_type: types.some(type => STORE_TYPES.test(type)) ? 'store' : 'company',
    region: cityOf(address),
    company_location: address.replace(/^日本[、,]\s*/, ''),
    industry: typeLabel,
    official_url: clean(place.websiteUri),
    place_id: clean(place.id),
    source: 'google_places'
  };
}

export async function searchPlaces(env, query, fetchImpl = fetch) {
  const key = env?.GOOGLE_PLACES_API_KEY;
  const textQuery = clean(query);
  if (!key || !textQuery) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
      body: JSON.stringify({ textQuery, languageCode: 'ja', regionCode: 'JP', pageSize: 5 })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.warn('places search failed', response.status, payload?.error?.status, payload?.error?.message);
      return null;
    }
    return (payload.places || [])
      .filter(place => place.businessStatus !== 'CLOSED_PERMANENTLY')
      .map(placeToCandidate)
      .filter(candidate => candidate.name)
      .slice(0, 5);
  } catch (error) {
    console.warn('places search error', error?.message || error);
    return null;
  } finally { clearTimeout(timer); }
}
