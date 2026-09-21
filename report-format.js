const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => HTML_ENTITIES[character]);
}

export function safeHttpUrl(value) {
  const candidate = String(value ?? '').trim();
  if (!/^https?:\/\//i.test(candidate)) return null;
  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

export function sourceHost(value) {
  const safeUrl = safeHttpUrl(value);
  if (!safeUrl) return String(value ?? '');
  return new URL(safeUrl).hostname.replace(/^www\./, '');
}

function highlightSubject(text, subject) {
  const escaped = escapeHtml(text);
  const escapedSubject = escapeHtml(subject);
  if (!escapedSubject) return escaped;
  return escaped.split(escapedSubject).join(`<strong class="subject-highlight">${escapedSubject}</strong>`);
}

function renderInline(value, subject = '') {
  const source = String(value ?? '');
  const tokenPattern = /\[\[([^\]\n]+)\]\]\(([^)\s]+)\)|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*/g;
  let rendered = '';
  let cursor = 0;

  for (const match of source.matchAll(tokenPattern)) {
    rendered += highlightSubject(source.slice(cursor, match.index), subject);
    if (match[1] !== undefined || match[3] !== undefined) {
      const citationStyle = match[1] !== undefined;
      const href = safeHttpUrl(citationStyle ? match[2] : match[4]);
      const rawLabel = citationStyle ? `[${match[1]}]` : match[3];
      const label = highlightSubject(rawLabel, subject);
      rendered += href
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
        : label;
    } else {
      rendered += `<strong>${highlightSubject(match[5], subject)}</strong>`;
    }
    cursor = match.index + match[0].length;
  }

  rendered += highlightSubject(source.slice(cursor), subject);
  return rendered;
}

export function renderSafeMarkdown(value, { subject = '' } = {}) {
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let paragraph = [];
  let listType = null;
  let listItems = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${paragraph.map(line => renderInline(line, subject)).join('<br>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listType) return;
    output.push(`<${listType} class="answer-list">${listItems.map(item => `<li>${renderInline(item, subject)}</li>`).join('')}</${listType}>`);
    listType = null;
    listItems = [];
  };

  for (const line of lines) {
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    const bullet = line.match(/^\s*[-+*]\s+(.+)$/);

    if (heading) {
      flushParagraph();
      flushList();
      output.push(`<h6 class="answer-heading answer-heading-${heading[1].length}">${renderInline(heading[2], subject)}</h6>`);
    } else if (numbered || bullet) {
      flushParagraph();
      const nextType = numbered ? 'ol' : 'ul';
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push((numbered || bullet)[1]);
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  }

  flushParagraph();
  flushList();
  return output.join('') || '<p>回答本文を取得できませんでした。</p>';
}

function looksLikeDomain(value) {
  return /^(?:www\.)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(String(value ?? '').trim());
}

export function sourcePresentation(source = {}, fallbackUrl = '') {
  const rawUrl = source.url || fallbackUrl;
  const href = safeHttpUrl(rawUrl);
  const linkDomain = sourceHost(rawUrl);
  const recordedName = String(source.name || source.title || '').trim();
  const recordedDomain = looksLikeDomain(recordedName) ? recordedName.replace(/^www\./i, '') : '';
  const isGoogleRedirect = linkDomain === 'vertexaisearch.cloud.google.com';
  const domain = recordedDomain || linkDomain || '参照先不明';
  const name = recordedName || domain;

  return {
    href,
    name,
    domain,
    via: isGoogleRedirect && recordedName
      ? 'Google経由の参照リンク'
      : ''
  };
}

export function preferredSources(sources = []) {
  const selected = new Map();
  for (const source of sources) {
    const display = sourcePresentation(source);
    const key = display.via && display.domain === 'vertexaisearch.cloud.google.com'
      ? `${display.domain}|${display.name}`
      : display.domain;
    const current = selected.get(key);
    if (!current || (sourcePresentation(current).via && !display.via)) {
      selected.set(key, source);
    }
  }
  return [...selected.values()];
}
