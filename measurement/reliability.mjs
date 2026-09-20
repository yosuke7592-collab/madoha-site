const LEGAL_FORM = /(?:株式会社|有限会社|合同会社|一般社団法人|一般財団法人|㈱|（株）|\(株\))/gu;
const BRANCH_SUFFIX = /(?:[\s　]*(?:浦安|市川|新浦安|行徳|東京|千葉)?(?:支店|営業所|センター|ショップ|店))$/u;

const compact = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s　・･._\-‐‑–—ー]/gu, '');

export function identityNameKey(value, { removeBranch = true } = {}) {
  let name = String(value || '').normalize('NFKC').replace(LEGAL_FORM, '').trim();
  if (removeBranch) name = name.replace(BRANCH_SUFFIX, '').trim();
  return compact(name);
}

function registeredIdentity(name, registry = []) {
  const key = identityNameKey(name);
  return registry.find(item => [item.canonicalName, item.displayName, item.name, ...(item.aliases || [])]
    .filter(Boolean).some(candidate => identityNameKey(candidate) === key));
}

function sameKnownIdentity(left, right) {
  if (left.entity_id && right.entity_id && left.entity_id !== right.entity_id) return false;
  const leftDomains = new Set(left.official_domains || []); const rightDomains = right.official_domains || [];
  if (leftDomains.size && rightDomains.length && !rightDomains.some(domain => leftDomains.has(domain))) return false;
  if (left.region && right.region && compact(left.region) !== compact(right.region)) return false;
  return true;
}

export function normalizePaidEntityMentions(mentions = [], registry = []) {
  const output = [];
  for (const mention of mentions) {
    const registered = registeredIdentity(mention.name, registry);
    const canonicalName = registered?.displayName || registered?.canonicalName || registered?.name || mention.name;
    const key = identityNameKey(canonicalName);
    if (!key) continue;
    const candidate = { ...mention, entity_id: registered?.id || mention.entity_id || null, official_domains: registered?.officialDomains || mention.official_domains || [] };
    const existing = output.find(item => item.identity_key === key && item.target === Boolean(mention.target) && sameKnownIdentity(item, candidate));
    if (existing) {
      for (const raw of [mention.raw_name, mention.name, ...(mention.raw_names || [])].filter(Boolean)) {
        if (!existing.raw_names.includes(raw)) existing.raw_names.push(raw);
      }
      continue;
    }
    output.push({
      ...mention,
      entity_id: registered?.id || mention.entity_id || null,
      name: canonicalName,
      raw_name: mention.raw_name || mention.name,
      raw_names: [...new Set([mention.raw_name, mention.name, ...(mention.raw_names || [])].filter(Boolean))],
      normalized_name: key,
      identity_key: key,
      official_domains: registered?.officialDomains || mention.official_domains || [],
    });
  }
  return output;
}

function targetIdentityKeys(entity = {}) {
  return [...new Set([entity.name, ...(entity.aliases || [])].filter(Boolean).map(name => identityNameKey(name)))];
}

function similarButDistinct(name, entity = {}) {
  const candidate = identityNameKey(name, { removeBranch: false });
  if (!candidate) return false;
  return targetIdentityKeys(entity).some(target => candidate !== target && target.length >= 3 && (candidate.includes(target) || target.includes(candidate)));
}

function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function similarNamesInAnswer(answer, entity = {}) {
  const found = [];
  for (const alias of [entity.name, ...(entity.aliases || [])].filter(Boolean)) {
    const core = String(alias).replace(LEGAL_FORM, '').trim();
    if (core.length < 3) continue;
    const suffixPattern = new RegExp(`${escapeRegex(core)}[^\\s、。）」』]{1,20}(?:株式会社|有限会社|合同会社)`, 'gu');
    for (const match of String(answer || '').matchAll(suffixPattern)) if (similarButDistinct(match[0], entity)) found.push(match[0]);
  }
  return [...new Set(found)];
}

function localNoiseSignals(answer) {
  const text = String(answer || '');
  const patterns = [
    /streetviewpixels|googleusercontent\.com\/grass|google\.com\/maps/iu,
    /営業時間(?:外|中)?/u,
    /電話\s*\[?経路/u,
    /(?:不動産店|不動産仲介業|請負業者)\s*(?:\n|$)/u,
    /\d(?:\.\d)?\s*\(\d+\)/u,
  ];
  return patterns.filter(pattern => pattern.test(text)).length;
}

export function assessPaidReliability({ answer, entity, mentionedEntities = [], questionKind = '', channel = '' }) {
  const warnings = [];
  const similarEntities = [...new Set([
    ...mentionedEntities.filter(item => !item.target && similarButDistinct(item.name, entity)).map(item => item.name),
    ...similarNamesInAnswer(answer, entity),
  ])];
  const explicitlySeparated = /(?:異なる会社|別会社|別の会社|同一(?:企業|法人)ではない)/u.test(String(answer || ''));
  if (questionKind === 'branded' && similarEntities.length && !explicitlySeparated) {
    warnings.push({
      code: 'similar_entity_mixture',
      severity: 'review',
      message: 'この回答には、対象企業と類似名称の別企業に関する情報が含まれている可能性があります。',
      entities: [...new Set(similarEntities)],
    });
  }
  const localSignals = channel === 'google_ai_mode' ? localNoiseSignals(answer) : 0;
  if (localSignals >= 2) {
    warnings.push({
      code: 'local_result_noise',
      severity: 'info',
      message: 'この回答には、検索結果由来の店舗・地図情報が多く含まれています。企業比較の本文と分けてご確認ください。',
      signal_count: localSignals,
    });
  }
  return {
    status: warnings.some(item => item.severity === 'review') ? 'review' : warnings.length ? 'notice' : 'clear',
    warnings,
    local_information_present: localSignals >= 2,
    raw_answer_preserved: true,
  };
}

export function enrichPaidMeasurementReliability(row, entity, registry = [], questionKind = '') {
  const mentioned = normalizePaidEntityMentions(row.mentioned_entities || [], registry);
  const targetIndex = mentioned.findIndex(item => item.target);
  return {
    ...row,
    mentioned_entities: mentioned,
    target_present: targetIndex >= 0,
    target_position: targetIndex >= 0 ? targetIndex + 1 : null,
    company_count: mentioned.length,
    reliability: assessPaidReliability({ answer: row.raw_answer, entity, mentionedEntities: mentioned, questionKind, channel: row.channel }),
  };
}

export const PAID_REPORT_RELIABILITY_NOTICE = '本診断は、各AIサービスが調査時点で生成した回答を記録したものです。AIの回答には誤りや他社情報の混同が含まれる場合があるため、MADOHAが確認できた注意点を補足表示します。';
