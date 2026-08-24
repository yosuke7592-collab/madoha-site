export const PAID_V1 = Object.freeze({
  priceJpy: 4980,
  entityTypes: ['company', 'service', 'product', 'brand'],
  channels: ['chatgpt', 'gemini', 'google_ai_mode'],
  queryCounts: { nonbrand: 6, branded: 4, total: 10 },
  repetitions: 1,
  totalMeasurements: 30,
});

const normalized = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');

export function identifyEntity(input = {}) {
  const entityType = normalized(input.entity_type || 'company').toLowerCase();
  const name = normalized(input.name);
  const officialUrl = normalized(input.official_url);
  const context = normalized(input.context);
  if (!PAID_V1.entityTypes.includes(entityType)) throw new TypeError('対応していない診断対象です。');
  if (!name) return { status: 'insufficient', reason: '診断対象の名称が必要です。', candidates: [] };
  if (!officialUrl && !context) return { status: 'insufficient', reason: '同名対象を区別するため、公式URLまたは地域・業種等が必要です。', candidates: [] };
  const candidate = { entity_type: entityType, name, official_url: officialUrl || null, context: context || null };
  return { status: 'confirmation_required', prompt: 'この対象で間違いありませんか？', candidates: [candidate] };
}

export function confirmEntity(result, candidateIndex = 0) {
  if (result?.status !== 'confirmation_required' || !result.candidates?.[candidateIndex]) throw new TypeError('確認できる候補がありません。');
  return { ...result.candidates[candidateIndex], identification_status: 'confirmed' };
}

export function auditQueries(queries, subjectName) {
  const failures = [];
  if (!Array.isArray(queries) || queries.length !== PAID_V1.queryCounts.total) failures.push('質問は合計10問必要です。');
  const nonbrand = (queries || []).filter(query => query.kind === 'nonbrand');
  const branded = (queries || []).filter(query => query.kind === 'branded');
  if (nonbrand.length !== 6) failures.push('非指名質問は6問必要です。');
  if (branded.length !== 4) failures.push('指名質問は4問必要です。');
  if (nonbrand.some(query => normalized(query.query).includes(normalized(subjectName)))) failures.push('非指名質問に対象名を含められません。');
  if (branded.some(query => !normalized(query.query).includes(normalized(subjectName)))) failures.push('指名質問には対象名が必要です。');
  const unique = new Set((queries || []).map(query => normalized(query.query)));
  if (unique.size !== (queries || []).length) failures.push('重複する質問があります。');
  for (const query of queries || []) {
    if (!query.discoveryEvidence?.length) failures.push(`${query.id}: Query Discoveryの根拠が必要です。`);
    if (!query.qa?.natural || !query.qa?.neutral || !query.qa?.relevant || !query.qa?.distinct) failures.push(`${query.id}: Query QAを通過していません。`);
  }
  return { passed: failures.length === 0, failures };
}

export function validateFixtureReport(report) {
  if (!report || report.subject?.identification_status !== 'confirmed') throw new TypeError('診断対象が確定していません。');
  if (!PAID_V1.entityTypes.includes(report.subject.entity_type)) throw new TypeError('entity_typeが不正です。');
  const qa = auditQueries(report.queries, report.subject.name);
  if (!qa.passed) throw new TypeError(qa.failures.join(' '));
  for (const query of report.queries) {
    if (query.channels?.length !== PAID_V1.channels.length) throw new TypeError(`${query.id}: 3チャネルの測定が必要です。`);
    const channels = new Set(query.channels.map(item => item.channel));
    if (PAID_V1.channels.some(channel => !channels.has(channel))) throw new TypeError(`${query.id}: 必須チャネルが不足しています。`);
    if (query.channels.some(item => item.repetition !== 1)) throw new TypeError(`${query.id}: v1は各チャネル1回測定です。`);
  }
  return report;
}
