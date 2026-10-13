import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardSummary, buildReportDashboard } from '../report-dashboard.mjs';

const channel = (name, appeared, extras = {}) => ({
  channel: name, answer: '回答', appeared, recommended: false, listedPosition: appeared ? 2 : null,
  aiRank: null, competitors: ['競合A'], sources: ['https://example.com/page'], ...extras
});

const report = {
  subject: { name: '対象社', official_url: 'https://target.example/' },
  queries: [
    { id: 'q1', query: '候補は？', kind: 'nonbrand', channels: [channel('chatgpt', true, { recommended: true }), channel('gemini', false), channel('google_ai_mode', true)] },
    { id: 'q2', query: '対象社とは？', kind: 'branded', channels: [channel('chatgpt', true, { aiRank: 1 }), channel('gemini', true), channel('google_ai_mode', true)] }
  ]
};

test('dashboard uses measurement facts for visibility and discovery visibility', () => {
  const result = buildReportDashboard(report);
  assert.deepEqual(result.visibility, { appeared: 5, total: 6, rate: 83.3 });
  assert.deepEqual(result.discoveryVisibility, { appeared: 2, total: 3, rate: 66.7 });
  assert.deepEqual(result.brandedVisibility, { appeared: 3, total: 3, rate: 100 });
  assert.equal(result.byChannel.chatgpt.appeared, 2);
  assert.equal(result.recommendationCount, 1);
  assert.equal(result.explicitRankCount, 1);
});

test('first mention position is not counted as an explicit first-place result', () => {
  const copy=structuredClone(report);
  copy.queries[1].channels[0]={...copy.queries[1].channels[0],aiRank:null,listedPosition:1};
  const result=buildReportDashboard(copy);
  assert.equal(result.explicitRankCount,0);
  assert.equal(result.topCandidateCount,5);
});

test('dashboard creates accessible heatmap, normalized competitor and source facts', () => {
  const result = buildReportDashboard(report);
  assert.equal(result.heatmap[0].channels.gemini, 'not_appeared');
  assert.equal(result.competitors[0].name, '競合A');
  assert.equal(result.competitors[0].appearances, 6);
  assert.equal(result.sources[0].domain, 'example.com');
  assert.equal(result.sources[0].references, 6);
  assert.ok(result.priorities.every(item => item.fact && item.suggestion));
});

test('failed and empty measurements never inflate dashboard totals', () => {
  const copy = structuredClone(report);
  copy.queries[0].channels[0] = { ...copy.queries[0].channels[0], answer: '', error: { code: 'failed' } };
  const result = buildReportDashboard(copy);
  assert.equal(result.measured, 5);
  assert.equal(result.visibility.total, 5);
  assert.equal(result.heatmap[0].channels.chatgpt, 'unavailable');
});

const extremeReport = ({ kinds = Array(10).fill('nonbrand'), appeared = () => false, sources = () => [], competitors = () => [] } = {}) => ({
  subject: { name: '極端ケース株式会社', official_url: 'https://extreme.example/' },
  queries: kinds.map((kind, questionIndex) => ({
    id: `q${questionIndex + 1}`, query: `極端ケースの質問${questionIndex + 1}`, kind,
    channels: ['chatgpt', 'gemini', 'google_ai_mode'].map((name, channelIndex) => channel(name, appeared(questionIndex, channelIndex), {
      competitors: competitors(questionIndex, channelIndex), sources: sources(questionIndex, channelIndex)
    }))
  }))
});

test('dashboard supports zero visibility, empty competitors and empty references without fixed denominators', () => {
  const result = buildReportDashboard(extremeReport());
  assert.deepEqual(result.visibility, { appeared: 0, total: 30, rate: 0 });
  assert.deepEqual(result.discoveryVisibility, { appeared: 0, total: 30, rate: 0 });
  assert.deepEqual(result.brandedVisibility, { appeared: 0, total: 0, rate: 0 });
  assert.equal(result.recommendationCount, 0);
  assert.equal(result.explicitRankCount, 0);
  assert.deepEqual(result.competitors, []);
  assert.deepEqual(result.sources, []);
  assert.match(buildDashboardSummary(extremeReport(), result), /推薦および1位・第一候補.*確認されませんでした/);
});

test('dashboard supports complete visibility and does not invent confirmation candidates', () => {
  const strong = extremeReport({
    kinds: [...Array(4).fill('nonbrand'), ...Array(6).fill('branded')],
    appeared: () => true,
    sources: () => ['https://extreme.example/facts']
  });
  const result = buildReportDashboard(strong);
  assert.deepEqual(result.visibility, { appeared: 30, total: 30, rate: 100 });
  assert.deepEqual(result.discoveryVisibility, { appeared: 12, total: 12, rate: 100 });
  assert.deepEqual(result.brandedVisibility, { appeared: 18, total: 18, rate: 100 });
  assert.deepEqual(result.priorities, []);
});

test('dashboard handles no nonbrand questions and large provider differences naturally', () => {
  const brandedOnly = extremeReport({ kinds: Array(10).fill('branded'), appeared: (_, channelIndex) => channelIndex === 0 });
  const result = buildReportDashboard(brandedOnly);
  assert.equal(result.discoveryVisibility.total, 0);
  assert.equal(result.brandedVisibility.total, 30);
  assert.deepEqual(result.byChannel.chatgpt, { appeared: 10, total: 10, rate: 100 });
  assert.deepEqual(result.byChannel.gemini, { appeared: 0, total: 10, rate: 0 });
  assert.match(buildDashboardSummary(brandedOnly, result), /今回の測定対象に含まれていません/);
  assert.match(buildDashboardSummary(brandedOnly, result), /AIごとの差/);
});

test('question-kind ratios remain variable rather than assuming fifteen nonbrand measurements', () => {
  for (const nonbrandQuestions of [0, 1, 4, 6, 10]) {
    const report = extremeReport({ kinds: [...Array(nonbrandQuestions).fill('nonbrand'), ...Array(10 - nonbrandQuestions).fill('branded')] });
    const result = buildReportDashboard(report);
    assert.equal(result.discoveryVisibility.total, nonbrandQuestions * 3);
    assert.equal(result.brandedVisibility.total, (10 - nonbrandQuestions) * 3);
  }
});
