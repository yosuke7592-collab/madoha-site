import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateResultData } from './aggregate.mjs';
import { COMPANY_REGISTRY, MARKET, SUBJECT } from './data.mjs';
import { extractCompanies } from './extraction.mjs';
import { classifySource, SOURCE_CLASSIFICATION_VERSION } from './source.mjs';
import { validateMeasurementRecord } from './schema.mjs';

const measurementRoot = fileURLToPath(new URL('.', import.meta.url));
const valueAfter = (args, flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : null;

function safeRunId(value) {
  if (!/^[a-z0-9][a-z0-9-]+$/iu.test(value || '')) throw new Error('A safe --run ID is required.');
  return value;
}

export function reprocessRecords(records, registry = COMPANY_REGISTRY) {
  return records.map(record => {
    if (record.status === 'failed') return structuredClone(record);
    const citations = record.citations.map(citation => ({
      ...citation,
      ...classifySource(citation.url || citation.canonicalUrl, registry)
    }));
    const companies = extractCompanies(record.answerText, registry, citations, { includeCitationOnly: false });
    return validateMeasurementRecord({
      ...record,
      citations,
      companies,
      providerMetadata: {
        ...record.providerMetadata,
        sourceClassificationVersion: SOURCE_CLASSIFICATION_VERSION,
        normalizationVersion: '0.2'
      }
    });
  });
}

export function classificationSummary(records) {
  const categories = ['official', 'comparison', 'reviews', 'industry_media', 'sns', 'google', 'other'];
  const citations = records.filter(record => record.status === 'success').flatMap(record => record.citations);
  const domains = new Map();
  for (const citation of citations) {
    const key = `${citation.sourceType}|${citation.domain}`;
    domains.set(key, (domains.get(key) || 0) + 1);
  }
  return {
    version: SOURCE_CLASSIFICATION_VERSION,
    totalAssociations: citations.length,
    counts: Object.fromEntries(categories.map(category => [category, citations.filter(citation => citation.sourceType === category).length])),
    domains: [...domains.entries()].map(([key, count]) => {
      const [sourceType, domain] = key.split('|');
      return { domain, sourceType, count };
    }).sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
  };
}

export function companyNormalizationSummary(records, registry = COMPANY_REGISTRY) {
  const successful = records.filter(record => record.status === 'success');
  const summary = new Map();
  for (const record of successful) for (const company of record.companies) {
    const registered = registry.find(item => item.id === company.normalizedCompanyId);
    const id = company.normalizedCompanyId || `unknown:${company.rawName}`;
    const item = summary.get(id) || {
      id, displayName: registered?.displayName || company.rawName, normalized: Boolean(registered),
      appearances: 0, recommendations: 0, measurementCount: 0, relativePositionCount: 0, citationAssociations: 0
    };
    item.appearances += 1;
    item.measurementCount += 1;
    if (company.recommended) item.recommendations += 1;
    if (Number.isFinite(company.relativePosition)) item.relativePositionCount += 1;
    item.citationAssociations += Number(company.citationAssociations) || 0;
    summary.set(id, item);
  }
  return [...summary.values()].sort((a, b) => b.appearances - a.appearances || b.recommendations - a.recommendations);
}

export async function reprocessRun(runId, options = {}) {
  const inputRoot = resolve(measurementRoot, 'output', safeRunId(runId));
  const outputRoot = resolve(inputRoot, 'reprocessed-v0.2');
  const sourceRecords = JSON.parse(await readFile(resolve(inputRoot, 'measurement-records.json'), 'utf8'));
  const records = reprocessRecords(sourceRecords, options.registry || COMPANY_REGISTRY);
  const resultData = aggregateResultData(records, MARKET, SUBJECT, options.registry || COMPANY_REGISTRY);
  const classifications = classificationSummary(records);
  const companies = companyNormalizationSummary(records, options.registry || COMPANY_REGISTRY);
  if (options.writeOutput !== false) {
    await mkdir(outputRoot, { recursive: true });
    await Promise.all([
      writeFile(resolve(outputRoot, 'normalized-measurements.json'), JSON.stringify(records, null, 2)),
      writeFile(resolve(outputRoot, 'result-data-v1.json'), JSON.stringify(resultData, null, 2)),
      writeFile(resolve(outputRoot, 'classification-summary.json'), JSON.stringify(classifications, null, 2)),
      writeFile(resolve(outputRoot, 'company-normalization-summary.json'), JSON.stringify(companies, null, 2))
    ]);
  }
  return { records, resultData, classifications, companies, outputRoot };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  reprocessRun(valueAfter(process.argv.slice(2), '--run')).then(output => {
    console.log(JSON.stringify({
      outputRoot: output.outputRoot,
      measurements: output.records.length,
      competitors: output.resultData.competitors.length,
      sources: output.classifications.counts,
      visibility: output.resultData.scores.visibility,
      scoreCompleteness: output.resultData.dataset.scoreCompleteness
    }, null, 2));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
