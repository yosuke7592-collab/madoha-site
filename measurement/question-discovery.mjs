const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const list = value => Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
const uniq = values => [...new Set(values.map(clean).filter(Boolean))];
const key = value => clean(value).normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/[？！?！。、,.「」『』\s]/g, '');

export function normalizeDiscoveryInput(input = {}) {
  const entity = input.entity || input;
  const sourceSignals = (input.source_signals || []).map(signal => typeof signal === 'string' ? { type: 'existing', value: clean(signal) } : {
    type: clean(signal.type || 'existing'), value: clean(signal.value || signal.label), source: clean(signal.source), url: clean(signal.url)
  }).filter(signal => signal.value);
  return {
    entity: {
      name: clean(entity.name), entity_type: clean(entity.entity_type || 'company'), official_url: clean(entity.official_url || entity.url),
      region: clean(entity.region || entity.area), industry: clean(entity.industry || entity.category),
      main_services: uniq(entity.main_services || entity.services || []), main_products: uniq(entity.main_products || entity.products || []),
      faq: list(entity.faq), headings: list(entity.headings)
    },
    source_signals: sourceSignals,
    intents: uniq(input.intents || []), related_search_signals: uniq(input.related_search_signals || input.search_demand_signals || [])
  };
}

export function recommendQuestionMix(raw) {
  const { entity, intents, related_search_signals } = normalizeDiscoveryInput(raw);
  const offerings = uniq([...entity.main_services, ...entity.main_products]);
  const localMultiService = Boolean(entity.region) && offerings.length >= 3;
  const discovery_count = localMultiService ? 7 : offerings.length >= 2 || related_search_signals.length >= 3 ? 6 : 4;
  const brand_count = 10 - discovery_count;
  const reason = localMultiService
    ? `御社は${entity.region}で複数の${entity.industry || 'サービス'}を提供しているため、会社名を知らない顧客がAIへ相談する場面を多めに設定しました。`
    : discovery_count >= 6
      ? `複数のサービスや検索需要が確認できるため、候補として選ばれる場面をやや多めに設定しました。`
      : `提供内容が専門的で、企業への理解や信頼性が利用判断に影響しやすいため、会社名を指定した確認を多めに設定しました。`;
  return { discovery_count, brand_count, reason, inputs: { offering_count: offerings.length, intent_count: intents.length, demand_signal_count: related_search_signals.length } };
}

const evidenceFor = (input, offering) => {
  const evidence = [];
  if (offering) evidence.push({ type: 'service_or_product', value: offering, source: 'entity_profile' });
  if (input.entity.region) evidence.push({ type: 'region', value: input.entity.region, source: 'entity_profile' });
  const matching = [...input.source_signals, ...input.related_search_signals.map(value => ({ type: 'related_search', value }))]
    .filter(signal => !offering || signal.value.includes(offering) || offering.includes(signal.value)).slice(0, 2);
  return [...evidence, ...matching];
};

const discoveryQuestion = (input, offering, index) => {
  const region = input.entity.region || '対応地域';
  const evidence = evidenceFor(input, offering);
  const variants = [
    `${region}で${offering}を相談できる会社は？`,
    `${region}で${offering}に詳しい会社を比較したい`,
    `${offering}を依頼するなら${region}ではどの会社が候補？`,
    `${region}で${offering}を任せる会社の選び方は？`,
    `${region}の${offering}で実績を確認できる会社は？`,
    `${offering}について${region}で相談先を探すには？`
  ];
  return {
    question_text: variants[Math.floor(index / Math.max(1, uniq([...input.entity.main_services, ...input.entity.main_products, ...input.intents]).length)) % variants.length], kind: 'nonbrand', intent: offering,
    selection_reason: `${offering}が対象企業の提供内容として確認でき、${region}で相談先を探す場面に合うため選びました。`,
    measurement_purpose: `会社名を知らない${offering}の検討者がAIに相談したとき、御社が候補として紹介されるかを確認します。`,
    alternatives: [`${region}で${offering}に詳しい会社を教えて`, `${offering}を依頼するなら${region}ではどの会社が候補？`, `${region}の${offering}の相談先を比較したい`], evidence,
    generation_rule: `discovery:offering-region:${index + 1}`
  };
};

const brandTemplates = [
  ['会社理解', name => `${name}はどんな会社？`, 'AIが御社の事業内容や対応地域を正しく説明できるかを確認します。', name => [`${name}の事業内容を教えて`, `${name}は何を相談できる会社？`]],
  ['評判・信頼性', name => `${name}の評判や信頼性は？`, 'AIが口コミや第三者情報をどのように扱い、利用判断の材料を示すかを確認します。', name => [`${name}は信頼できる会社？`, `${name}の口コミや評価を知りたい`]],
  ['強み・注意点', name => `${name}の強みと、相談前の注意点は？`, 'AIが御社の選ばれる理由と、公開情報で不足している点をどう捉えるか確認します。', name => [`${name}へ相談するメリットは？`, `${name}を選ぶ前に確認すべきことは？`]],
  ['利用判断', (name, service) => `${name}に${service}を相談して大丈夫？`, '実際に依頼を検討する人へ、AIがどのような判断材料を提示するかを確認します。', (name, service) => [`${service}を${name}へ頼む判断材料は？`, `${name}は${service}の相談先として合っている？`]],
  ['情報の正確性', name => `${name}について、確認できる公式情報は？`, 'AIの説明が公式情報に基づいているか、誤解や情報不足がないかを確認します。', name => [`${name}の公式情報を整理して`, `${name}について確かな情報は何？`]],
  ['比較時の特徴', name => `${name}は同業他社と比べてどんな特徴がある？`, '比較検討時に、AIが御社固有の特徴を説明できるかを確認します。', name => [`${name}ならではの特徴は？`, `${name}と他社の違いを教えて`]]
];

export function qaGeneratedQuestions(candidates, entityName) {
  const accepted = []; const rejected = []; const seen = new Set();
  for (const candidate of candidates) {
    const text = clean(candidate.question_text); const alternatives = uniq(candidate.alternatives || []).filter(item => item.length <= 100 && !/(必ず|絶対|最高|一位)/.test(item));
    let reason = '';
    if (!text || text.length > 100) reason = 'empty_or_too_long';
    else if (/(必ず|絶対|最高だと|一位と)/.test(text)) reason = 'leading';
    else if (!candidate.intent || !candidate.evidence?.length) reason = 'unsupported';
    else if (candidate.kind === 'nonbrand' && text.includes(entityName)) reason = 'nonbrand_contains_entity';
    else if (candidate.kind === 'branded' && !text.includes(entityName)) reason = 'branded_missing_entity';
    else if (seen.has(key(text))) reason = 'duplicate';
    if (reason) rejected.push({ ...candidate, qa_rejection: reason });
    else { seen.add(key(text)); accepted.push({ ...candidate, alternatives: alternatives.filter(item => key(item) !== key(text)), qa: { natural: true, neutral: true, relevant: true, distinct: true } }); }
  }
  return { accepted, rejected };
}

export function generateQuestionDiscovery(raw) {
  const input = normalizeDiscoveryInput(raw); const { entity } = input;
  if (!entity.name || !entity.industry || !entity.main_services.length && !entity.main_products.length) throw new TypeError('企業名、業種、主要サービスまたは商品が必要です。');
  const mix = recommendQuestionMix(input); const offerings = uniq([...entity.main_services, ...entity.main_products, ...input.intents]);
  const candidates = [];
  for (let i = 0; i < mix.discovery_count; i++) candidates.push(discoveryQuestion(input, offerings[i % offerings.length], i));
  for (let i = 0; i < mix.brand_count; i++) {
    const [intent, make, purpose, alternatives] = brandTemplates[i % brandTemplates.length]; const service = offerings[i % offerings.length];
    candidates.push({ question_text: make(entity.name, service), kind: 'branded', intent, selection_reason: `${entity.name}を直接調べる利用者が、${intent}を確認する代表的な場面のため選びました。`, measurement_purpose: purpose, alternatives: alternatives(entity.name, service), evidence: evidenceFor(input, service), generation_rule: `brand:${intent}` });
  }
  const qa = qaGeneratedQuestions(candidates, entity.name);
  if (qa.accepted.length !== 10) throw new Error(`QA通過後の質問が10問に達しません（${qa.accepted.length}/10）。入力サービスの重複を確認してください。`);
  const questions = qa.accepted.map((question, index) => ({
    id: `qd-${String(index + 1).padStart(2, '0')}`, order: index + 1, ...question,
    source_signals: question.evidence.map(item => item.value), discovery_evidence: question.evidence,
    generation_source: 'rule_based_v1', proposed_question_text: question.question_text, proposed_kind: question.kind, user_modified: false, confirmed: false
  }));
  return { schema_version: 'question-discovery-v1', generated_at: new Date().toISOString(), entity, inputs: input, mix, questions, rejected: qa.rejected };
}
