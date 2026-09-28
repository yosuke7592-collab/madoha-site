import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const load = name => readFile(new URL(`../../${name}`, import.meta.url), 'utf8');

test('TOP uses the lightweight AI observatory design and keeps the sales contract', async () => {
  const [html, css] = await Promise.all([load('index.html'), load('top-v3.css')]);
  assert.match(html, /ai-observation-visual/);
  assert.match(html, /ChatGPT/);
  assert.match(html, /Gemini/);
  assert.match(html, /Google AI Mode/);
  assert.match(html, /10[\s\S]*3[\s\S]*30/);
  assert.match(html, /9,800円/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(`${html}\n${css}`, /three\.js|webgl|<canvas|<video/i);
});

test('paid dashboard exposes executive summary, provider comparison, matrix and Evidence navigation', async () => {
  const [script, css] = await Promise.all([load('sample-kyoudo.js'), load('observatory-ui.css')]);
  assert.match(script, /AI SEARCH OBSERVATORY/);
  assert.match(script, /dashboard-summary/);
  assert.match(script, /10質問 × 3AI/);
  assert.match(script, /dashboard-matrix/);
  assert.match(script, /href="#evidence-/);
  assert.match(script, /改善候補/);
  assert.match(css, /@media\(max-width:430px\)/);
});
