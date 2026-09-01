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
function actualAnswer(data,row){
  const sentences=String(row.answer||'').match(/[^。]+。?/g)||[];
  return sentences.map(sentence=>sentence.includes(data.subject.name)?`<mark>${e(sentence)}</mark>`:`<p>${e(sentence)}</p>`).join('');
}
const madohaView=row=>row.comment?`<div class="madoha-view"><h5>MADOHAの見解</h5><p>${e(row.comment)}</p></div>`:'';
function nonbrandResult(data,query,row){
  const list=displayedCompanies(data,row),position=listedPosition(data,row);
  return `<section class="ai-result"><header><h4>${e(channelNames[row.channel])}</h4><div class="status-line"><strong class="${row.appeared?'shown':'not-shown'}">${row.appeared?'掲載あり':'掲載なし'}</strong><span>${position?`${list.length}社中${position}番目に掲載`:`今回掲載された企業 ${list.length}社`}</span><span>${row.recommended?'推薦あり':'推薦なし'}</span><span>AIによる推薦順位：${aiRankLabel(row)}</span></div></header><div class="answer-panel"><h5>実際のAI回答</h5>${actualAnswer(data,row)}</div><div class="result-columns"><div><h5>掲載された企業</h5>${companyList(data,row)}</div><div><h5>参照された情報</h5>${sourceLinks(data,row.sources)}</div></div>${madohaView(row)}</section>`;
}
function brandedResult(data,query,row){
  return `<section class="ai-result"><header><h4>${e(channelNames[row.channel])}</h4></header><div class="answer-panel"><h5>実際のAI回答</h5>${actualAnswer(data,row)}</div><div class="result-columns branded-columns"><div><h5>強みとして書かれたこと</h5><ul>${(row.strengths||[]).map(item=>`<li>${e(item)}</li>`).join('')||'<li>明確な記載なし</li>'}</ul><h5 class="gap-label">確認できなかった情報</h5><ul>${(row.informationGaps||[]).map(item=>`<li>${e(item)}</li>`).join('')||'<li>特になし</li>'}</ul></div><div><h5>参照された情報</h5>${sourceLinks(data,row.sources)}</div></div>${madohaView(row)}</section>`;
}
function resultSummary(data,query,row){
  if(query.kind==='branded')return `<span><b>${e(channelNames[row.channel])}</b>${e(row.accuracy)}</span>`;
  return `<span><b>${e(channelNames[row.channel])}</b>${e(listingLabel(data,row))}${row.recommended?'・推薦あり':''}</span>`;
}
function queryBlock(data,query,index){
  return `<details class="query-block" ${index===0?'open':''}><summary><span class="query-number">${String(index+1).padStart(2,'0')}</span><div><em>${query.kind==='nonbrand'?'非指名検索':'指名検索'}・${e(query.intent)}</em><h3>${e(query.query)}</h3><div class="result-summary">${query.channels.map(row=>resultSummary(data,query,row)).join('')}</div></div><b class="open-label">詳細を見る</b></summary><div class="query-detail">${query.channels.map(row=>query.kind==='nonbrand'?nonbrandResult(data,query,row):brandedResult(data,query,row)).join('')}</div></details>`;
}
function render(data){
  const nonbrand=data.queries.filter(query=>query.kind==='nonbrand');
  const branded=data.queries.filter(query=>query.kind==='branded');
  document.querySelector('#report').innerHTML=`
  <section class="hero compact-hero"><p>MADOHA PAID DIAGNOSIS v1 / AI検索調査レポート</p><h1>${e(data.subject.name)}</h1><span>${e(data.subject.area)} · ${e(data.subject.category)}</span><dl><dt>検索質問</dt><dd>10問</dd><dt>AI検索</dt><dd>3チャネル</dd><dt>検索結果</dt><dd>30件</dd><dt>測定日</dt><dd>${e(data.measurement.snapshotDate)}</dd></dl></section>
  <nav class="report-tools"><a class="pdf-button" href="output/pdf/madoha-kyoudo-paid-diagnosis-v1.pdf" download>PDFレポートをダウンロード</a><span>各検索結果の回答・掲載順・参照情報を収録しています。</span></nav>
  <main class="search-report">
    <header class="report-intro"><p>まず、会社名を含めない6つの検索結果を確認します。</p><h2>非指名検索 6問</h2><p>協同住宅を知らない利用者がAIへ相談した場合に、候補として掲載・推薦されるかを確認しました。</p></header>
    <section class="query-list">${nonbrand.map((query,index)=>queryBlock(data,query,index)).join('')}</section>
    <header class="report-intro branded-intro"><p>次に、会社名を含む4つの検索結果を確認します。</p><h2>指名検索 4問</h2><p>会社の説明、評判、強みと注意点、利用判断について、3つのAIの回答を比較しました。</p></header>
    <section class="query-list">${branded.map((query,index)=>queryBlock(data,query,index+6)).join('')}</section>
    <section class="closing-section"><header><p>検索結果を確認した後の参考情報</p><h2>改善する場合の選択肢</h2></header><p>以下は、今回の検索結果と参照情報から考えられる候補です。特定の表示・推薦結果を保証するものではありません。</p><ol class="option-list">${data.actions.slice(0,3).map(action=>`<li><h3>${e(action.target)}</h3><p>${e(action.change)}</p></li>`).join('')}</ol></section>
    <section class="closing-section sources-section"><header><p>検索結果で使用した主なWeb情報</p><h2>参照情報</h2></header><div class="source-lines">${data.sources.map(source=>`<p><b>${e(source.name)}</b><span>${e(source.role)}</span><a href="${e(source.url)}" target="_blank" rel="noopener">${e(host(source.url))}</a></p>`).join('')}</div></section>
    <section class="measurement-note"><h2>測定条件・注意書き</h2><p>非指名6問と指名4問を、ChatGPT、Gemini、Google AI Modeで各1回検索しました。合計30件の検索結果です。</p><p>本診断は測定時点におけるAI検索の回答を観測したものです。AIの回答は変動するため、同じ質問でも結果が異なる場合があります。また、改善施策による特定の表示・推薦結果を保証するものではありません。</p><p class="sample-caution"><b>商品確認用サンプル：</b>この画面の30件は表示確認用の仮データです。株式会社協同住宅の実測値ではありません。</p></section>
  </main><footer class="end"><b>MADOHA</b><p>検索結果 + 参照情報 + 必要最小限の見解</p><a href="index.html">無料チェックへ戻る</a></footer>`;
}
if(globalThis.MADOHA_KYOUDO_SAMPLE)render(globalThis.MADOHA_KYOUDO_SAMPLE);else fetch('./data/samples/kyoudo-housing-paid-diagnosis.json').then(response=>response.ok?response.json():Promise.reject()).then(render).catch(()=>document.querySelector('#report').innerHTML='<p class="loading">サンプルを読み込めませんでした。</p>');
