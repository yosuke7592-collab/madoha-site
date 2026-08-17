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

export const QUERY_SET_VERSION = 'setagaya-exterior-painting-v1';

export const COMPANY_REGISTRY = [
  {
    id: 'demo-company-setagaya-home', canonicalName: '世田谷ホーム', displayName: '世田谷ホーム',
    aliases: ['世田谷ホーム', '世田谷ホーム株式会社'], officialDomains: ['setagayahome.co.jp'], marketIds: [MARKET.id], fixture: false
  },
  { id: 'company-hanamaru-reform', canonicalName: '花まるリフォーム', displayName: '花まるリフォーム', aliases: ['花まるリフォーム'], officialDomains: ['hanamaru-r.jp'], marketIds: [MARKET.id] },
  { id: 'company-gaihekido', canonicalName: '外壁堂', displayName: '外壁堂', aliases: ['外壁堂'], officialDomains: ['gaihekidou.com'], marketIds: [MARKET.id] },
  { id: 'company-shimada-tosou', canonicalName: '島田塗装', displayName: '島田塗装', aliases: ['島田塗装'], officialDomains: ['shimada-tosou.pro'], marketIds: [MARKET.id] },
  { id: 'company-todoroki-kenso', canonicalName: 'とどろき建装', displayName: 'とどろき建装', aliases: ['とどろき建装', '(株)とどろき建装', '株式会社とどろき建装'], officialDomains: ['todorokikensou.jp'], marketIds: [MARKET.id] },
  { id: 'company-nissei-tosou', canonicalName: '日成塗装', displayName: '日成塗装', aliases: ['日成塗装', '有限会社 日成塗装'], officialDomains: ['nisseitosou.com'], marketIds: [MARKET.id] },
  { id: 'company-yanekabe-setagaya', canonicalName: 'ヤネカベ世田谷店', displayName: 'ヤネカベ世田谷店', aliases: ['ヤネカベ世田谷店'], officialDomains: ['yanekabe.pro'], marketIds: [MARKET.id] },
  { id: 'company-yu-magokoro', canonicalName: 'ワイユーまごころ工務店', displayName: 'ワイユーまごころ工務店', aliases: ['ワイユーまごころ工務店'], officialDomains: ['yu-magokoro.com'], marketIds: [MARKET.id] },
  { id: 'company-laporta', canonicalName: 'ラポルタ', displayName: 'ラポルタ', aliases: ['ラポルタ'], officialDomains: ['laporta.co.jp'], marketIds: [MARKET.id] },
  // Both labels point to the same Tokyo shop in the saved answers and gaihekitosou-tokyo.info citation title.
  { id: 'company-tosou-shokunin-tokyo', canonicalName: '塗装職人（東京店）', displayName: '塗装職人（東京店）', aliases: ['塗装職人（東京店）', '株式会社塗装職人', '塗装職人・東京店'], officialDomains: ['gaihekitosou-tokyo.info'], marketIds: [MARKET.id] },
  { id: 'company-tokyo-tosou', canonicalName: '東京塗装株式会社', displayName: '東京塗装株式会社', aliases: ['東京塗装株式会社', '東京塗装 株式会社'], officialDomains: [], marketIds: [MARKET.id] },
  { id: 'company-retolis', canonicalName: '株式会社RETOLIS', displayName: '株式会社RETOLIS', aliases: ['株式会社RETOLIS', 'RETOLIS'], officialDomains: [], marketIds: [MARKET.id] },
  { id: 'company-hagino-tosou', canonicalName: '萩野塗装工業', displayName: '萩野塗装工業', aliases: ['萩野塗装工業'], officialDomains: ['haginotosou.jp'], marketIds: [MARKET.id] },
  { id: 'company-n-frontier', canonicalName: 'Nフロンティア株式会社', displayName: 'Nフロンティア株式会社', aliases: ['Nフロンティア株式会社'], officialDomains: [], marketIds: [MARKET.id] },
  { id: 'company-protimes-soken', canonicalName: '株式会社プロタイムズ総合研究所', displayName: '株式会社プロタイムズ総合研究所', aliases: ['株式会社プロタイムズ総合研究所'], officialDomains: [], marketIds: [MARKET.id] },
  { id: 'company-teigaku-setagaya-kawasaki', canonicalName: 'テイガク世田谷・川崎店', displayName: 'テイガク世田谷・川崎店', aliases: ['テイガク世田谷・川崎店'], officialDomains: [], marketIds: [MARKET.id] },
  // The two spellings occur against the same aoki-tosou.com source set in adjacent repetitions.
  { id: 'company-aoki-tosou', canonicalName: '青木塗装', displayName: '青木塗装', aliases: ['青木塗装', 'アオキ塗装'], officialDomains: ['aoki-tosou.com'], marketIds: [MARKET.id] },
  { id: 'company-noda-bisou', canonicalName: '野田美装', displayName: '野田美装', aliases: ['野田美装'], officialDomains: ['nodabisou.com'], marketIds: [MARKET.id] },
  { id: 'company-fukazawa-tosou', canonicalName: '深沢塗装', displayName: '深沢塗装', aliases: ['深沢塗装'], officialDomains: ['fukazawatosou.com'], marketIds: [MARKET.id] },
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
