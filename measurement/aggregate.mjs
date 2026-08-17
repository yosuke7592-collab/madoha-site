import { SOURCE_CLASSIFICATION_VERSION } from './source.mjs';
import { RECOMMENDATION_RULE_VERSION } from './extraction.mjs';

const positionFactor = position => position === 1 ? 1 : position === 2 ? .8 : position === 3 ? .6 : position === 4 ? .4 : position === 5 ? .2 : .1;
const round = value => Math.round(value * 100) / 100;

function targetIn(record, subjectId) { return record.companies.find(company => company.normalizedCompanyId === subjectId); }
function targetCitation(record, subject) {
  const names = [subject.canonicalName, subject.displayName, ...(subject.aliases || [])].filter(Boolean);
  return record.citations.some(citation =>
    names.some(name => String(citation.title || '').includes(name)) || (subject.officialDomains || []).some(domain => {
      const citationDomain = String(citation.domain || '');
      return citationDomain === domain || citationDomain.endsWith(`.${domain}`);
    })
  );
}

function binaryConsistency(values) {
  if (values.length < 2) return null;
  const yes = values.filter(Boolean).length;
  return Math.max(yes, values.length - yes) / values.length;
}

function calculateStability(success, subjectId) {
  const groups = new Map();
  for (const record of success) {
    const key = `${record.queryId}|${record.provider}|${record.model}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const scores = [];
  for (const records of groups.values()) {
    if (records.length < 2) continue;
    const appearances = records.map(record => Boolean(targetIn(record, subjectId)?.appeared));
    const recommendations = records.map(record => Boolean(targetIn(record, subjectId)?.recommended));
    scores.push((binaryConsistency(appearances) + binaryConsistency(recommendations)) / 2);
  }
  return scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length * 100) : null;
}

export function aggregateResultData(records, market, subject) {
  const success = records.filter(record => record.status === 'success');
  const targetRows = success.map(record => ({ record, company: targetIn(record, subject.id) }));
  const appearances = targetRows.filter(item => item.company?.appeared).length;
  const recommendations = targetRows.filter(item => item.company?.recommended).length;
  const positions = targetRows.map(item => item.company?.relativePosition).filter(Number.isFinite);
  const citationEligible = targetRows.filter(item => item.company?.appeared);
  const citationEvidence = citationEligible.filter(item => targetCitation(item.record, subject)).length;
  const appearanceScore = success.length ? appearances / success.length * 30 : 0;
  const recommendationScore = success.length ? recommendations / success.length * 30 : 0;
  const positionScore = positions.length ? positions.reduce((sum, value) => sum + positionFactor(value), 0) / positions.length * 25 : 0;
  const citationScore = citationEligible.length ? citationEvidence / citationEligible.length * 15 : 0;
  const completeness = (success.length ? 60 : 0) + (positions.length ? 25 : 0) + (citationEligible.length ? 15 : 0);
  const visibility = Math.round(appearanceScore + recommendationScore + positionScore + citationScore);
  const stability = calculateStability(success, subject.id);

  const modelGroups = new Map();
  for (const record of success) {
    const key = `${record.provider}:${record.model}`;
    if (!modelGroups.has(key)) modelGroups.set(key, []);
    modelGroups.get(key).push(record);
  }
  const models = [...modelGroups.entries()].map(([id, group]) => {
    const detected = group.some(record => targetIn(record, subject.id)?.appeared);
    const value = group.length ? Math.round(group.filter(record => targetIn(record, subject.id)?.appeared).length / group.length * 100) : null;
    return { id, name: 'Perplexity Sonar', value, detected };
  });
  const plannedModels = new Set(records.map(record => `${record.provider}:${record.model}`));
  const coverageDetected = models.filter(model => model.detected).length;

  const queries = market.queries.map(query => {
    const group = success.filter(record => record.queryId === query.id);
    const strength = group.length ? group.filter(record => targetIn(record, subject.id)?.appeared).length / group.length : null;
    return { id: query.id, name: query.text, short: query.intent, strength, status: strength === null ? 'not-measured' : strength >= .67 ? 'strong' : strength >= .34 ? 'medium' : 'weak' };
  });
  const competitorMap = new Map();
  for (const record of success) for (const company of record.companies) {
    if (!company.normalizedCompanyId || company.normalizedCompanyId === subject.id) continue;
    const item = competitorMap.get(company.normalizedCompanyId) || { id: company.normalizedCompanyId, name: company.rawName, count: 0 };
    item.count += 1; competitorMap.set(item.id, item);
  }
  const competitors = [...competitorMap.values()].map(item => ({ id: item.id, name: item.name, strength: item.count / success.length })).sort((a, b) => b.strength - a.strength);
  const sourceCounts = new Map();
  for (const record of success) for (const citation of record.citations) sourceCounts.set(citation.sourceType, (sourceCounts.get(citation.sourceType) || 0) + 1);
  const sources = [...sourceCounts.entries()].map(([type, count]) => ({ id: `source-${type}`, name: type, label: type, count, strength: count / Math.max(1, success.length) }));
  const strongest = [...queries].filter(query => query.strength !== null).sort((a, b) => b.strength - a.strength)[0];

  return {
    schemaVersion: '1.0',
    dataset: {
      status: records.length > 0 && records.every(record => record.status === 'success') ? 'measured' : 'partial',
      measuredAt: records.map(record => record.measuredAt).sort().at(-1) || null,
      measurementRunId: records[0]?.runId || null, scoringVersion: '0.1', stabilityVersion: '0.1',
      recommendationRuleVersion: RECOMMENDATION_RULE_VERSION, sourceClassificationVersion: SOURCE_CLASSIFICATION_VERSION,
      scoreCompleteness: { measured: completeness, total: 100 },
      scoreComponents: {
        appearance: { value: round(appearanceScore), max: 30, status: success.length ? 'measured' : 'not_measured' },
        recommendation: { value: round(recommendationScore), max: 30, status: success.length ? 'measured' : 'not_measured' },
        relativePosition: { value: round(positionScore), max: 25, status: positions.length ? 'measured' : 'not_measured' },
        citationEvidence: { value: round(citationScore), max: 15, status: citationEligible.length ? 'measured' : 'not_measured' }
      }
    },
    subject: { name: subject.displayName, officialUrl: '' },
    market: { location: market.location, industry: market.industry, label: market.label },
    scores: {
      visibility, visibilityBand: visibility >= 70 ? 'HIGH' : visibility >= 40 ? 'MID' : 'LOW', stability,
      stabilityStatus: stability === null ? 'not_measured' : 'measured', accuracy: null, accuracyStatus: 'not_measured',
      modelCoverage: { detected: success.length ? coverageDetected : null, total: success.length ? plannedModels.size : null, status: success.length ? 'measured' : 'not_measured' },
      recommendation: { detected: recommendations, total: success.length }
    },
    models, queries, competitors, sources, informationIssues: [],
    insights: {
      visibilityDescription: 'MADOHA Scoring v0.1による内部観測指標です。AI事業者のランキング要因ではありません。',
      observation: { title: `${recommendations} / ${success.length}件の有効測定で推薦を確認しました。`, body: strongest ? `最も認識が強かったqueryは「${strongest.name}」です。` : '有効なquery測定がありません。' },
      competitorGap: { prefix: 'fixture測定では、', highlight: `${competitors.length}社の比較対象`, suffix: 'を確認しました。', detail: '観測結果であり、推薦要因を示すものではありません。' },
      modelNote: 'Provider API fixtureから生成したMADOHA内部測定値です。', competitorNote: '出現差は因果関係やランキング要因を示しません。',
      accuracySummary: 'Accuracyは未測定です。', sourcesNote: `${sources.reduce((sum, item) => sum + item.count, 0)}件のcitationを分類しました。`
    },
    analysisStages: [
      { label: 'MEASUREMENTS PROCESSED', value: `${records.length} Records`, category: 'models' },
      { label: 'SUCCESSFUL MEASUREMENTS', value: `${success.length} Records`, category: 'queries' },
      { label: 'COMPETITORS FOUND', value: `${competitors.length} Companies`, category: 'competitors' },
      { label: 'SOURCES ANALYZED', value: `${sources.reduce((sum, item) => sum + item.count, 0)} Sources`, category: 'sources' },
      { label: 'AI VISIBILITY CALCULATED', value: `${visibility} / 100`, category: 'complete' }
    ]
  };
}
