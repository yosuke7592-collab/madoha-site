import { classifySource } from './source.mjs';
import { normalizeCompanyName } from './extraction.mjs';
import { assessPaidReliability, normalizePaidEntityMentions, PAID_REPORT_RELIABILITY_NOTICE } from './reliability.mjs';

export const PAID_CHANNELS = Object.freeze(['chatgpt', 'gemini', 'google_ai_mode']);
export const LIVE_LOCK_MESSAGE = 'Live measurement is disabled. Set MADOHA_ENABLE_LIVE_MEASUREMENT=true explicitly.';
export const COST_CAP_CODE = 'cost_cap_exceeded';

const nowIso = () => new Date().toISOString();
const round = value => Math.round(value * 1_000_000) / 1_000_000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function assertPaidInput(input) {
  for (const key of ['diagnosis_id', 'question_id', 'question_text', 'channel', 'run_id']) {
    if (!String(input?.[key] || '').trim()) throw new TypeError(`${key} is required.`);
  }
  if (!input.entity?.name) throw new TypeError('entity.name is required.');
  if (!PAID_CHANNELS.includes(input.channel)) throw new TypeError(`Unsupported channel: ${input.channel}`);
  if (!Number.isFinite(input.max_cost) || input.max_cost < 0) throw new TypeError('max_cost must be a non-negative number.');
  return input;
}

export function validatePaidMeasurement(row) {
  for (const key of ['diagnosis_id', 'question_id', 'question_text', 'channel', 'run_id', 'raw_answer', 'measured_at']) {
    if (typeof row?.[key] !== 'string') throw new TypeError(`PaidMeasurement.${key} must be a string.`);
  }
  if (row.schema_version !== 'paid-measurement-v1') throw new TypeError('PaidMeasurement.schema_version is invalid.');
  if (!PAID_CHANNELS.includes(row.channel)) throw new TypeError('PaidMeasurement.channel is invalid.');
  for (const key of ['sources', 'citations', 'mentioned_entities', 'source_signals']) if (!Array.isArray(row[key])) throw new TypeError(`PaidMeasurement.${key} must be an array.`);
  if (!Number.isFinite(row.estimated_cost) || row.estimated_cost < 0) throw new TypeError('PaidMeasurement.estimated_cost is invalid.');
  return row;
}

export function sourceObjects(items = [], registry = []) {
  const unique = new Map();
  for (const item of items) {
    if (!item?.url || unique.has(item.url)) continue;
    const classified = classifySource(item.url, registry);
    unique.set(item.url, {
      url: item.url, title: item.title || '', domain: classified.domain,
      source_type: classified.sourceType, citation_text: item.citation_text || '',
      evidence: item.evidence || 'source'
    });
  }
  return [...unique.values()];
}

const GENERIC_COMPANY_LABEL = /(?:【|】|候補|地域|地元|おすすめ|相談|タイプ|まとめ|結論|選び方|コツ|比較|確認|強み|特徴|評判|口コミ|事業内容|パターン|資金計画|予算|エリア|ステップ|判断|質問|書類|メモ|ネットワーク|自由設計|今回|主な|大手|総合|代表的|会社概要|基本情報|条件|方法|選択肢|安全性|災害リスク|周辺環境|将来費用|ライフプラン|金融機関|お金のプロ|専門店|部門|購入スタイル|希望する場合|提案してくれるか|借りられる額|向いている|理由|料金プラン|専門性|申告実績|ワンストップ|税務調査率|料金体系|クレジット|注意点|デメリット|メリット|仕様|制限|把握|など|第[一二三四五六七八九十0-9]+候補|^不動産$|^不動産会社$|^社名$|^会社(?:名|情報|概要|一覧|リスト)?$|^注文住宅$)/u;
const SENTENCE_COMPANY_LABEL = /(?:前提|回答|指す|したい場合|を(?:語る|選ぶ|利用|検討|紹介)|→|⇒|➔|➡)/u;

function plausibleCompanyName(value) {
  const name = String(value || '').replace(/[*_`]/g, '').trim();
  if (!name || name.startsWith('#') || SENTENCE_COMPANY_LABEL.test(name) || GENERIC_COMPANY_LABEL.test(name)) return false;
  if (/^(?:特徴|向いている|おすすめ理由|判断理由|メリット|デメリット|所在地|店舗|強み|今回|この地域)/u.test(name)) return false;
  return /[A-Za-z\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(name);
}

function companyLikeStructuredName(value) {
  const name = String(value || '').replace(/[*_`]/g, '').trim();
  if (/(?:株式会社|有限会社|合同会社|税理士法人|弁護士法人|司法書士法人|行政書士法人|社会保険労務士法人|医療法人|学校法人|一般社団法人|一般財団法人|特定非営利活動法人|㈱|（株）|\(株\))/u.test(name)) return true;
  if (/^[A-Za-z][A-Za-z0-9 .’'&-]{1,30}$/u.test(name)) return true;
  return /(?:不動産|住宅|地所|商事|工務店|ハウジング|販売|ハウス|ホーム|リビング|リフォーム|リノベ|建設|グループ|SHOP|Life|Re|デザイン|スマイル|パートナー|ミニミニ|エイブル|アパマンショップ|タウンハウジング|レイエス)(?:\s+[^\s]{1,12}店)?$/iu.test(name);
}

function isExplicitTargetRecommendation(answer, targetName) {
  const escaped = String(targetName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return false;
  const text = String(answer || '').replace(/\r?\n/g, ' ');
  const positive = '(?:おすすめ(?:です|します)?|お勧め(?:です|します)?|推奨(?:です|します)?|第一候補|第1候補|有力候補|最も適(?:して|した))';
  const negative = '(?:おすすめしない|推奨しない|第一候補ではない|有力候補ではない)';
  // A recommendation must explicitly select the target as a company/service.  General
  // next-step advice such as "問い合わせをおすすめします" must not count.
  const targetThenPositive = new RegExp(`(?:${escaped})(?:は|が|を|なら|の)?[^。！？]{0,48}${positive}`, 'u');
  const positiveThenTarget = new RegExp(`${positive}[^。！？]{0,24}(?:は|が|として|に)?[^。！？]{0,12}${escaped}`, 'u');
  const targetMatch = text.match(targetThenPositive);
  const genericAction = /(?:問い合わせ|公式サイト|確認(?:する|を)?|見積(?:もり)?|契約条件)/u;
  return (Boolean(targetMatch) && !genericAction.test(targetMatch[0]) || positiveThenTarget.test(text)) && !new RegExp(negative, 'u').test(text);
}

export function derivePaidEntities(answer, entity, registry = []) {
  const text = String(answer || '');
  const candidates = [...registry];
  if (!candidates.some(item => normalizeCompanyName(item.canonicalName || item.name) === normalizeCompanyName(entity.name))) {
    candidates.push({ id: entity.id || 'target', canonicalName: entity.name, displayName: entity.name, aliases: entity.aliases || [] });
  }
  const mentions = [];
  const isKnownName = value => {
    const normalized = normalizeCompanyName(value);
    return candidates.some(company => [company.canonicalName, company.displayName, company.name, ...(company.aliases || [])]
      .filter(Boolean).some(name => normalizeCompanyName(name) === normalized));
  };
  const addMention = (name, index) => {
    const raw=String(name||''),alternatives=raw.split(/\s*または\s*/u).filter(Boolean);
    if(alternatives.length>1){for(const alternative of alternatives)addMention(alternative,index+raw.indexOf(alternative));return}
    if (/^\s*[-+]\s/u.test(String(name || ''))) return;
    const cleaned = String(name || '').replace(/[*_`]/g, '').replace(/^[\[（(]|[\]）)]$/g, '').replace(/^\d+[.)、．]\s*/u, '').replace(/^■\s*/u, '').replace(/^[→⇒➔➡]+\s*/u,'').split(/[｜|：:（(]/u)[0].trim()
      .replace(/^((?:株式会社|有限会社|合同会社|一般社団法人|一般財団法人)[^、。\n]{1,30}?)(?:は|が)(?=[^\s]).*$/u, '$1')
      .replace(/^スーモカウンター/u, 'SUUMOカウンター');
    if (!plausibleCompanyName(cleaned) || cleaned.length < 2 || cleaned.length > 40) return;
    const normalized = normalizeCompanyName(cleaned);
    const existing = mentions.find(item => {
      const known = normalizeCompanyName(item.name);
      if (known === normalized) return true;
      const longer = known.length >= normalized.length ? known : normalized;
      return (known.startsWith(normalized) || normalized.startsWith(known)) && /(?:店|支店|営業所|センター|ショップ)$/u.test(longer);
    });
    if (existing) {
      if (cleaned.length > existing.name.length) { existing.name = cleaned; existing.raw_name = cleaned; }
      existing.first_index = Math.min(existing.first_index, index); return;
    }
    mentions.push({ entity_id: null, name: cleaned, raw_name: cleaned, first_index: index, target: normalizeCompanyName(cleaned) === normalizeCompanyName(entity.name) });
  };
  for (const company of candidates) {
    const names = [...new Set([company.canonicalName, company.displayName, company.name, ...(company.aliases || [])].filter(Boolean))];
    const hits = names.map(name => ({ name, index: text.indexOf(name) })).filter(hit => hit.index >= 0).sort((a, b) => a.index - b.index);
    if (!hits.length) continue;
    mentions.push({
      entity_id: company.id || null, name: company.displayName || company.canonicalName || company.name,
      raw_name: hits[0].name, first_index: hits[0].index, target: normalizeCompanyName(company.canonicalName || company.name) === normalizeCompanyName(entity.name)
    });
  }
  for (const match of text.matchAll(/(?:^|\n)\s*#{1,6}\s*(?:第[一二三四五六七八九十0-9]+候補|候補|性能[^：:\n]{0,20})\s*[：:]\s*([^\n]+)/gu)) {
    addMention(match[1], match.index + match[0].indexOf(match[1]));
  }
  for (const match of text.matchAll(/(?:^|\n)\s*#{2,6}\s*(?:(?:\d+[.)、．]\s*)|(?:■\s*))([^\n｜|]{2,60})(?=\r?\n|[｜|]|$)/gu)) {
    const candidate = match[1].split(/[（(]/u)[0].trim();
    if (companyLikeStructuredName(candidate) || isKnownName(candidate)) addMention(match[1], match.index + match[0].indexOf(match[1]));
  }
  for (const match of text.matchAll(/(?:^|\n)\s*\|\s*\*{2}([^*|]+)\*{2}\s*\|/gu)) {
    const candidate = match[1].split(/[（(]/u)[0].trim();
    if (companyLikeStructuredName(candidate) || isKnownName(candidate)) addMention(match[1], match.index + match[0].indexOf(match[1]));
  }
  const lines = text.split(/\r?\n/u); let lineOffset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*[*+-]\s*\*{2}([^*]+)\*{2}\s*$/u);
    if (match && /^\s*[*+-]\s*\*{2}特徴[：:]?\*{2}/u.test(lines[index + 1] || '')) {
      for (const name of match[1].split(/\s*[／/]\s*/u)) addMention(name.replace(/など$/u, ''), lineOffset + lines[index].indexOf(match[1]));
    }
    const describedBullet = lines[index].match(/^\s*[*+-]\s*\*{2}([^*]+)\*{2}\s*[：:]/u);
    if (describedBullet && companyLikeStructuredName(describedBullet[1].split(/[（(]/u)[0])) addMention(describedBullet[1], lineOffset + lines[index].indexOf(describedBullet[1]));
    const localResult = lines[index].match(/^\s*([^\n]{2,60}?)(?:\s+\d(?:\.\d)?\s*\(\d+\))?\s*$/u);
    const nextLine = (lines[index + 1] || '').trim();
    if (localResult && /^(?:不動産|住宅|建築|工務店|リフォーム|ハウスメーカー)/u.test(nextLine)) {
      addMention(localResult[1].replace(/\s+(?:不動産業|不動産店|不動産仲介業者?|不動産管理会社|請負業者)$/u, ''), lineOffset + lines[index].indexOf(localResult[1]));
    }
    if (localResult && /(?:株式会社|有限会社|合同会社)/u.test(localResult[1])) {
      addMention(localResult[1].replace(/\s+(?:不動産業|不動産店|不動産仲介業者?|不動産管理会社|請負業者)$/u, ''), lineOffset + lines[index].indexOf(localResult[1]));
    }
    lineOffset += lines[index].length + 1;
  }
  for (const match of text.matchAll(/(?:^|\n)\s*\d+[.)、．]\s*([^—\-、,。\n]+?)(?:\s*[—\-]|$)/gu)) {
    const candidate = match[1].split(/[（(]/u)[0].trim();
    if (companyLikeStructuredName(candidate) || isKnownName(candidate)) addMention(match[1], match.index + match[0].indexOf(match[1]));
  }
  for (const match of text.matchAll(/(?:詳細は\s+)([^\n]{2,50}?)(?:\s+から確認|\s+をチェック)/gu)) {
    addMention(match[1], match.index + match[0].indexOf(match[1]));
  }
  for (const match of text.matchAll(/(?:^|\n)([^\n]{2,40}?)(?:\s+\d(?:\.\d)?\s*\(\d+\))?\s*(?:特徴\s*[：:]|不動産コンサルタント)/gu)) {
    const name = match[1].replace(/^\d+[.)、．]\s*/u, '').trim();
    if (!/^(この地域|土地探し|地域密着型|市川・浦安エリア|千葉県北西部|詳細は)/u.test(name)) addMention(name, match.index + match[0].indexOf(match[1]));
  }
  mentions.sort((a, b) => a.first_index - b.first_index);
  const targetIndex = mentions.findIndex(item => item.target);
  const targetName = mentions[targetIndex]?.raw_name || entity.name;
  const recommendation = targetIndex >= 0 && isExplicitTargetRecommendation(text, targetName);
  const explicitMatches = [...text.matchAll(/(?:^|\n)\s*(\d+)[.)、．]\s*([^\n]+)/gu)];
  const explicit = explicitMatches.find(match => match[2].includes(targetName));
  const normalizedMentions = normalizePaidEntityMentions(mentions.map(({ first_index, ...item }) => item), candidates);
  const normalizedTargetIndex = normalizedMentions.findIndex(item => item.target);
  return {
    mentioned_entities: normalizedMentions, target_present: normalizedTargetIndex >= 0,
    target_position: normalizedTargetIndex >= 0 ? normalizedTargetIndex + 1 : null, company_count: normalizedMentions.length,
    recommendation, explicit_rank: explicit ? Number(explicit[1]) : null
  };
}

export function commonMeasurement(input, normalized, registry = []) {
  assertPaidInput(input);
  const sources = sourceObjects(normalized.sources, registry);
  const entities = derivePaidEntities(normalized.raw_answer, input.entity, registry);
  const reliability = assessPaidReliability({ answer: normalized.raw_answer, entity: input.entity, mentionedEntities: entities.mentioned_entities, questionKind: input.question_kind || '', channel: input.channel });
  return validatePaidMeasurement({
    schema_version: 'paid-measurement-v1', diagnosis_id: input.diagnosis_id, entity: input.entity,
    question_id: input.question_id, question_text: input.question_text,
    question_order: input.question_order ?? null, channel_order: PAID_CHANNELS.indexOf(input.channel) + 1,
    selection_reason: input.selection_reason || '', intent: input.intent || '', source_signals: input.source_signals || [],
    channel: input.channel, locale: input.locale || 'ja-JP', location: input.location || '', run_id: input.run_id,
    raw_answer: normalized.raw_answer || '', sources, citations: sources.filter(item => item.evidence === 'citation'),
    ...entities, reliability, usage: normalized.usage || {}, estimated_cost: round(normalized.estimated_cost || 0),
    raw_response_ref: normalized.raw_response_ref || null, error: normalized.error || null,
    measured_at: normalized.measured_at || nowIso(), provider_metadata: normalized.provider_metadata || {}
  });
}

export function measurementsToPaidReport(baseReport, measurements) {
  const rows = new Map(measurements.map(row => [`${row.question_id}|${row.channel}`, row]));
  return {
    ...structuredClone(baseReport), reliabilityNotice: PAID_REPORT_RELIABILITY_NOTICE,
    queries: baseReport.queries.map(query => ({
      ...query,
      channels: PAID_CHANNELS.map(channel => {
        const row = rows.get(`${query.id}|${channel}`);
        if (!row) return { channel, answer: '', appeared: false, recommended: false, listedPosition: null, aiRank: null, competitors: [], sources: [], error: { code: 'not_measured' } };
        return {
          channel, answer: row.raw_answer, appeared: row.target_present, recommended: row.recommendation,
          listedPosition: row.target_position, aiRank: row.explicit_rank,
          competitors: row.mentioned_entities.filter(item => !item.target).map(item => item.name),
          sources: row.sources.map(item => item.url), strengths: row.provider_metadata?.strengths || [],
          informationGaps: row.provider_metadata?.information_gaps || [], accuracy: row.provider_metadata?.accuracy || '要確認',
          measuredAt: row.measured_at || null,
          provenance: {
            model: row.provider_metadata?.model || null,
            retrievalMode: row.provider_metadata?.retrieval_mode || null,
            diagnosisRegion: row.location || null,
            apiLocationName: row.provider_metadata?.api_location_name || null,
            apiLocationCode: row.provider_metadata?.api_location_code || null,
            languageCode: row.provider_metadata?.language_code || null,
            locale: row.locale || null
          },
          reliability: row.reliability || { status: 'clear', warnings: [], local_information_present: false, raw_answer_preserved: true },
          error: row.error
        };
      })
    }))
  };
}

export function liveEnabled(env) { return env?.MADOHA_ENABLE_LIVE_MEASUREMENT === 'true'; }

export class PaidAdapter {
  constructor({ channel, registry = [], fetchImpl, now = nowIso, sleepImpl = sleep, randomImpl = Math.random }) {
    this.channel = channel; this.registry = registry;
    this.fetchImpl = fetchImpl || ((...args) => globalThis.fetch(...args));
    this.now = now; this.sleep = sleepImpl; this.random = randomImpl;
  }
  assertLive(env) { if (!liveEnabled(env)) throw new Error(LIVE_LOCK_MESSAGE); }
  estimateCost() { throw new Error('estimateCost must be implemented.'); }
  reserveCost(input) { return this.estimateCost(input); }
  async execute() { throw new Error('execute must be implemented.'); }
  normalize(input, raw) { return commonMeasurement(input, raw, this.registry); }
}

export class FixturePaidAdapter extends PaidAdapter {
  constructor({ channel, registry = [], fixtures }) { super({ channel, registry }); this.fixtures = fixtures; this.calls = 0; }
  estimateCost() { return 0; }
  async execute(input) {
    this.calls += 1;
    const value = structuredClone(this.fixtures(input));
    if (value.throw) { const error = new Error(value.throw.message); Object.assign(error, value.throw); throw error; }
    return this.normalize(input, { ...value, estimated_cost: 0, measured_at: value.measured_at || this.now() });
  }
}

export async function executeWithRetry(adapter, input, env, { retries = 2, baseDelayMs = 5_000, maxDelayMs = 30_000, onAttemptStart = null, onAttemptSuccess = null, onAttemptFailure = null } = {}) {
  let attempt = 0;
  while (true) {
    let reservation = null;
    try {
      reservation = onAttemptStart ? await onAttemptStart(attempt + 1) : null;
      const result = await adapter.execute(input, env);
      if (onAttemptSuccess) await onAttemptSuccess(reservation, result);
      result.usage = { ...result.usage, attempts: attempt + 1 };
      return result;
    } catch (error) {
      if (reservation && onAttemptFailure) await onAttemptFailure(reservation, error);
      attempt += 1;
      if (!error.retryable || attempt > retries) {
        if (error.retryable && attempt > retries) { error.retry_exhausted = true; error.fatal = true; }
        throw error;
      }
      const exponential = Math.min(maxDelayMs, baseDelayMs * (3 ** (attempt - 1)));
      const delayMs = Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : Math.round(exponential * (1 + adapter.random() * .25));
      await adapter.sleep(delayMs);
    }
  }
}

export class MemoryMeasurementStore {
  constructor(seed = []) { this.rows = new Map(seed.map(row => [`${row.diagnosis_id}|${row.question_id}|${row.channel}`, row])); }
  async get(diagnosisId, questionId, channel) { return this.rows.get(`${diagnosisId}|${questionId}|${channel}`) || null; }
  async save(row) { this.rows.set(`${row.diagnosis_id}|${row.question_id}|${row.channel}`, structuredClone(row)); }
  async list(diagnosisId) { return [...this.rows.values()].filter(row => row.diagnosis_id === diagnosisId); }
}

export class D1MeasurementStore {
  constructor(db) { this.db = db; }
  async get(diagnosisId, questionId, channel) {
    const row = await this.db.prepare('SELECT measurement_json FROM paid_measurements WHERE diagnosis_id=? AND question_id=? AND channel=?').bind(diagnosisId, questionId, channel).first();
    return row?.measurement_json ? JSON.parse(row.measurement_json) : null;
  }
  async save(row) {
    const state = row.error ? 'failed' : row.provider_metadata?.pending ? 'submitted' : !row.raw_answer?.trim() ? 'failed' : 'complete';
    await this.db.prepare(`INSERT INTO paid_measurements (diagnosis_id,question_id,channel,question_order,channel_order,run_id,status,estimated_cost_usd,measurement_json,measured_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now')) ON CONFLICT(diagnosis_id,question_id,channel) DO UPDATE SET
      question_order=excluded.question_order,channel_order=excluded.channel_order,run_id=excluded.run_id,status=excluded.status,estimated_cost_usd=excluded.estimated_cost_usd,measurement_json=excluded.measurement_json,measured_at=excluded.measured_at,updated_at=datetime('now')`)
      .bind(row.diagnosis_id, row.question_id, row.channel, row.question_order, row.channel_order, row.run_id, state, row.estimated_cost, JSON.stringify(row), row.measured_at).run();
  }
  async list(diagnosisId) {
    const result = await this.db.prepare('SELECT measurement_json FROM paid_measurements WHERE diagnosis_id=? ORDER BY question_order, channel_order').bind(diagnosisId).all();
    return (result.results || []).map(row => JSON.parse(row.measurement_json));
  }
  async budgetUsed(diagnosisId) {
    const row = await this.db.prepare(`SELECT
      COALESCE((SELECT SUM(reserved_cost_usd) FROM diagnosis_measurement_attempts WHERE diagnosis_id=?),0)+
      COALESCE((SELECT SUM(m.estimated_cost_usd) FROM paid_measurements m WHERE m.diagnosis_id=?
        AND NOT EXISTS (SELECT 1 FROM diagnosis_measurement_attempts a WHERE a.diagnosis_id=m.diagnosis_id AND a.question_id=m.question_id AND a.channel=m.channel)),0) AS total`)
      .bind(diagnosisId, diagnosisId).first();
    return round(Number(row?.total || 0));
  }
  async reserveAttempt({ diagnosisId, questionId, channel, estimate, cap, phase: requestedPhase = 'request' }) {
    const phase = requestedPhase === 'poll' ? 'poll' : 'request';
    const maximum = phase === 'poll' ? 5 : 3;
    const id = crypto.randomUUID();
    // One INSERT both checks the durable budget and creates the reservation.
    // D1 serializes this write, so overlapping consumers cannot both spend the
    // same remaining cap.
    const insert = await this.db.prepare(`INSERT INTO diagnosis_measurement_attempts
      (id,diagnosis_id,question_id,channel,attempt_phase,attempt_number,reserved_cost_usd,status)
      SELECT ?,?,?,?,?,COALESCE(MAX(a.attempt_number),0)+1,?,'reserved'
      FROM diagnosis_measurement_attempts a
      WHERE a.diagnosis_id=? AND a.question_id=? AND a.channel=? AND a.attempt_phase=?
      HAVING COUNT(*)<? AND (
        COALESCE((SELECT SUM(reserved_cost_usd) FROM diagnosis_measurement_attempts WHERE diagnosis_id=?),0)+
        COALESCE((SELECT SUM(m.estimated_cost_usd) FROM paid_measurements m WHERE m.diagnosis_id=?
          AND NOT EXISTS (SELECT 1 FROM diagnosis_measurement_attempts x WHERE x.diagnosis_id=m.diagnosis_id AND x.question_id=m.question_id AND x.channel=m.channel)),0)+?
      )<=?`)
      .bind(id, diagnosisId, questionId, channel, phase, estimate, diagnosisId, questionId, channel, phase, maximum, diagnosisId, diagnosisId, estimate, cap).run();
    if (Number(insert.meta?.changes || 0) !== 1) return null;
    return { id, estimate, phase };
  }
  async finalizeAttempt(reservation, result = null, error = null) {
    if (!reservation?.id) return;
    // DataForSEO task polling does not submit another paid task. The task POST
    // remains the sole billable reservation; a pending GET always settles at 0.
    const actual = result ? (reservation.phase === 'poll' ? 0 : Number(result.estimated_cost || 0)) : null;
    await this.db.prepare(`UPDATE diagnosis_measurement_attempts SET
      status=?,actual_cost_usd=?,reserved_cost_usd=CASE WHEN ? IS NULL THEN reserved_cost_usd WHEN ?>reserved_cost_usd THEN ? ELSE ? END,
      error_code=?,finalized_at=datetime('now') WHERE id=? AND status='reserved'`)
      .bind(result ? 'completed' : 'failed', actual, actual, actual, actual, actual, error?.code || null, reservation.id).run();
  }
}

export async function runPaidMeasurements({ diagnosis, questions, adapters, store, env = {}, maxCost, maxMeasurements = Infinity, onSaved = null }) {
  const cap = Number(maxCost ?? env.MADOHA_PAID_DIAGNOSIS_MAX_COST_USD ?? 1);
  if (!Number.isFinite(cap) || cap < 0) throw new TypeError('Invalid diagnosis cost cap.');
  let total = typeof store.budgetUsed === 'function' ? await store.budgetUsed(diagnosis.id) : (await store.list(diagnosis.id)).reduce((sum, row) => sum + (row.estimated_cost || 0), 0);
  const completed = []; let stopped = null; let processed = 0; let yielded = false;
  measurementLoop: for (const [questionIndex, question] of questions.entries()) for (const channel of PAID_CHANNELS) {
    const existing = await store.get(diagnosis.id, question.id, channel);
    if (existing && !existing.error && !existing.provider_metadata?.pending && existing.raw_answer?.trim()) { completed.push(existing); continue; }
    if (processed >= maxMeasurements) { yielded = true; break measurementLoop; }
    const adapter = adapters[channel];
    if (!adapter) throw new Error(`Missing adapter: ${channel}`);
    const input = {
      diagnosis_id: diagnosis.id, entity: diagnosis.entity, question_id: question.id, question_text: question.query || question.text,
      question_order: question.order || questionIndex + 1,
      selection_reason: question.selection_reason || question.selectionReason, intent: question.intent,
      source_signals: question.source_signals || question.sourceSignals || [], question_kind: question.kind, channel,
      locale: diagnosis.locale || 'ja-JP', location: diagnosis.location || '', max_cost: cap - total, run_id: diagnosis.run_id,
      existing_measurement: existing || null
    };
    const pending = Boolean(existing?.provider_metadata?.pending);
    const reserve = Number((typeof adapter.reserveCost === 'function' ? adapter.reserveCost(input) : adapter.estimateCost(input)) || 0);
    if (total + reserve > cap) { stopped = { code: COST_CAP_CODE, next: { question_id: question.id, channel }, total_estimated_cost: round(total), cap }; break measurementLoop; }
    try {
      const estimate = reserve;
      const localReservations = [];
      const measurement = await executeWithRetry(adapter, input, env, {
        onAttemptStart: async () => {
          if (typeof store.reserveAttempt === 'function') {
            const reservation = await store.reserveAttempt({ diagnosisId: diagnosis.id, questionId: question.id, channel, estimate, cap, phase: pending ? 'poll' : 'request' });
            if (!reservation) { const error = new Error(pending ? 'DataForSEOの応答待ち上限に達したため処理を停止しました。' : '診断の費用上限または試行上限に達したため処理を停止しました。'); error.code = pending ? 'pending_poll_limit_exceeded' : COST_CAP_CODE; error.fatal = true; throw error; }
            return reservation;
          }
          if (total + estimate > cap) { const error = new Error('診断の費用上限に達したため処理を停止しました。'); error.code = COST_CAP_CODE; error.fatal = true; throw error; }
          const reservation = { estimate }; localReservations.push(reservation); total = round(total + estimate); return reservation;
        },
        onAttemptSuccess: async (reservation, value) => { if (typeof store.finalizeAttempt === 'function') await store.finalizeAttempt(reservation, value); },
        onAttemptFailure: async (reservation, error) => { if (typeof store.finalizeAttempt === 'function') await store.finalizeAttempt(reservation, null, error); }
      });
      await store.save(measurement); completed.push(measurement);
      total = typeof store.budgetUsed === 'function' ? await store.budgetUsed(diagnosis.id) : total;
      processed += 1;
      if (onSaved) await onSaved(measurement);
      if (total > cap) { stopped = { code: COST_CAP_CODE, next: { question_id: question.id, channel }, total_estimated_cost: round(total), cap }; break measurementLoop; }
    } catch (error) {
      if (error.code === COST_CAP_CODE) { stopped = { code: COST_CAP_CODE, next: { question_id: question.id, channel }, total_estimated_cost: typeof store.budgetUsed === 'function' ? await store.budgetUsed(diagnosis.id) : total, cap }; break measurementLoop; }
      const failed = commonMeasurement(input, { raw_answer: '', sources: [], estimated_cost: 0,
        error: { code: error.code || 'provider_error', message: error.message, retryable: Boolean(error.retryable) },
        provider_metadata: { ...(error.providerMetadata || {}), retry_after_ms: error.retryAfterMs ?? null, retry_exhausted: Boolean(error.retry_exhausted) }
      }, adapter.registry);
      await store.save(failed); completed.push(failed);
      processed += 1;
      if (onSaved) await onSaved(failed);
      if (error.fatal) { stopped = { code: error.code || 'fatal_provider_error', next: { question_id: question.id, channel }, total_estimated_cost: total, cap }; break measurementLoop; }
    }
  }
  const stored = await store.list(diagnosis.id);
  const completeCount = stored.filter(row => !row.error && !row.provider_metadata?.pending && row.raw_answer?.trim()).length;
  const addCosts = (result, row, key) => ({ ...result, [row[key]]: round((result[row[key]] || 0) + row.estimated_cost) });
  total = typeof store.budgetUsed === 'function' ? await store.budgetUsed(diagnosis.id) : total;
  const cost_by_channel = stored.reduce((result, row) => addCosts(result, row, 'channel'), {});
  const cost_by_question = stored.reduce((result, row) => addCosts(result, row, 'question_id'), {});
  return { diagnosis_id: diagnosis.id, status: stopped ? 'stopped' : completeCount === questions.length * 3 ? 'complete' : 'partial', measurements: stored, cost_by_channel, cost_by_question, total_estimated_cost: round(total), processed, yielded, stopped };
}
