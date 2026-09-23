import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportDashboard } from '../report-dashboard.mjs';

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
