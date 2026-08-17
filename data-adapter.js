const DATASETS = Object.freeze({
  'setagaya-home-v1': {
    path: './data/measured/jp-tokyo-setagaya-exterior-painting-setagaya-home.json',
    aliases: ['世田谷ホーム', '世田谷ホーム株式会社'],
    domains: ['setagayahome.co.jp']
  }
});

const normalizeName = value => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/[\s\u3000]/gu, '');

function inputDomain(value) {
  const source = String(value || '').trim();
  if (!source || (!source.includes('.') && !/^https?:\/\//iu.test(source))) return '';
  try { return new URL(/^https?:\/\//iu.test(source) ? source : `https://${source}`).hostname.toLowerCase().replace(/^www\./u, ''); }
  catch { return ''; }
}

export function resolveDataset(input) {
  const name = normalizeName(input);
  const domain = inputDomain(input);
  for (const [id, entry] of Object.entries(DATASETS)) {
    if (entry.aliases.some(alias => normalizeName(alias) === name)) return { id, path: entry.path };
    if (domain && entry.domains.some(item => domain === item || domain.endsWith(`.${item}`))) return { id, path: entry.path };
  }
  return null;
}

function validateMeasuredDataset(value) {
  if (!value || typeof value !== 'object' || value.dataset?.status !== 'measured') throw new Error('Measured dataset is malformed.');
  if (value.subject?.name !== '世田谷ホーム' || value.scores?.visibility !== 41) throw new Error('Measured dataset identity is invalid.');
  if (!Array.isArray(value.models) || !Array.isArray(value.queries) || !Array.isArray(value.competitors) || !Array.isArray(value.sources)) {
    throw new Error('Measured dataset collections are malformed.');
  }
  return value;
}

export async function loadMeasuredDataset(datasetId, options = {}) {
  const entry = DATASETS[datasetId];
  if (!entry) throw new Error('Measured dataset is not registered.');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let response;
  try { response = await fetchImpl(entry.path, { headers: { Accept: 'application/json' } }); }
  catch { throw new Error('Measured dataset could not be loaded.'); }
  if (!response?.ok) throw new Error('Measured dataset could not be loaded.');
  try { return validateMeasuredDataset(await response.json()); }
  catch (error) { throw new Error(error.message === 'Measured dataset could not be loaded.' ? error.message : 'Measured dataset is malformed.'); }
}

export const measuredDatasetCatalog = DATASETS;
