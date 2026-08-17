export const MARKET = {
  id: 'jp-tokyo-setagaya-exterior-painting',
  location: '東京都 世田谷区',
  industry: '外壁塗装',
  label: '世田谷区 × 外壁塗装',
  queries: [
    ['recommendation', '世田谷区でおすすめの外壁塗装会社を教えて'],
    ['reviews', '世田谷区で口コミや評判のいい外壁塗装会社を教えて'],
    ['cost', '世田谷区で費用が分かりやすい外壁塗装会社を教えて'],
    ['qualification', '世田谷区で資格や保証がしっかりした外壁塗装会社を教えて'],
    ['subsidy', '世田谷区の助成金に詳しい外壁塗装会社を教えて'],
    ['roof', '世田谷区で屋根塗装も相談できる外壁塗装会社を教えて']
  ].map(([intent, text], index) => ({ id: `setagaya-${intent}-natural-v1`, intent, style: 'natural', text, order: index + 1 }))
};

export const COMPANY_REGISTRY = [
  {
    id: 'demo-company-setagaya-home', canonicalName: '世田谷ホーム', displayName: '世田谷ホーム',
    aliases: ['世田谷ホーム'], officialDomains: [], marketIds: [MARKET.id], fixture: false
  },
  {
    id: 'fixture-company-tokyo-paint', canonicalName: '東京ペイント', displayName: '東京ペイント',
    aliases: ['東京ペイント'], officialDomains: ['tokyo-paint.example'], marketIds: [MARKET.id], fixture: true
  },
  {
    id: 'fixture-company-setagaya-reform', canonicalName: '世田谷リフォーム', displayName: '世田谷リフォーム',
    aliases: ['世田谷リフォーム'], officialDomains: ['setagaya-reform.example'], marketIds: [MARKET.id], fixture: true
  }
];

export const SUBJECT = COMPANY_REGISTRY[0];

function response({ id, content = '', citations = [], searchResults = [], status = 'success', error = null, prompt = 90, completion = 180 }) {
  return {
    id, model: 'sonar', created: 1786982400, fixtureStatus: status, fixtureError: error,
    choices: status === 'failed' ? [] : [{ index: 0, message: { role: 'assistant', content }, finish_reason: status === 'partial' ? 'length' : 'stop' }],
    usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion, cost: { total_cost: 0 } },
    citations, search_results: searchResults
  };
}

const targetCitation = queryId => ({
  title: `世田谷ホームに関するfixture資料 ${queryId}`,
  url: `https://reviews.example/setagaya-home/${queryId}?utm_source=fixture#details`, source: 'web'
});
const competitorCitation = { title: '東京ペイント公式fixture', url: 'https://www.tokyo-paint.example/cases', source: 'web' };

export function fixtureFor(query, repetition) {
  const id = `fixture-${query.intent}-r${repetition}`;
  if (repetition === 1) {
    const content = `おすすめの候補は次の通りです。\n1. 世田谷ホーム — 地域の相談先候補です。\n2. 東京ペイント — 施工例を比較できます。`;
    const results = [targetCitation(query.id), competitorCitation];
    return response({ id, content, citations: results.map(item => item.url), searchResults: results });
  }
  if (repetition === 2) {
    const positive = ['recommendation', 'reviews', 'cost'].includes(query.intent);
    const content = positive
      ? `評価の高い会社の候補として世田谷ホームがあります。比較対象として世田谷リフォームも確認できます。`
      : `世田谷ホームの情報を確認しました。比較のため東京ペイントも参照してください。`;
    const results = positive ? [targetCitation(query.id)] : [competitorCitation];
    return response({ id, content, citations: results.map(item => item.url), searchResults: results });
  }
  if (query.intent === 'qualification') {
    return response({ id, status: 'partial', content: '世田谷ホームについて確認しましたが、引用情報を取得できませんでした。' });
  }
  if (query.intent === 'subsidy') {
    return response({ id, status: 'failed', error: { code: 'fixture_provider_error', message: 'Synthetic provider failure.', retryable: false } });
  }
  if (query.intent === 'roof') {
    const content = `候補は次の通りです。\n1. 東京ペイント\n2. 世田谷ホーム`;
    const results = [targetCitation(query.id)];
    return response({ id, content, citations: results.map(item => item.url), searchResults: results });
  }
  return response({ id, content: '候補として東京ペイントと世田谷リフォームが確認できました。', searchResults: [competitorCitation], citations: [competitorCitation.url] });
}
