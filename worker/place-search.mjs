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

// ---- Autocomplete (typing-time suggestions) -------------------------------
// One Autocomplete session = several suggest calls + one Place Details call that
// closes it (same session token). Google bills the whole session as one Place
// Details request; abandoned sessions are billed per Autocomplete request.
const AUTOCOMPLETE_ENDPOINT = 'https://places.googleapis.com/v1/places:autocomplete';
const DETAILS_FIELD_MASK = 'id,displayName,formattedAddress,primaryTypeDisplayName,types,websiteUri,businessStatus';
const SESSION_TOKEN = /^[A-Za-z0-9-]{8,64}$/;
const PLACE_ID = /^[A-Za-z0-9_-]{10,200}$/;

export const isValidSessionToken = value => SESSION_TOKEN.test(String(value || ''));
export const isValidPlaceId = value => PLACE_ID.test(String(value || ''));

async function placesFetch(url, init, fetchImpl, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { console.warn('places http', response.status, payload?.error?.status, payload?.error?.message); return null; }
    return payload;
  } catch (error) { console.warn('places error', error?.message || error); return null; }
  finally { clearTimeout(timer); }
}

export async function autocompletePlaces(env, input, sessionToken, fetchImpl = fetch) {
  const key = env?.GOOGLE_PLACES_API_KEY;
  const text = clean(input);
  if (!key) return null;                       // null = feature not configured
  if (text.length < 2 || text.length > 100 || !isValidSessionToken(sessionToken)) return [];
  const payload = await placesFetch(AUTOCOMPLETE_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat' },
    body: JSON.stringify({ input: text, languageCode: 'ja', regionCode: 'jp', includedRegionCodes: ['jp'], sessionToken })
  }, fetchImpl);
  return (payload?.suggestions || []).map(item => item.placePrediction).filter(item => item?.placeId).slice(0, 5).map(item => ({
    place_id: item.placeId,
    name: clean(item.structuredFormat?.mainText?.text || item.text?.text),
    detail: clean(item.structuredFormat?.secondaryText?.text)
  }));
}

export async function getPlaceCandidate(env, placeId, sessionToken, fetchImpl = fetch) {
  const key = env?.GOOGLE_PLACES_API_KEY;
  if (!key || !isValidPlaceId(placeId)) return null;
  const params = new URLSearchParams({ languageCode: 'ja', regionCode: 'jp' });
  if (isValidSessionToken(sessionToken)) params.set('sessionToken', sessionToken);
  const payload = await placesFetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?${params}`, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': DETAILS_FIELD_MASK }
  }, fetchImpl);
  if (!payload?.displayName?.text) return null;
  return placeToCandidate(payload);
}
