export const mockResult = {
  schemaVersion: '1.0',
  dataset: { status: 'demo', measuredAt: null },
  subject: { name: '世田谷ホーム', officialUrl: '' },
  market: { location: '東京都 世田谷区', industry: '外壁塗装', label: '世田谷区 × 外壁塗装' },
  scores: {
    visibility: 42,
    visibilityBand: 'LOW — MID',
    stability: 68,
    accuracy: null,
    modelCoverage: { detected: 2, total: 3 },
    recommendation: { detected: 7, total: 18 }
  },
  models: [
    { id: 'chatgpt', name: 'ChatGPT', value: 58, detected: true },
    { id: 'gemini', name: 'Gemini', value: 41, detected: true },
    { id: 'perplexity', name: 'Perplexity', value: 27, detected: false }
  ],
  queries: [
    { id: 'q1', name: '世田谷区 外壁塗装 口コミ', short: '口コミがいい会社', strength: .88, status: 'strong' },
    { id: 'q2', name: '世田谷区 外壁塗装 おすすめ', short: 'おすすめの会社', strength: .32, status: 'weak' },
    { id: 'q3', name: '助成金に詳しい外壁塗装会社', short: '助成金に詳しい', strength: .63, status: 'medium' },
    { id: 'q4', name: '外壁塗装 国家資格', short: '国家資格', strength: .26, status: 'weak' },
    { id: 'q5', name: '世田谷区 屋根塗装', short: '屋根塗装', strength: .56, status: 'medium' }
  ],
  competitors: [
    { id: 'c1', name: '東京ペイント', strength: .86 },
    { id: 'c2', name: '世田谷リフォーム', strength: .72 },
    { id: 'c3', name: '成城建装', strength: .57 },
    { id: 'c4', name: 'みらい塗装', strength: .43 }
  ],
  sources: [
    { id: 's1', name: 'Official Website', label: '公式サイト', count: 8, strength: .9 },
    { id: 's2', name: 'Google', label: 'Google', count: 6, strength: .75 },
    { id: 's3', name: 'Comparison Site', label: '比較サイト', count: 4, strength: .58 },
    { id: 's4', name: 'Review Site', label: '口コミサイト', count: 3, strength: .48 },
    { id: 's5', name: 'Industry Media', label: '業界メディア', count: 2, strength: .36 }
  ],
  informationIssues: [
    {
      field: '所在地',
      summary: '所在地に不一致が見つかりました',
      official: { label: '公式サイト', value: '成城' },
      observed: { label: '第三者サイト', value: '喜多見' }
    }
  ],
  insights: {
    visibilityDescription: 'AI回答内での認識・推薦・情報整合性を統合したデモ指標です。',
    observation: {
      title: '認識はされていますが、「おすすめ」の質問では競合が優勢です。',
      body: '資格・保証・施工事例の情報を、AIが取得しやすい形で補強できる余地があります。'
    },
    competitorGap: {
      prefix: '推薦された競合企業では、',
      highlight: '「施工事例」「保証」「資格情報」',
      suffix: 'が明確に確認できました。',
      detail: '対象企業では、一部の情報がAIから取得しやすい形で確認できませんでした。'
    },
    modelNote: 'MADOHA独自のデモ測定値です。各AI事業者の公式スコアではありません。',
    competitorNote: '確認できた情報上の差分であり、AIのランキング要因を示すものではありません。',
    accuracySummary: 'AIの誤認を防ぐため、第三者サイトの情報確認を推奨します。',
    sourcesNote: 'AI回答・関連データで観測された参照元です。ランキング要因を示すものではありません。'
  },
  analysisStages: [
    { label: 'COMPANY FOUND', value: '世田谷ホーム', category: 'company' },
    { label: 'INDUSTRY DETECTED', value: '外壁塗装', category: 'queries' },
    { label: 'LOCATION DETECTED', value: '東京都 世田谷区', category: 'queries' },
    { label: 'SEARCH INTENTS GENERATED', value: '18 Queries', category: 'queries' },
    { label: 'AI MODELS CHECKED', value: 'ChatGPT / Gemini / Perplexity', category: 'models' },
    { label: 'COMPETITORS FOUND', value: '8 Companies', category: 'competitors' },
    { label: 'SOURCES ANALYZED', value: '23 Sources', category: 'sources' },
    { label: 'AI VISIBILITY CALCULATED', value: '42 / 100', category: 'complete' }
  ]
};

const asArray = value => Array.isArray(value) ? structuredClone(value) : [];
const asNumber = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const asText = (value, fallback = '') => typeof value === 'string' ? value : fallback;
const statusValues = new Set(['demo', 'partial', 'measured']);

export function normalizeResultData(raw = {}, submittedInput = '') {
  const source = raw && typeof raw === 'object' ? raw : {};
  const derivedSource = source.derived && typeof source.derived === 'object' ? source.derived : source;
  const scoreSource = derivedSource.scores && typeof derivedSource.scores === 'object' ? derivedSource.scores : source.scores || {};
  const subjectSource = source.subject && typeof source.subject === 'object' ? source.subject : source.company || {};
  const marketSource = source.market && typeof source.market === 'object' ? source.market : {};
  const datasetSource = source.dataset && typeof source.dataset === 'object' ? source.dataset : {};
  const insightSource = derivedSource.insights && typeof derivedSource.insights === 'object' ? derivedSource.insights : source.insights || {};
  const models = asArray(derivedSource.models ?? source.models).map((item, index) => ({
    id: asText(item?.id, `model-${index + 1}`), name: asText(item?.name, '未測定モデル'),
    value: asNumber(item?.value), detected: typeof item?.detected === 'boolean' ? item.detected : null
  }));
  const queries = asArray(derivedSource.queries ?? source.queries).map((item, index) => ({
    id: asText(item?.id, `query-${index + 1}`), name: asText(item?.name, '未測定クエリ'), short: asText(item?.short),
    strength: asNumber(item?.strength), status: asText(item?.status, 'not-measured')
  }));
  const competitors = asArray(derivedSource.competitors ?? source.competitors).map((item, index) => ({
    id: asText(item?.id, `competitor-${index + 1}`), name: asText(item?.name, '未測定企業'), strength: asNumber(item?.strength)
  }));
  const sources = asArray(derivedSource.sources ?? source.sources).map((item, index) => ({
    id: asText(item?.id, `source-${index + 1}`), name: asText(item?.name, '未測定ソース'),
    label: asText(item?.label, asText(item?.name, '未測定')), count: asNumber(item?.count), strength: asNumber(item?.strength)
  }));
  const informationIssues = asArray(derivedSource.informationIssues ?? source.informationIssues).map(item => ({
    field: asText(item?.field, '情報'), summary: asText(item?.summary, '情報の不一致が見つかりました'),
    official: { label: asText(item?.official?.label, '公式情報'), value: asText(item?.official?.value ?? item?.official, '—') },
    observed: { label: asText(item?.observed?.label ?? item?.source, '確認情報'), value: asText(item?.observed?.value ?? item?.observed, '—') }
  }));
  const subjectName = asText(subjectSource.name, '対象企業未設定');
  const modelCoverageSource = scoreSource.modelCoverage || source.modelCoverage || {};
  const recommendationSource = scoreSource.recommendation || source.recommendation || {};
  const datasetStatus = statusValues.has(datasetSource.status) ? datasetSource.status : 'partial';
  const graphNodes = [
    ...models.map(item => ({ ...item, category: 'models', strength: item.value === null ? null : item.value / 100 })),
    ...queries.map(item => ({ ...item, category: 'queries' })),
    ...competitors.map(item => ({ ...item, category: 'competitors' })),
    ...sources.map(item => ({ ...item, category: 'sources' }))
  ];

  return {
    schemaVersion: asText(source.schemaVersion, '1.0'),
    dataset: { status: datasetStatus, measuredAt: asText(datasetSource.measuredAt) || null },
    subject: { submittedInput: asText(submittedInput).trim(), name: subjectName, officialUrl: asText(subjectSource.officialUrl) },
    market: {
      location: asText(marketSource.location), industry: asText(marketSource.industry),
      label: asText(marketSource.label, [marketSource.location, marketSource.industry].filter(Boolean).join(' × '))
    },
    derived: {
      scores: {
        visibility: asNumber(scoreSource.visibility ?? source.visibilityScore), visibilityBand: asText(scoreSource.visibilityBand),
        stability: asNumber(scoreSource.stability ?? source.stability), accuracy: asNumber(scoreSource.accuracy ?? source.accuracy),
        modelCoverage: { detected: asNumber(modelCoverageSource.detected), total: asNumber(modelCoverageSource.total) },
        recommendation: { detected: asNumber(recommendationSource.detected), total: asNumber(recommendationSource.total) }
      },
      models, queries, competitors, sources, informationIssues,
      insights: {
        visibilityDescription: asText(insightSource.visibilityDescription),
        observation: { title: asText(insightSource.observation?.title ?? insightSource.observation), body: asText(insightSource.observation?.body) },
        competitorGap: {
          prefix: asText(insightSource.competitorGap?.prefix ?? insightSource.competitorGap), highlight: asText(insightSource.competitorGap?.highlight),
          suffix: asText(insightSource.competitorGap?.suffix), detail: asText(insightSource.competitorGap?.detail)
        },
        modelNote: asText(insightSource.modelNote), competitorNote: asText(insightSource.competitorNote),
        accuracySummary: asText(insightSource.accuracySummary), sourcesNote: asText(insightSource.sourcesNote)
      },
      graph: {
        center: { id: 'company', name: subjectName, category: 'company', strength: 1 }, nodes: graphNodes,
        edges: asArray(derivedSource.graph?.edges ?? source.graph?.edges)
      }
    },
    analysisStages: asArray(source.analysisStages)
  };
}
