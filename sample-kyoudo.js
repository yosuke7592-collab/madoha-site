const e=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);
const channelNames={chatgpt:'ChatGPT',gemini:'Gemini',google_ai_mode:'Google AI Mode'};
const siteNames={
  'kyoudo.jp':'協同住宅 公式サイト','shinurayasu.chiba.jp':'新浦安ナビ','hot2.jp':'HOT2 浦安駅おすすめ8選',
  'e-fudou.com':'不動産ドットコム','property-bank.co.jp':'プロパティバンク','urayasu-senmon.com':'浦安専門ドットコム'
};
const host=url=>{try{return new URL(url).hostname.replace(/^www\./,'')}catch{return String(url)}};
const sourceName=url=>siteNames[host(url)]||host(url);
const sourceRole=(data,url)=>data.sources.find(item=>host(item.url)===host(url))?.role||'AI回答が参照したWeb情報';
const sourceLinks=(data,urls)=>`<ul class="reference-list">${[...new Set(urls||[])].map(url=>`<li><a href="${e(url)}" target="_blank" rel="noopener"><b>${e(sourceName(url))}</b><span>${e(sourceRole(data,url))}</span><small>${e(host(url))}</small></a></li>`).join('')||'<li>取得できた参照情報はありません。</li>'}</ul>`;

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
function highlightSubject(text,subject){return e(text).split(e(subject)).join(`<strong class="subject-highlight">${e(subject)}</strong>`)}
function actualAnswer(data,row){
  const sentences=String(row.answer||'').match(/[^。]+。?/g)||[];
  return sentences.map(sentence=>`<p>${highlightSubject(sentence,data.subject.name)}</p>`).join('');
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
  if(query.kind==='branded')return `<span><b>${e(channelNames[row.channel])}</b>${e(row.accuracy)}</span>`;
  return `<span><b>${e(channelNames[row.channel])}</b>${e(listingLabel(data,row))}${row.recommended?'・推薦あり':''}</span>`;
}
function queryBlock(data,query,index){
  return `<details class="query-block" ${index===0?'open':''}><summary><span class="query-number">QUESTION<br><b>${String(index+1).padStart(2,'0')} / 10</b></span><div><em>${query.kind==='nonbrand'?'会社名を入れない検索':'会社名を入れた検索'}・${e(query.intent)}</em><h3>${e(query.query)}</h3><div class="result-summary">${query.channels.map(row=>resultSummary(data,query,row)).join('')}</div></div><b class="open-label">詳細を見る</b></summary><div class="query-detail">${query.channels.map(row=>query.kind==='nonbrand'?nonbrandResult(data,query,row):brandedResult(data,query,row)).join('')}</div></details>`;
}
function render(data){
  const nonbrand=data.queries.filter(query=>query.kind==='nonbrand');
  const branded=data.queries.filter(query=>query.kind==='branded');
  document.querySelector('#report').innerHTML=`
  <section class="hero compact-hero"><p>MADOHA PAID DIAGNOSIS v1 / AI検索調査レポート</p><h1>${e(data.subject.name)}</h1><span>${e(data.subject.area)} · ${e(data.subject.category)}</span><dl><dt>検索質問</dt><dd>10問</dd><dt>AI検索</dt><dd>3チャネル</dd><dt>検索結果</dt><dd>30件</dd><dt>測定日</dt><dd>${e(data.measurement.snapshotDate)}</dd></dl></section>
  <nav class="report-tools">${data.sample?'<a class="pdf-button" href="output/pdf/madoha-kyoudo-paid-diagnosis-v1.pdf" download>PDFレポートをダウンロード</a>':''}<span>各検索結果の回答・掲載順・参照情報を収録しています。</span></nav>
  <p class="reliability-common-note">${e(data.reliabilityNotice||'本診断は各AIサービスが調査時点で生成した回答を記録したものです。AIの回答には誤りや他社情報の混同が含まれる場合があり、確認できた注意点はMADOHAが補足表示します。')}</p>
  <main class="search-report">
    <header class="report-intro"><b class="section-index">01 / DISCOVERY</b><p>6 QUESTIONS / 18 RESULTS</p><h2>会社名を入れない検索</h2><p>あなたの会社を知らない人がAIに相談したとき、候補として表示されるかを確認します。</p></header>
    <section class="query-list">${nonbrand.map((query,index)=>queryBlock(data,query,index)).join('')}</section>
    <header class="report-intro branded-intro"><b class="section-index">02 / DIRECT SEARCH</b><p>4 QUESTIONS / 12 RESULTS</p><h2>会社名を入れた検索</h2><p>あなたの会社名をAIに直接聞いたとき、どのように説明・評価されるかを確認します。</p></header>
    <section class="query-list">${branded.map((query,index)=>queryBlock(data,query,index+6)).join('')}</section>
    <section class="closing-section"><header><p>検索結果を確認した後の参考情報</p><h2>改善する場合の選択肢</h2></header><p>以下は、今回の検索結果と参照情報から考えられる候補です。特定の表示・推薦結果を保証するものではありません。</p><ol class="option-list">${data.actions.slice(0,3).map(action=>`<li><h3>${e(action.target)}</h3><p>${e(action.change)}</p></li>`).join('')}</ol></section>
    <section class="closing-section sources-section"><header><p>検索結果で使用した主なWeb情報</p><h2>参照情報</h2></header><div class="source-lines">${data.sources.map(source=>`<p><b>${e(source.name)}</b><span>${e(source.role)}</span><a href="${e(source.url)}" target="_blank" rel="noopener">${e(host(source.url))}</a></p>`).join('')}</div></section>
    <section class="measurement-note"><h2>測定条件・注意書き</h2><p>非指名6問と指名4問を、ChatGPT、Gemini、Google AI Modeで各1回検索しました。合計30件の検索結果です。</p><p>${e(data.reliabilityNotice||'本診断は測定時点におけるAI検索の回答を記録したものです。確認できた注意点はMADOHAが補足表示します。')}</p><p>AIの回答は変動するため、同じ質問でも結果が異なる場合があります。また、改善施策による特定の表示・推薦結果を保証するものではありません。</p>${data.sample?'<p class="sample-caution"><b>商品確認用サンプル：</b>この画面の30件は表示確認用の仮データです。株式会社協同住宅の実測値ではありません。</p>':''}</section>
  </main><footer class="end"><b>MADOHA</b><p>検索結果 + 参照情報 + 必要最小限の見解</p><a href="index.html">無料チェックへ戻る</a></footer>`;
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
}else if(globalThis.MADOHA_KYOUDO_SAMPLE)render(globalThis.MADOHA_KYOUDO_SAMPLE);else fetch('./data/samples/kyoudo-housing-paid-diagnosis.json').then(response=>response.ok?response.json():Promise.reject()).then(render).catch(()=>document.querySelector('#report').innerHTML='<p class="loading">サンプルを読み込めませんでした。</p>');
