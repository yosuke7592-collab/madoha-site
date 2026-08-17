const LEGAL_FORMS = /(?:株式会社|有限会社|合同会社|一般社団法人|一般財団法人|㈱|（株）|\(株\))/gu;
const PUNCTUATION = /[\s\u3000・･,，.。:：;；!！?？「」『』【】()（）\[\]［］\-‐‑–—―_]/gu;
const POSITIVE = /(おすすめ|推薦|候補|選択肢|依頼先|評価の高い会社|評判のいい)/u;
const NEGATIVE = /(おすすめしない|推薦しない|候補ではない|注意|否定)/u;

export function normalizeCompanyName(value) {
  return String(value || '').normalize('NFKC').replace(LEGAL_FORMS, '').replace(PUNCTUATION, '').toLowerCase();
}

function occurrenceCount(text, name) {
  if (!name) return 0;
  return text.split(name).length - 1;
}

export function detectRecommendation(answerText, rawName) {
  const lines = String(answerText).split(/\r?\n|。/u);
  return lines.some((line, index) => {
    if (!line.includes(rawName)) return false;
    const previous = lines.slice(0, index).reverse().find(item => item.trim()) || '';
    const context = `${previous} ${line}`;
    return POSITIVE.test(context) && !NEGATIVE.test(context);
  });
}

export function detectRelativePosition(answerText, rawName) {
  for (const line of String(answerText).split(/\r?\n/u)) {
    if (!line.includes(rawName)) continue;
    const match = line.trim().match(/^(\d+)[.)、．]\s*/u);
    if (match) return Number(match[1]);
  }
  return null;
}

export function extractCompanies(answerText, registry, citations = []) {
  const text = String(answerText || '');
  const normalizedText = normalizeCompanyName(text);
  const found = [];
  for (const company of registry) {
    const candidates = [company.canonicalName, ...(company.aliases || [])].filter(Boolean);
    const rawName = candidates.find(name => text.includes(name));
    const normalizedMatch = candidates.find(name => normalizedText.includes(normalizeCompanyName(name)));
    if (!rawName && !normalizedMatch) continue;
    const matched = rawName || normalizedMatch;
    const method = matched === company.canonicalName && text.includes(matched)
      ? 'canonical_exact'
      : text.includes(matched) ? 'registry_alias' : 'normalized_name';
    found.push({
      rawName: matched, normalizedCompanyId: company.id, appeared: true,
      recommended: detectRecommendation(text, matched), relativePosition: detectRelativePosition(text, matched),
      mentionCount: Math.max(1, occurrenceCount(text, matched)), matchMethod: method, matchConfidence: method === 'normalized_name' ? 0.9 : 1
    });
  }
  for (const company of registry) {
    if (found.some(item => item.normalizedCompanyId === company.id)) continue;
    const citationMatch = citations.some(citation => (company.officialDomains || []).some(domain => citation.domain === domain || citation.domain.endsWith(`.${domain}`)));
    if (!citationMatch) continue;
    found.push({
      rawName: company.displayName || company.canonicalName, normalizedCompanyId: company.id, appeared: true,
      recommended: false, relativePosition: null, mentionCount: 0, matchMethod: 'official_domain', matchConfidence: 0.8
    });
  }
  const knownNames = new Set(found.map(item => normalizeCompanyName(item.rawName)));
  for (const line of text.split(/\r?\n/u)) {
    const match = line.trim().match(/^\d+[.)、．]\s*([^—\-、,。]+?)(?:\s*[—\-]|$)/u);
    const rawName = match?.[1]?.trim();
    if (!rawName || rawName.length < 2 || knownNames.has(normalizeCompanyName(rawName))) continue;
    found.push({
      rawName, normalizedCompanyId: null, appeared: true, recommended: detectRecommendation(text, rawName),
      relativePosition: detectRelativePosition(text, rawName), mentionCount: Math.max(1, occurrenceCount(text, rawName)),
      matchMethod: 'rule_unknown', matchConfidence: null
    });
    knownNames.add(normalizeCompanyName(rawName));
  }
  return found;
}

export const RECOMMENDATION_RULE_VERSION = '0.1';
