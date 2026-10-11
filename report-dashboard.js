import { sourceHost } from './report-format.js';

const CHANNELS = ['chatgpt', 'gemini', 'google_ai_mode'];
const CHANNEL_LABELS = { chatgpt: 'ChatGPT', gemini: 'Gemini', google_ai_mode: 'Google AI Mode' };
const unique = values => [...new Set(values.filter(Boolean))];
const percentage = (value, total) => total ? Math.round(value / total * 1000) / 10 : 0;

export function buildReportDashboard(report) {
  const queries = report?.queries || [];
  const measurements = queries.flatMap(query => (query.channels || []).map(row => ({ ...row, query })));
  const valid = measurements.filter(row => !row.error && String(row.answer || '').trim());
  const discovery = valid.filter(row => row.query.kind === 'nonbrand');
  const branded = valid.filter(row => row.query.kind === 'branded');
  const appeared = valid.filter(row => row.appeared);
  const competitorMap = new Map();
  const sourceMap = new Map();

  for (const row of valid) {
    for (const name of unique(row.competitors || [])) {
      const item = competitorMap.get(name) || { name, appearances: 0, channels: new Set(), questions: new Set() };
      item.appearances += 1;
      item.channels.add(row.channel);
      item.questions.add(row.query.query);
      competitorMap.set(name, item);
    }
    for (const url of unique(row.sources || [])) {
      const domain = sourceHost(url);
      if (!domain) continue;
      const item = sourceMap.get(domain) || { domain, references: 0, channels: new Set() };
      item.references += 1;
      item.channels.add(row.channel);
      sourceMap.set(domain, item);
    }
  }

  const byChannel = Object.fromEntries(CHANNELS.map(channel => {
    const rows = valid.filter(row => row.channel === channel);
    const shown = rows.filter(row => row.appeared).length;
    return [channel, { appeared: shown, total: rows.length, rate: percentage(shown, rows.length) }];
  }));
  const competitors = [...competitorMap.values()]
    .map(item => ({ ...item, channels: [...item.channels], questions: [...item.questions] }))
    .sort((a, b) => b.appearances - a.appearances || a.name.localeCompare(b.name, 'ja'));
  const sources = [...sourceMap.values()]
    .map(item => ({ ...item, channels: [...item.channels] }))
    .sort((a, b) => b.references - a.references || a.domain.localeCompare(b.domain));
  const discoveryAppeared = discovery.filter(row => row.appeared).length;
  const brandedAppeared = branded.filter(row => row.appeared).length;
  const recommendationCount = valid.filter(row => row.recommended).length;
  const explicitRankCount = valid.filter(row => Number.isInteger(row.aiRank)).length;
  const topCandidateCount = valid.filter(row => Number.isInteger(row.listedPosition) && row.listedPosition <= 3).length;
  const priorities = [];
  const missingDiscovery = queries.filter(query => query.kind === 'nonbrand' && (query.channels || []).filter(row => row.appeared).length === 0);
  if (missingDiscovery.length) priorities.push({ fact: `非指名の${missingDiscovery.length}質問で、3AIすべてに掲載されませんでした。`, suggestion: '該当する利用場面について、公式サイトの説明や実績情報を確認する選択肢があります。' });
  const weakest = [...Object.entries(byChannel)].filter(([, item]) => item.total > 0).sort((a, b) => a[1].rate - b[1].rate)[0];
  if (weakest && weakest[1].total && weakest[1].appeared < weakest[1].total) priorities.push({ fact: `${CHANNEL_LABELS[weakest[0]]}での掲載は${weakest[1].appeared}/${weakest[1].total}件でした。`, suggestion: 'AIごとの差を、参照元と回答本文から確認してください。' });
  if (!sources.some(source => report?.subject?.official_url && source.domain === sourceHost(report.subject.official_url))) priorities.push({ fact: '取得できた参照元に、自社公式ドメインを確認できませんでした。', suggestion: 'AIが参照できる公式情報が十分か確認する選択肢があります。' });
  if (competitors[0] && competitors[0].appearances > appeared.length) priorities.push({ fact: `${competitors[0].name}は${competitors[0].appearances}結果に登場し、自社の掲載${appeared.length}結果を上回りました。`, suggestion: '同じ質問で参照された情報と説明内容を比較してください。' });

  return {
    measured: valid.length,
    visibility: { appeared: appeared.length, total: valid.length, rate: percentage(appeared.length, valid.length) },
    discoveryVisibility: { appeared: discoveryAppeared, total: discovery.length, rate: percentage(discoveryAppeared, discovery.length) },
    brandedVisibility: { appeared: brandedAppeared, total: branded.length, rate: percentage(brandedAppeared, branded.length) },
    recommendationCount, explicitRankCount, topCandidateCount, byChannel,
    heatmap: queries.map(query => ({ id: query.id, question: query.query, kind: query.kind, channels: Object.fromEntries(CHANNELS.map(channel => {
      const row = (query.channels || []).find(item => item.channel === channel);
      return [channel, row && !row.error && row.answer ? (row.appeared ? 'appeared' : 'not_appeared') : 'unavailable'];
    })) })),
    competitors, sources, priorities: priorities.slice(0, 4)
  };
}

export function buildDashboardSummary(report, dashboard = buildReportDashboard(report)) {
  const subject = report?.subject?.name || '診断対象';
  const parts = [`AI検索で、${subject}は${dashboard.visibility.total}回中${dashboard.visibility.appeared}回掲載されました。`];
  if (dashboard.discoveryVisibility.total) {
    parts.push(`会社名を指定しない質問では${dashboard.discoveryVisibility.total}回中${dashboard.discoveryVisibility.appeared}回、候補として確認されました。`);
  } else {
    parts.push('会社名を指定しない質問は、今回の測定対象に含まれていません。');
  }
  const measuredChannels = Object.entries(dashboard.byChannel).filter(([, item]) => item.total > 0);
  if (measuredChannels.length > 1) {
    const sorted = measuredChannels.sort((a, b) => b[1].rate - a[1].rate);
    if (sorted[0][1].rate !== sorted.at(-1)[1].rate) {
      parts.push(`掲載率は${CHANNEL_LABELS[sorted[0][0]]}が${sorted[0][1].rate}%、${CHANNEL_LABELS[sorted.at(-1)[0]]}が${sorted.at(-1)[1].rate}%で、AIごとの差が確認されました。`);
    }
  }
  if (dashboard.recommendationCount || dashboard.explicitRankCount) {
    parts.push(`推薦は${dashboard.recommendationCount}回、1位・第一候補としての明示は${dashboard.explicitRankCount}回でした。`);
  } else {
    parts.push('推薦および1位・第一候補としての明示は、今回の回答では確認されませんでした。');
  }
  if (dashboard.competitors[0]) parts.push(`対象以外では、${dashboard.competitors[0].name}が${dashboard.competitors[0].appearances}回確認されました。`);
  return parts.join(' ');
}
