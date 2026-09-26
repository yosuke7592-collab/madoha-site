import {escapeHtml as e,preferredSources,renderSafeMarkdown,sourceHost as host,sourcePresentation} from './report-format.js';
import {buildReportDashboard} from './report-dashboard.js';
const channelNames={chatgpt:'ChatGPT',gemini:'Gemini',google_ai_mode:'Google AI Mode'};
const siteNames={
  'kyoudo.jp':'協同住宅 公式サイト','shinurayasu.chiba.jp':'新浦安ナビ','hot2.jp':'HOT2 浦安駅おすすめ8選',
  'e-fudou.com':'不動産ドットコム','property-bank.co.jp':'プロパティバンク','urayasu-senmon.com':'浦安専門ドットコム'
};
const sourceRecord=(data,url)=>data.sources.find(item=>item.url===url)||data.sources.find(item=>host(item.url)===host(url));
const sourceRole=(data,url)=>{
  const source=sourceRecord(data,url);
  const display=sourcePresentation(source||{url},url);
  return display.via?'Geminiが回答の根拠として参照したWeb情報':source?.role||'AI回答が参照したWeb情報';
};
function sourceItem(data,url){
  const source=sourceRecord(data,url)||{url};
  const display=sourcePresentation(source,url);
  const knownName=siteNames[display.domain]||display.name;
  const contents=`<b>${e(knownName)}</b><span>${e(sourceRole(data,url))}</span><small>${e(display.domain)}${display.via?` · ${e(display.via)}`:''}</small>`;
  return display.href?`<a href="${e(display.href)}" target="_blank" rel="noopener noreferrer">${contents}</a>`:`<div>${contents}</div>`;
}
const sourceLinks=(data,urls)=>`<ul class="reference-list">${[...new Set(urls||[])].map(url=>`<li>${sourceItem(data,url)}</li>`).join('')||'<li>取得できた参照情報はありません。</li>'}</ul>`;
const channelShort={chatgpt:'ChatGPT',gemini:'Gemini',google_ai_mode:'Google AI Mode'};

function metric(value,label,detail=''){
  return `<div class="dashboard-metric"><strong>${e(value)}</strong><span>${e(label)}</span>${detail?`<small>${e(detail)}</small>`:''}</div>`;
}
function freeOverview(data,dashboard){
  const query=data.queries[0];
  const competitors=(dashboard.competitors||[]).slice(0,5);
  return `<section class="free-overview dashboard-shell"><p class="dashboard-kicker">3つのAIで実際に調べました</p><h2>${e(query.query)}</h2><div class="free-ai-summary">${query.channels.map(row=>`<div><b>${e(channelShort[row.channel])}</b><strong class="${row.appeared?'is-visible':'is-hidden'}">${row.appeared?'○ 掲載':'× 非掲載'}</strong></div>`).join('')}</div><div class="dashboard-metrics">${metric(`${dashboard.visibility.appeared} / ${dashboard.visibility.total}`,'AI掲載状況')}${metric(competitors.length?competitors.length:'—','一緒に登場した競合')}</div>${competitors.length?`<div class="competitor-chips"><span>競合として登場</span>${competitors.map(item=>`<b>${e(item.name)}</b>`).join('')}</div>`:''}<div class="free-limit"><b>これは1つの質問だけを調べた結果です。</b><p>完全診断では、実際の顧客がAIへ尋ねる10の質問を選定し、ChatGPT・Gemini・Google AI Modeで計30回実測します。</p></div><p class="evidence-guide">各AIの実際の回答と参照元は、この下で確認できます。</p></section>`;
}
function fullDashboard(data,dashboard){
  const maxCompetitor=Math.max(1,...dashboard.competitors.map(item=>item.appearances));
  const channelMetrics=Object.entries(dashboard.byChannel).map(([channel,item])=>metric(`${item.appeared} / ${item.total}`,channelShort[channel],`${item.rate}%`)).join('');
  return `<section class="diagnosis-dashboard dashboard-shell"><header><p class="dashboard-kicker">MADOHA / AI VISIBILITY REPORT</p><h2>AI検索での、あなたの会社の見え方</h2><p>30件の実測結果から、掲載状況・推薦・競合との比較を整理しました。</p></header><div class="dashboard-metrics primary">${metric(`${dashboard.visibility.appeared} / ${dashboard.visibility.total}`,'AI掲載',`${dashboard.visibility.rate}%`)}${metric(`${dashboard.discoveryVisibility.appeared} / ${dashboard.discoveryVisibility.total}`,'会社名なしでの掲載',`会社名を指定しない質問でも、${dashboard.discoveryVisibility.total}回中${dashboard.discoveryVisibility.appeared}回候補に入りました`)}${metric(dashboard.recommendationCount,'推薦された回数')}${metric(dashboard.explicitRankCount,'1位・第一候補になった回数','AIから明確に1位／第一候補として紹介された回数')}${metric(dashboard.topCandidateCount,'上位候補','掲載位置3番目以内')}</div><section class="dashboard-section"><h3>AI別の掲載状況</h3><div class="dashboard-metrics channels">${channelMetrics}</div></section><section class="dashboard-section"><h3>質問別の掲載状況</h3><div class="heatmap-wrap"><table class="visibility-heatmap"><thead><tr><th>質問</th>${Object.values(channelShort).map(name=>`<th>${e(name)}</th>`).join('')}</tr></thead><tbody>${dashboard.heatmap.map((row,index)=>`<tr><th><small>${String(index+1).padStart(2,'0')}</small>${e(row.question)}</th>${Object.keys(channelShort).map(channel=>{const state=row.channels[channel];return `<td><span class="heat-${e(state)}">${state==='appeared'?'○ 掲載':state==='not_appeared'?'× 非掲載':'—'}</span></td>`}).join('')}</tr>`).join('')}</tbody></table></div></section><div class="dashboard-two-column"><section class="dashboard-section"><h3>AIが一緒に挙げた主な競合</h3>${dashboard.competitors.slice(0,8).map(item=>`<div class="bar-row"><div><b>${e(item.name)}</b><span>${item.appearances}回 · ${item.channels.map(channel=>channelShort[channel]).join(' / ')}</span></div><i><em style="width:${Math.max(4,item.appearances/maxCompetitor*100)}%"></em></i></div>`).join('')||'<p>競合名を確認できませんでした。</p>'}</section><section class="dashboard-section"><h3>よく参照されたドメイン</h3><ol class="source-ranking">${dashboard.sources.slice(0,8).map(item=>`<li><b>${e(item.domain)}</b><span>${item.references}回</span></li>`).join('')||'<li>参照元を取得できませんでした。</li>'}</ol></section></div><section class="dashboard-section priorities"><h3>改善優先ポイント</h3><p>実測で確認できた事実と、検討できる選択肢を分けて表示します。</p>${dashboard.priorities.map((item,index)=>`<article><small>PRIORITY ${String(index+1).padStart(2,'0')}</small><b>${e(item.fact)}</b><p>${e(item.suggestion)}</p></article>`).join('')}</section><p class="dashboard-score-note">独自の0〜100点は使用していません。「AI掲載」と「会社名なしでの掲載」という、実測で確認できる数値を表示しています。</p></section>`;
}

function displayedCompanies(data,row){
  const competitors=[...(row.competitors||[])];
  if(!row.appeared)return competitors;
  const position=Number.isInteger(row.listedPosition)?row.listedPosition:(Number.isInteger(row.rank)?row.rank:1);
  const list=[...competitors];
  list.splice(Math.max(0,Math.min(position-1,list.length)),0,data.subject.name);
  return list;
}
function listedPosition(data,row){const list=displayedCompanies(data,row);const index=list.indexOf(data.subject.name);return index<0?null:index+1;}
function listingLabel(data,row){const list=displayedCompanies(data,row),position=listedPosition(data,row);return position?`${list.length}社中${position}番目に掲載`:'掲載なし';}
function aiRankLabel(row){return Number.isInteger(row.aiRank)?`${row.aiRank}位`:'なし';}
function companyList(data,row){
  const list=displayedCompanies(data,row);
  if(!list.length)return '<p class="empty-note">企業名の一覧は取得できませんでした。</p>';
  return `<ol class="company-order">${list.map(name=>`<li class="${name===data.subject.name?'target-company':''}"><span>${e(name)}</span>${name===data.subject.name?'<b>診断対象</b>':''}</li>`).join('')}</ol>`;
}
function actualAnswer(data,row){
  return `<div class="answer-markdown">${renderSafeMarkdown(row.answer,{subject:data.subject.name})}</div>`;
}
const madohaView=row=>row.comment?`<div class="madoha-view"><h5>MADOHAの見解</h5><p>${e(row.comment)}</p></div>`:'';
const reliabilityNotice=row=>{
  const warnings=row.reliability?.warnings||[];
  if(!warnings.length)return '';
  return `<aside class="reliability-notice" aria-label="MADOHAによる注意"><b>MADOHAによる注意</b>${warnings.map(item=>`<p>${e(item.message)}</p>`).join('')}</aside>`;
};
function nonbrandResult(data,query,row){
  const list=displayedCompanies(data,row),position=listedPosition(data,row);
  const status=[['掲載',row.appeared?'あり':'なし',row.appeared?'shown':'not-shown'],['掲載位置',position?`${list.length}社中${position}番目`:'対象企業なし',''],['推薦',row.recommended?'あり':'なし',''],['AIの順位付け',Number.isInteger(row.aiRank)?`${row.aiRank}位`:'なし','']];
  return `<section class="ai-result channel-${e(row.channel)}"><header><h4><i aria-hidden="true"></i>${e(channelNames[row.channel])}</h4><div class="status-line">${status.map(([label,value,cls])=>`<span><small>${e(label)}</small><strong class="${cls}">${e(value)}</strong></span>`).join('')}</div></header>${reliabilityNotice(row)}<div class="answer-panel ${row.reliability?.local_information_present?'has-local-information':''}"><h5>AI RESPONSE <span>実際の回答${row.reliability?.local_information_present?'・店舗／地図情報を含む':''}</span></h5>${actualAnswer(data,row)}</div><div class="result-columns"><div><h5>掲載された企業 <small>表示された順番です</small></h5>${companyList(data,row)}</div><div><h5>参照された情報</h5>${sourceLinks(data,row.sources)}</div></div>${madohaView(row)}</section>`;
}
function brandedResult(data,query,row){
  return `<section class="ai-result channel-${e(row.channel)}"><header><h4><i aria-hidden="true"></i>${e(channelNames[row.channel])}</h4></header>${reliabilityNotice(row)}<div class="answer-panel ${row.reliability?.local_information_present?'has-local-information':''}"><h5>AI RESPONSE <span>実際の回答${row.reliability?.local_information_present?'・店舗／地図情報を含む':''}</span></h5>${actualAnswer(data,row)}</div><div class="result-columns branded-columns"><div><h5>強みとして書かれたこと</h5><ul>${(row.strengths||[]).map(item=>`<li>${e(item)}</li>`).join('')||'<li>明確な記載なし</li>'}</ul><h5 class="gap-label">確認できなかった情報</h5><ul>${(row.informationGaps||[]).map(item=>`<li>${e(item)}</li>`).join('')||'<li>特になし</li>'}</ul></div><div><h5>参照された情報</h5>${sourceLinks(data,row.sources)}</div></div>${madohaView(row)}</section>`;
}
function resultSummary(data,query,row){
  if(query.kind==='branded'){
    const hasWarning=(row.reliability?.warnings||[]).length>0;
    return `<span><b>${e(channelNames[row.channel])}</b>${hasWarning?'注意あり':row.answer?'回答あり':'回答なし'}</span>`;
  }
  return `<span><b>${e(channelNames[row.channel])}</b>${e(listingLabel(data,row))}${row.recommended?'・推薦あり':''}</span>`;
}
function queryBlock(data,query,index,total){
  return `<details class="query-block" ${index===0?'open':''}><summary><span class="query-number">QUESTION<br><b>${String(index+1).padStart(2,'0')} / ${e(total)}</b></span><div><em>${query.kind==='nonbrand'?'会社名を入れない検索':'会社名を入れた検索'}・${e(query.intent)}</em><h3>${e(query.query)}</h3><div class="result-summary">${query.channels.map(row=>resultSummary(data,query,row)).join('')}</div></div><b class="open-label">詳細を見る</b></summary><div class="query-detail">${query.channels.map(row=>query.kind==='nonbrand'?nonbrandResult(data,query,row):brandedResult(data,query,row)).join('')}</div></details>`;
}
export function render(data){
  const nonbrand=data.queries.filter(query=>query.kind==='nonbrand');
  const branded=data.queries.filter(query=>query.kind==='branded');
  const totalQuestions=data.queries.length;
  const channelCount=data.measurement?.channelCount||3;
  const totalResults=data.measurement?.resultCount||totalQuestions*channelCount;
  const catalogSources=preferredSources(data.sources||[]);
  const subjectArea=data.subject.area||data.subject.display_region||data.subject.region||'';
  const subjectCategory=data.subject.category||data.subject.industry||data.subject.entity_type||'';
  const dashboard=data.dashboard||buildReportDashboard(data);
  const dashboardHtml=totalQuestions===1?freeOverview(data,dashboard):fullDashboard(data,dashboard);
  document.querySelector('#report').innerHTML=`
  <section class="hero compact-hero"><p>MADOHA PAID DIAGNOSIS v1 / AI検索調査レポート</p><h1>${e(data.subject.name)}</h1><span>${e([subjectArea,subjectCategory].filter(Boolean).join(' · '))}</span><dl><dt>検索質問</dt><dd>${e(totalQuestions)}問</dd><dt>AI検索</dt><dd>${e(channelCount)}チャネル</dd><dt>検索結果</dt><dd>${e(totalResults)}件</dd><dt>測定日</dt><dd>${e(data.measurement.snapshotDate)}</dd></dl></section>
  <nav class="report-tools">${data.samplePdfUrl?`<a class="pdf-button" href="${e(data.samplePdfUrl)}" download>PDFレポートをダウンロード</a>`:''}<span>各検索結果の回答・掲載順・参照情報を収録しています。</span></nav>
  <p class="reliability-common-note">${e(data.reliabilityNotice||'本診断は各AIサービスが調査時点で生成した回答を記録したものです。AIの回答には誤りや他社情報の混同が含まれる場合があり、確認できた注意点はMADOHAが補足表示します。')}</p>
  ${dashboardHtml}
  <main class="search-report">
    ${nonbrand.length?`<header class="report-intro"><b class="section-index">${totalQuestions===1?'EVIDENCE':'09 / EVIDENCE · DISCOVERY'}</b><p>${e(nonbrand.length)} QUESTIONS / ${e(nonbrand.length*channelCount)} RESULTS</p><h2>実際のAI回答と根拠</h2><p>あなたの会社を知らない人がAIに相談したとき、候補として表示されたかを回答本文で確認します。</p></header><section class="query-list">${nonbrand.map((query,index)=>queryBlock(data,query,index,totalQuestions)).join('')}</section>`:''}
    ${branded.length?`<header class="report-intro branded-intro"><b class="section-index">10 / EVIDENCE · DIRECT SEARCH</b><p>${e(branded.length)} QUESTIONS / ${e(branded.length*channelCount)} RESULTS</p><h2>会社名を入れた検索の根拠</h2><p>あなたの会社名をAIに直接聞いたとき、どのように説明・評価されたかを確認します。</p></header><section class="query-list">${branded.map((query,index)=>queryBlock(data,query,index+nonbrand.length,totalQuestions)).join('')}</section>`:''}
    <section class="closing-section"><header><p>検索結果を確認した後の参考情報</p><h2>改善する場合の選択肢</h2></header><p>以下は、今回の検索結果と参照情報から考えられる候補です。特定の表示・推薦結果を保証するものではありません。</p><ol class="option-list">${data.actions.slice(0,3).map(action=>`<li><h3>${e(action.target)}</h3><p>${e(action.change)}</p></li>`).join('')}</ol></section>
    <section class="closing-section sources-section"><header><p>検索結果で使用した主なWeb情報</p><h2>参照情報</h2></header><div class="source-lines">${catalogSources.map(source=>{const display=sourcePresentation(source);const link=display.href?`<a href="${e(display.href)}" target="_blank" rel="noopener noreferrer">${e(display.domain)}${display.via?` · ${e(display.via)}`:''}</a>`:`<span>${e(display.domain)}</span>`;const role=display.via?'Geminiが回答の根拠として参照したWeb情報':source.role;return `<p><b>${e(siteNames[display.domain]||display.name)}</b><span>${e(role)}</span>${link}</p>`}).join('')}</div></section>
    <section class="measurement-note"><h2>測定条件・注意書き</h2><p>会社名を入れない検索${e(nonbrand.length)}問と、会社名を入れた検索${e(branded.length)}問を、ChatGPT、Gemini、Google AI Modeで各1回検索しました。合計${e(totalResults)}件の検索結果です。</p><p>${e(data.reliabilityNotice||'本診断は測定時点におけるAI検索の回答を記録したものです。確認できた注意点はMADOHAが補足表示します。')}</p><p>AIの回答は変動するため、同じ質問でも結果が異なる場合があります。また、改善施策による特定の表示・推薦結果を保証するものではありません。</p>${data.sample?`<p class="sample-caution"><b>架空企業の完成版サンプル：</b>企業・サービス・競合・回答・参照元はすべて商品表示を確認するための架空データです。実在企業の診断結果や実測API回答ではありません。</p>`:''}</section>
  </main><footer class="end"><b>MADOHA</b><p>検索結果 + 参照情報 + 必要最小限の見解</p><a href="diagnose.html">初回AI検索診断を始める（9,800円）</a></footer>`;
}
globalThis.MADOHA_RENDER_REPORT=render;
const paidParams=new URLSearchParams(location.search);
if(document.documentElement.dataset.sales==='true'){
  // The sales controller supplies an authorized report; never fall back to fixture data.
}else if(paidParams.get('diagnosis')&&paidParams.get('session_id')){
  document.querySelector('.topbar b').textContent='PAID DIAGNOSIS';document.querySelector('.topbar span').textContent='購入者向け実測レポート';
  fetch(`/api/paid-diagnosis/${encodeURIComponent(paidParams.get('diagnosis'))}`,{headers:{'x-checkout-session':paidParams.get('session_id')}})
    .then(response=>response.ok?response.json():Promise.reject()).then(payload=>payload.order?.report?render(payload.order.report):Promise.reject())
    .catch(()=>document.querySelector('#report').innerHTML='<p class="loading">診断結果を読み込めませんでした。</p>');
}else if(globalThis.MADOHA_PUBLIC_SAMPLE)render(globalThis.MADOHA_PUBLIC_SAMPLE);else if(globalThis.MADOHA_KYOUDO_SAMPLE)render(globalThis.MADOHA_KYOUDO_SAMPLE);else fetch('./data/samples/kyoudo-housing-paid-diagnosis.json').then(response=>response.ok?response.json():Promise.reject()).then(render).catch(()=>document.querySelector('#report').innerHTML='<p class="loading">サンプルを読み込めませんでした。</p>');
