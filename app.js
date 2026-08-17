import { mockResult, normalizeResultData } from './mock-data.js';

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const escapeHTML = value => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const valueOrDash = value => value === null || value === undefined || value === '' ? '—' : String(value);
const setText = (selector, value, fallback = '—') => { const element = $(selector); if (element) element.textContent = value === null || value === undefined || value === '' ? fallback : value; };
const numberOrNull = value => Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : null;

let data = normalizeResultData(mockResult);
let timers = [];
let activeCats = new Set(['models', 'queries', 'competitors', 'sources']);

const positions = {
  top: [['company', 50, 80, 'company'], ['ChatGPT', 18, 24, 'models'], ['Gemini', 76, 20, 'models'], ['Perplexity', 84, 55, 'models'], ['Queries', 20, 62, 'queries'], ['Competitors', 70, 70, 'competitors'], ['Sources', 38, 69, 'sources']],
  analysis: [['company', 50, 50, 'company'], ['models', 19, 28, 'models'], ['queries', 77, 23, 'queries'], ['competitors', 79, 70, 'competitors'], ['sources', 22, 74, 'sources']]
};

function node(label, x, y, category = 'company') {
  const element = document.createElement('span');
  element.className = `net-node ${category}`;
  element.textContent = label === 'company' ? data.subject.name : label;
  element.style.left = `${x}%`;
  element.style.top = `${y}%`;
  return element;
}

function line(stage, x1, y1, x2, y2, category = '', strength = null) {
  const element = document.createElement('i');
  const dx = x2 - x1;
  const dy = y2 - y1;
  const edgeStrength = numberOrNull(strength);
  element.className = `net-line ${category}`;
  element.style.cssText = `left:${x1}%;top:${y1}%;width:${Math.hypot(dx, dy)}%;transform:rotate(${Math.atan2(dy, dx)}rad)`;
  if (edgeStrength !== null) element.style.setProperty('--edge-strength', edgeStrength);
  stage.append(element);
}

function renderSimple(stage, type, visible = 99) {
  stage.innerHTML = '';
  positions[type].forEach((position, index) => {
    if (index) line(stage, positions[type][0][1], positions[type][0][2], position[1], position[2], position[3]);
    const element = node(...position);
    if (type === 'top' && index === 0) element.textContent = 'YOUR COMPANY';
    if (index >= visible) element.style.opacity = .08;
    stage.append(element);
  });
}

function showScreen(name) {
  $$('.screen').forEach(screen => screen.classList.toggle('is-active', screen.dataset.screen === name));
  const screen = $(`[data-screen="${name}"]`);
  screen.classList.add('screen-transition');
  window.scrollTo(0, 0);
}

function setupAnalysis() {
  const list = $('#analysis-steps');
  list.innerHTML = data.analysisStages.length
    ? data.analysisStages.map((stage, index) => `<li><b>${String(index + 1).padStart(2, '0')} — ${escapeHTML(stage.label || 'ANALYSIS')}</b><span>${escapeHTML(valueOrDash(stage.value))}</span></li>`).join('')
    : '<li><b>分析ステップはありません</b><span>未測定</span></li>';
  renderSimple($('[data-network="analysis"]'), 'analysis', 1);
}

function startAnalysis(input) {
  data = normalizeResultData(mockResult, input);
  setText('#analysis-company', input);
  setupAnalysis();
  showScreen('analyzing');
  const stages = data.analysisStages;
  if (!stages.length) {
    setText('#progress-value', null);
    timers.push(setTimeout(showResult, 300));
    return;
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduced ? 120 : 620;
  stages.forEach((stage, index) => {
    timers.push(setTimeout(() => {
      const steps = $$('#analysis-steps li');
      steps.forEach((step, stepIndex) => {
        step.classList.toggle('active', stepIndex === index);
        if (stepIndex < index) step.classList.add('done');
      });
      setText('#progress-value', Math.round((index + 1) / stages.length * 100));
      renderSimple($('[data-network="analysis"]'), 'analysis', Math.min(5, index + 1));
      if (index === stages.length - 1) timers.push(setTimeout(showResult, reduced ? 80 : 600));
    }, index * duration));
  });
}

function showResult() {
  timers.forEach(clearTimeout);
  timers = [];
  renderResult();
  showScreen('result');
}

function renderControls() {
  const labels = { models: 'AI MODELS', queries: 'QUERIES', competitors: 'COMPETITORS', sources: 'SOURCES' };
  const colors = { models: 'var(--cyan)', queries: 'var(--acid)', competitors: 'var(--orange)', sources: 'var(--blue)' };
  activeCats = new Set(Object.keys(labels));
  $('#map-controls').innerHTML = Object.keys(labels).map(category => `<button data-cat="${category}" aria-pressed="true"><i style="background:${colors[category]}"></i>${labels[category]}</button>`).join('');
  $$('#map-controls button').forEach(button => {
    button.onclick = () => {
      const category = button.dataset.cat;
      activeCats.has(category) ? activeCats.delete(category) : activeCats.add(category);
      button.setAttribute('aria-pressed', activeCats.has(category));
      updateMapFilters();
    };
  });
}

function renderGraph() {
  const map = $('#result-map');
  map.innerHTML = '';
  const mobile = innerWidth < 700;
  const all = data.derived.graph.nodes;
  const limits = { models: 3, queries: 2, competitors: 2, sources: 2 };
  const seen = {};
  const offsets = mobile ? { c2: [5, 0] } : { q5: [0, -4] };
  const visible = mobile ? all.filter(item => (seen[item.category] = (seen[item.category] || 0) + 1) <= limits[item.category]) : all;
  const groups = mobile
    ? { models: { start: -145, end: -75, r: 32 }, queries: { start: -35, end: 15, r: 35 }, competitors: { start: 35, end: 85, r: 34 }, sources: { start: 115, end: 165, r: 35 } }
    : { models: { start: -155, end: -65, r: 36 }, queries: { start: -55, end: 35, r: 40 }, competitors: { start: 45, end: 135, r: 38 }, sources: { start: 145, end: 235, r: 41 } };
  const grouped = {};
  visible.forEach(item => (grouped[item.category] ??= []).push(item));
  Object.entries(grouped).forEach(([category, items]) => items.forEach((item, index) => {
    const group = groups[category];
    if (!group) return;
    const angle = (group.start + (items.length === 1 ? 45 : index / (items.length - 1) * (group.end - group.start))) * Math.PI / 180;
    const [dx, dy] = offsets[item.id] || [0, 0];
    const x = 50 + Math.cos(angle) * group.r + dx;
    const y = 50 + Math.sin(angle) * group.r + dy;
    line(map, 50, 50, x, y, category, item.strength);
    const element = node(item.short || item.label || item.name, x, y, category);
    element.dataset.cat = category;
    const strength = numberOrNull(item.strength);
    if (strength !== null) element.style.setProperty('--node-strength', strength);
    element.title = item.name;
    map.append(element);
  }));
  map.append(node('company', 50, 50, 'company'));
  map.setAttribute('aria-label', `${data.subject.name}を中心とするAI検索関係図`);
  updateMapFilters();
}

function updateMapFilters() {
  $$('#result-map [class*="net-"]').forEach(element => {
    const category = ['models', 'queries', 'competitors', 'sources'].find(value => element.classList.contains(value));
    if (category) element.classList.toggle('hidden', !activeCats.has(category));
  });
}

function renderDatasetStatus() {
  const status = data.dataset.status;
  const labels = { demo: 'DEMO', partial: 'PARTIAL DATA', measured: 'MEASURED' };
  const measurementLabels = { demo: 'DEMO MEASUREMENT · NOT PROVIDER SCORES', partial: 'PARTIAL DATA · UNMEASURED FIELDS SHOWN AS —', measured: 'MEASURED DATA' };
  const notes = {
    demo: 'この結果はMVP用のサンプルデータです。実在のAI回答・企業評価を示すものではありません。',
    partial: '一部の項目は未測定です。未測定値は「—」で表示しています。',
    measured: data.dataset.measuredAt ? `実測データ · ${data.dataset.measuredAt}` : '実測データ'
  };
  const badge = $('#result-dataset-status');
  badge.hidden = false;
  badge.textContent = labels[status] || labels.partial;
  setText('#measurement-label', measurementLabels[status], measurementLabels.partial);
  setText('#dataset-note', notes[status], notes.partial);
}

function renderSummary() {
  const scores = data.derived.scores;
  const insights = data.derived.insights;
  const visibility = numberOrNull(scores.visibility);
  const stability = numberOrNull(scores.stability);
  const coverage = scores.modelCoverage;
  const recommendation = scores.recommendation;
  setText('#result-company', data.subject.name);
  setText('#result-market', data.market.label, '市場未設定');
  setText('#visibility-score', visibility);
  setText('#visibility-description', insights.visibilityDescription, '未測定');
  setText('#visibility-band', scores.visibilityBand, visibility === null ? 'NOT MEASURED' : '—');
  $('#visibility-ring').style.setProperty('--score', `${visibility === null ? 0 : Math.min(100, Math.max(0, visibility))}%`);
  setText('#coverage-detected', coverage.detected);
  setText('#coverage-total', coverage.total);
  setText('#coverage-detail', coverage.detected === null || coverage.total === null ? '未測定' : `${coverage.total}モデル中${coverage.detected}モデルで認識`);
  setText('#recommendation-detected', recommendation.detected);
  setText('#recommendation-total', recommendation.total);
  setText('#recommendation-detail', recommendation.detected === null || recommendation.total === null ? '未測定' : '推薦が確認された質問');
  setText('#stability-score', stability);
  setText('#stability-unit', stability === null ? '' : '%', '');
  setText('#stability-detail', stability === null ? '未測定' : '複数回答での再現性');
  setText('#observation-title', insights.observation.title, '未測定');
  setText('#observation-body', insights.observation.body, '分析結果はありません。');
}

function renderModels() {
  const container = $('#model-bars');
  const models = data.derived.models;
  container.innerHTML = models.length ? models.map(item => {
    const value = numberOrNull(item.value);
    return `<div class="model-row"><span>${escapeHTML(item.name)}</span><i style="--value:${value === null ? 0 : Math.min(100, Math.max(0, value))}%"></i><b>${escapeHTML(valueOrDash(value))}</b></div>`;
  }).join('') : '<p>モデル測定データはありません。</p>';
  setText('#model-note', data.derived.insights.modelNote, '未測定');
}

function renderQueries() {
  const recommendation = data.derived.scores.recommendation;
  setText('#query-recommendation-count', recommendation.detected);
  setText('#query-total-count', recommendation.total);
  const examples = ['strong', 'weak'].map(status => data.derived.queries.find(query => query.status === status)).filter(Boolean);
  $('#query-examples').innerHTML = examples.length
    ? examples.map(query => `<div class="query-example ${escapeHTML(query.status)}"><b>${query.status === 'strong' ? 'STRONG' : 'WEAK'}</b><span>${escapeHTML(query.name)}</span></div>`).join('')
    : '<p>該当するクエリは未測定です。</p>';
}

function renderCompetitorGap() {
  const gap = data.derived.insights.competitorGap;
  const hasSummary = gap.prefix || gap.highlight || gap.suffix;
  $('#competitor-gap-summary').innerHTML = hasSummary
    ? `${escapeHTML(gap.prefix)}${gap.highlight ? `<strong>${escapeHTML(gap.highlight)}</strong>` : ''}${escapeHTML(gap.suffix)}`
    : '未測定';
  setText('#competitor-gap-detail', gap.detail, '分析結果はありません。');
  setText('#competitor-note', data.derived.insights.competitorNote, '未測定');
}

function renderInformationIssues() {
  const issues = data.derived.informationIssues;
  setText('#issue-count', `${issues.length} ${issues.length === 1 ? 'issue' : 'issues'} detected`);
  $('#issue-list').innerHTML = issues.length ? issues.map(issue => `
    <div class="issue-entry">
      <p>${escapeHTML(issue.summary || `${issue.field}を確認してください`)}</p>
      <div class="compare"><span>${escapeHTML(issue.official.label)}</span><b>${escapeHTML(valueOrDash(issue.official.value))}</b><em>MATCH</em></div>
      <div class="compare warn"><span>${escapeHTML(issue.observed.label)}</span><b>${escapeHTML(valueOrDash(issue.observed.value))}</b><em>CHECK</em></div>
    </div>`).join('') : '<p>確認された問題はありません</p>';
  setText('#accuracy-note', issues.length ? data.derived.insights.accuracySummary : '確認された問題はありません。', issues.length ? '詳細を確認してください。' : '確認された問題はありません。');
}

function renderSources() {
  const sources = data.derived.sources;
  const knownCounts = sources.map(item => numberOrNull(item.count)).filter(value => value !== null);
  const maxCount = Math.max(...knownCounts, 1);
  $('#source-list').innerHTML = sources.length ? sources.map(item => {
    const count = numberOrNull(item.count);
    const width = count === null ? 0 : count / maxCount * 100;
    return `<div class="source-row"><span>${escapeHTML(item.name)}<br><small>${escapeHTML(item.label)}</small></span><i style="--value:${width}%"></i><b>${escapeHTML(valueOrDash(count))}</b></div>`;
  }).join('') : '<p>確認された参照元はありません。</p>';
  setText('#sources-note', sources.length ? data.derived.insights.sourcesNote : '未測定', sources.length ? '参照元の説明はありません。' : '未測定');
}

function renderResult() {
  renderDatasetStatus();
  renderSummary();
  renderControls();
  renderGraph();
  renderModels();
  renderQueries();
  renderCompetitorGap();
  renderInformationIssues();
  renderSources();
}

$('#search-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('#company-input');
  const value = input.value.trim();
  if (!value) {
    setText('#search-error', '会社名・店舗名・URLを入力してください。', '');
    input.focus();
    return;
  }
  setText('#search-error', '', '');
  startAnalysis(value);
});
$('#company-input').addEventListener('input', () => setText('#search-error', '', ''));
$('#example-fill').onclick = () => { $('#company-input').value = '世田谷ホーム'; $('#company-input').focus(); };
$('#skip-analysis').onclick = showResult;
$('#new-search').onclick = () => { timers.forEach(clearTimeout); timers = []; showScreen('top'); $('#company-input').focus(); };
addEventListener('resize', () => { if ($('[data-screen="result"]').classList.contains('is-active')) renderGraph(); });

renderSimple($('[data-network="top"]'), 'top');
setupAnalysis();
