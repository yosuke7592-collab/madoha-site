import test from 'node:test';
import assert from 'node:assert/strict';
import {preferredSources,renderSafeMarkdown,safeHttpUrl,sourcePresentation} from '../../report-format.js';

test('safe Markdown renders headings, bold, lists, links, Japanese, and alphanumeric text',()=>{
  const html=renderSafeMarkdown('# 結論\n\n## 比較\n\n#### 詳細\n\n**株式会社協同住宅**を確認。MADOHA v1 / AI-30。\n\n1. 第一候補\n2. 第二候補\n\n[公式サイト](https://www.kyoudo.jp/) [[1]](https://example.com/evidence)',{subject:'株式会社協同住宅'});
  assert.match(html,/answer-heading-1/);
  assert.match(html,/answer-heading-2/);
  assert.match(html,/answer-heading-4/);
  assert.match(html,/<strong><strong class="subject-highlight">株式会社協同住宅<\/strong><\/strong>/);
  assert.match(html,/<ol class="answer-list"><li>第一候補<\/li><li>第二候補<\/li><\/ol>/);
  assert.match(html,/href="https:\/\/www\.kyoudo\.jp\/"/);
  assert.match(html,/href="https:\/\/example\.com\/evidence"[^>]*>\[1\]<\/a>/);
  assert.match(html,/MADOHA v1 \/ AI-30/);
});

test('safe Markdown escapes raw HTML and rejects executable URL schemes',()=>{
  const attack='# 安全確認\n<script>alert(1)</script>\n<iframe src="https://evil.example"></iframe>\n<img src=x onerror="alert(1)">\n[危険](javascript:alert(1))\n<a href="https://example.com" onclick="alert(1)">raw</a>';
  const html=renderSafeMarkdown(attack);
  assert.doesNotMatch(html,/<(?:script|iframe|img)\b|<a[^>]+(?:href="javascript:|onclick=)/i);
  assert.match(html,/&lt;script&gt;/);
  assert.match(html,/&lt;iframe/);
  assert.match(html,/&lt;img/);
  assert.equal(safeHttpUrl('javascript:alert(1)'),null);
  assert.equal(safeHttpUrl('data:text/html,hello'),null);
});

test('safe Markdown keeps long free and full report answers readable through the same renderer',()=>{
  const long=`### 回答\n${'日本語とEnglish123の長文です。'.repeat(180)}\n\n- 無料結果\n- 完全版結果`;
  const free=renderSafeMarkdown(long,{subject:'架空企業'});
  const full=renderSafeMarkdown(long,{subject:'架空企業'});
  assert.equal(free,full);
  assert.match(full,/日本語とEnglish123/);
  assert.match(full,/<ul class="answer-list">/);
  assert.ok(full.length>3000);
});

test('Gemini redirect sources use saved final-domain evidence without inventing a final URL',()=>{
  const redirect='https://vertexaisearch.cloud.google.com/grounding-api-redirect/saved-token';
  const display=sourcePresentation({name:'kyoudo.jp',url:redirect});
  assert.equal(display.name,'kyoudo.jp');
  assert.equal(display.domain,'kyoudo.jp');
  assert.equal(display.via,'Google経由の参照リンク');
  assert.equal(display.href,redirect);
  assert.notEqual(display.href,'https://kyoudo.jp/');

  const preferred=preferredSources([
    {name:'kyoudo.jp',url:redirect},
    {name:'協同住宅 公式サイト',url:'https://www.kyoudo.jp/company/'}
  ]);
  assert.equal(preferred.length,1);
  assert.equal(preferred[0].url,'https://www.kyoudo.jp/company/');
});

test('source links accept only HTTP(S) destinations',()=>{
  assert.equal(sourcePresentation({name:'危険',url:'javascript:alert(1)'}).href,null);
  assert.equal(sourcePresentation({name:'安全',url:'https://example.com/page'}).href,'https://example.com/page');
});
