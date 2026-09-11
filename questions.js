const params = new URLSearchParams(location.search);
const diagnosis = params.get('diagnosis');
const session = params.get('session_id');
const headers = { 'x-checkout-session': session, 'content-type': 'application/json' };
let review;
let questions = [];
let warnings = [];
let pendingAcknowledgements = [];

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function classify() {
  const nonbrand = questions.filter(question => question.kind === 'nonbrand').length;
  $('#nonbrand-count').textContent = `${nonbrand}問`;
  $('#branded-count').textContent = `${10 - nonbrand}問`;
}

function collect() {
  questions = [...document.querySelectorAll('.question')].map((card, index) => ({ ...questions[index], question_text: card.querySelector('textarea').value.trim(), kind: card.querySelector('select').value }));
  return questions;
}

function showWarnings(items = []) {
  warnings = items;
  document.querySelectorAll('.question').forEach(card => { card.querySelector('.warnings').innerHTML = ''; });
  items.forEach(warning => {
    const index = questions.findIndex(question => question.id === warning.question_id);
    if (index < 0) return;
    const box = document.querySelectorAll('.question')[index].querySelector('.warnings');
    box.innerHTML += `<p>${escapeHtml(warning.message)}</p>`;
    if (!warning.action) return;
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'warning-action';
    action.textContent = warning.action === 'branded' ? '指名検索に変更' : '候補検索に変更';
    action.onclick = () => {
      document.querySelectorAll('.question')[index].querySelector('select').value = warning.action;
      pendingAcknowledgements = [];
      collect(); classify(); showWarnings([]);
    };
    box.append(action);
  });
  const general = items.filter(warning => !warning.question_id);
  $('#page-notice').hidden = !general.length;
  $('#page-notice').innerHTML = general.map(warning => `<p>${escapeHtml(warning.message)}</p>`).join('');
}

function render() {
  const container = $('#questions'); container.innerHTML = '';
  questions.forEach((question, index) => {
    const card = $('#question-template').content.firstElementChild.cloneNode(true);
    card.dataset.id = question.id;
    card.querySelector('header span').textContent = `QUESTION ${String(index + 1).padStart(2, '0')} / 10`;
    card.querySelector('select').value = question.kind;
    card.querySelector('textarea').value = question.question_text;
    card.querySelector('[data-field=reason]').textContent = question.selection_reason;
    card.querySelector('[data-field=purpose]').textContent = question.measurement_purpose;
    const alternatives = card.querySelector('.alternatives');
    const choices = alternatives.querySelector('div');
    (question.alternatives || []).forEach(text => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `→ ${text}`;
      button.onclick = () => { card.querySelector('textarea').value = text; pendingAcknowledgements = []; alternatives.hidden = true; };
      choices.append(button);
    });
    card.querySelector('.replace').hidden = !question.alternatives?.length;
    card.querySelector('.replace').onclick = () => { alternatives.hidden = !alternatives.hidden; };
    card.querySelector('select').onchange = () => { pendingAcknowledgements = []; collect(); classify(); };
    card.querySelector('textarea').oninput = () => { pendingAcknowledgements = []; };
    container.append(card);
  });
  classify(); showWarnings(review.warnings); $('#confirm').disabled = review.locked;
  if (review.locked) {
    $('#confirm').textContent = 'この10問は確定済みです';
    document.querySelectorAll('textarea,select,.replace').forEach(element => { element.disabled = true; });
  }
}

async function api(path, options = {}) {
  const response = await fetch(`/api/paid-diagnosis/${diagnosis}/questions${path}`, { ...options, headers });
  const payload = await response.json();
  if (!response.ok && response.status !== 422) throw new Error(payload.error || '処理できませんでした。');
  return payload;
}

async function load() {
  if (!diagnosis || !session) throw new Error('診断情報を確認できません。');
  const payload = await api(''); review = payload.review; questions = review.questions;
  $('#mix-reason').textContent = review.mix_reason; render();
}

$('#confirm').onclick = async () => {
  const button = $('#confirm'); button.disabled = true; button.textContent = '質問を確認しています…';
  try {
    if (!pendingAcknowledgements.length) {
      const saved = await api('', { method: 'PUT', body: JSON.stringify({ questions: collect() }) });
      if (!saved.ok) { showWarnings(saved.result?.warnings); throw new Error(saved.result?.errors?.[0]?.message || '質問を確認してください。'); }
      showWarnings(saved.result.warnings);
      if (saved.result.warnings.length) {
        pendingAcknowledgements = saved.result.warnings.map(warning => warning.code);
        button.disabled = false; button.textContent = '注意点を確認して、このまま使用する'; return;
      }
    }
    const confirmed = await api('/confirm', { method: 'POST', body: JSON.stringify({ acknowledged_warning_codes: pendingAcknowledgements }) });
    if (!confirmed.ok) throw new Error('未確認の注意点があります。');
    const start = await fetch(`/api/paid-diagnosis/${diagnosis}/start`, { method: 'POST', headers });
    if (!start.ok) throw new Error((await start.json()).error || '診断を開始できませんでした。');
    location.assign(`index.html?diagnosis=${encodeURIComponent(diagnosis)}&session_id=${encodeURIComponent(session)}`);
  } catch (error) {
    $('#page-notice').hidden = false; $('#page-notice').textContent = error.message; pendingAcknowledgements = [];
    button.disabled = false; button.textContent = 'この10問でAI検索診断を開始する';
  }
};

load().catch(error => { $('#questions').innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`; });
