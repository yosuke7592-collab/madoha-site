import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateReportPdf, reportPdfFilename } from '../../worker/report-pdf.mjs';
import { handleReportPdfRequest } from '../../worker/report-pdf-route.mjs';
import { hashToken } from '../../worker/sales-flow.mjs';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';

const fixture={subject:{name:'株式会社ZEAL',diagnosis_region:'千葉・船橋',language:'ja'},measurement:{snapshotDate:'2026-10-12',channelCount:3},queries:[{query:'千葉・船橋で軽貨物配送を依頼できる会社は？',kind:'nonbrand',channels:[{channel:'chatgpt',appeared:true,recommended:true,aiRank:1,answer:'長い日本語の回答です。\n判断に使える情報を確認します。',sources:[{url:'https://example.com/very/long/reference/path'}]},{channel:'gemini',appeared:false,answer:'別の候補が紹介されました。',sources:[]},{channel:'google_ai_mode',appeared:true,answer:'株式会社ZEALが候補として説明されています。',sources:[]}]}],dashboard:{competitors:[{name:'競合企業',appearances:2}],sources:[{domain:'example.com',references:1,url:'https://example.com/reference'}],priorities:[{fact:'回答内で情報差が確認されました',suggestion:'公式情報の記載を確認できます'}]}};
const embeddedFont=new Uint8Array(await readFile(new URL('../../assets/fonts/NotoSansJP-Regular.ttf',import.meta.url)));
const fontView=new DataView(embeddedFont.buffer,embeddedFont.byteOffset,embeddedFont.byteLength),fontTables=new Set(Array.from({length:fontView.getUint16(4,false)},(_,index)=>String.fromCharCode(...embeddedFont.slice(12+index*16,16+index*16))));

test('report PDF is A4-ready Japanese PDF with embedded font and no browser print metadata',async()=>{
  assert.equal(fontTables.has('fvar'),false,'Acrobat向け埋め込みフォントは静的TrueTypeである必要があります。');
  const pdf=await generateReportPdf(fixture,embeddedFont),source=new TextDecoder().decode(pdf.bytes);
  assert.equal(reportPdfFilename(fixture),'MADOHA_AI検索診断_株式会社ZEAL_2026-10-12.pdf');
  assert.match(source,/^%PDF-1\.7/);assert.match(source,/\/MediaBox \[0 0 595\.28 841\.89\]/);assert.match(source,/\/FontFile2 /);assert.match(source,/\/ToUnicode /);assert.match(source,/MADOHA\+NotoSansJP/);assert.doesNotMatch(source,/HeiseiKakuGo-W5/);assert.ok(pdf.pageCount>=4);assert.doesNotMatch(source,/window\.print|madoha\.jp\//);
});

test('authorized completed diagnosis downloads PDF while id-only and unpaid access fail',async t=>{
  const db=await sqliteD1();t.after(()=>db.close());const id='99999999-9999-4999-8999-999999999999',token='buyer-token';
  await db.prepare(`INSERT INTO diagnosis_orders (id,target_url,amount_jpy,payment_status,diagnosis_status,created_at,updated_at,sales_stage,pipeline_state,completed_measurements,entity_json,access_token_hash,report_json)
    VALUES (?,'https://example.com',9800,'paid','complete',datetime('now'),datetime('now'),'completed','completed',30,?,?,?)`).bind(id,JSON.stringify(fixture.subject),await hashToken(token),JSON.stringify(fixture)).run();
  const env={DB:db,ASSETS:{fetch:async()=>new Response(embeddedFont)}};
  const denied=await handleReportPdfRequest(new Request(`https://madoha.jp/api/sales/${id}/pdf`),env);assert.equal(denied.status,403);
  const ok=await handleReportPdfRequest(new Request(`https://madoha.jp/api/sales/${id}/pdf`,{headers:{'x-diagnosis-token':token}}),env);assert.equal(ok.status,200);assert.equal(ok.headers.get('content-type'),'application/pdf');assert.match(ok.headers.get('content-disposition'),/filename\*=UTF-8''/);assert.equal(ok.headers.get('cache-control'),'private, no-store');assert.equal(new TextDecoder().decode((await ok.arrayBuffer()).slice(0,8)),'%PDF-1.7');
  await db.prepare("UPDATE diagnosis_orders SET payment_status='pending' WHERE id=?").bind(id).run();const unpaid=await handleReportPdfRequest(new Request(`https://madoha.jp/api/sales/${id}/pdf`,{headers:{'x-diagnosis-token':token}}),env);assert.equal(unpaid.status,403);
});

test('web report is visually isolated and direct PDF download replaces browser printing',async()=>{
  const [sales,renderer,css,pdfSource]=await Promise.all([readFile(new URL('../../sales.js',import.meta.url),'utf8'),readFile(new URL('../../sample-kyoudo.js',import.meta.url),'utf8'),readFile(new URL('../../report-document.css',import.meta.url),'utf8'),readFile(new URL('../../worker/report-pdf.mjs',import.meta.url),'utf8')]);
  assert.match(sales,/PDFをダウンロード/);assert.match(sales,/\/pdf/);assert.doesNotMatch(sales,/window\.print/);assert.match(sales,/report-view-active/);
  assert.match(renderer,/ここから購入した診断結果です/);assert.match(renderer,/ここから完成版サンプルです/);assert.match(renderer,/class="diagnosis-report"/);
  assert.match(css,/@page\{size:A4 portrait/);assert.match(css,/body\.report-view-active>main\{display:none\}/);assert.match(css,/body>\*\{display:none!important\}/);
  assert.match(pdfSource,/AI SEARCH DIAGNOSTIC REPORT/);assert.match(pdfSource,/01 \/ TARGET & CONDITIONS/);assert.match(pdfSource,/回答の有無と、対象企業を正しく認識したかは分けて確認する必要があります/);
  assert.doesNotMatch(pdfSource,/DETAIL REFERENCES/);assert.match(pdfSource,/全参照情報はWeb版のEvidenceで確認できます/);assert.match(pdfSource,/groups\.slice\(0,3\)/);assert.match(pdfSource,/competitors\.slice\(0,15\)/);assert.match(pdfSource,/上位15社を表示。全件はWeb版Evidenceで確認できます/);assert.match(pdfSource,/groupedSources/);assert.match(pdfSource,/matrixHeader/);assert.doesNotMatch(pdfSource,/07 \/ CHECK POINTS/);assert.doesNotMatch(pdfSource,/Number\(row\.aiRank\)===1\|\|Number\(row\.listedPosition\)===1/);assert.doesNotMatch(pdfSource,/sources:\(row\.sources\|\|\[\]\)\.slice\(0,3\)/);
});

test('variable report content paginates without expanding PDF evidence references beyond three',async()=>{
  const makeSources=count=>Array.from({length:count},(_,index)=>({title:`参照ページ${index+1}`,url:`https://reference-${index+1}.example.com/${'long-path/'.repeat(3)}${index+1}`}));
  const longQuestion='千葉・船橋で、配送条件や依頼方法を比較しながら、継続的な軽貨物配送について相談できる会社を探す場合に確認すべき候補は？'.repeat(2);
  const longAnswer='これは可変長のAI回答を確認するための表示fixtureです。回答内容そのものではなく、複数ページへ自然に流れることだけを検証します。'.repeat(55);
  const layoutFixture={...structuredClone(fixture),queries:Array.from({length:10},(_,index)=>({query:index===0?longQuestion:`千葉・船橋で軽貨物配送を依頼する場合の確認事項${index+1}は？`,kind:index<6?'nonbrand':'branded',channels:Object.keys({chatgpt:1,gemini:1,google_ai_mode:1}).map(channel=>({channel,appeared:index%3===0,recommended:false,answer:index===0&&channel==='google_ai_mode'?longAnswer:`質問${index+1}に対する${channel}の回答です。`,sources:[]}))})),dashboard:{competitors:Array.from({length:24},(_,index)=>({name:`確認企業${index+1}`,appearances:24-index})),sources:[]}};
  for(const observationCount of [2,4,8]){
    const observations=Array.from({length:observationCount},(_,index)=>({text:`可変長観測事実${index+1}。${'重要な観測内容を説明します。'.repeat(index%3+1)}`,warning:index%2===0}));
    for(const referenceCount of [0,3,20,60]){
      const report=structuredClone(layoutFixture),googleRow=report.queries[0].channels.find(row=>row.channel==='google_ai_mode');googleRow.sources=makeSources(referenceCount);
      if(referenceCount===60)googleRow.sources.push({title:'長大な中継URL',url:`https://vertexaisearch.cloud.google.com/grounding-api-redirect/${'x'.repeat(800)}`});
      const pdf=await generateReportPdf(report,embeddedFont,{observations}),source=new TextDecoder().decode(pdf.bytes),links=(source.match(/\/Subtype \/Link/g)||[]).length;
      assert.ok(pdf.pageCount>=8&&pdf.pageCount<100,`observations=${observationCount}, references=${referenceCount}, pages=${pdf.pageCount}`);
      assert.equal(links,Math.min(referenceCount,3),`PDF evidence must expose at most three links for references=${referenceCount}`);
      assert.doesNotMatch(source,/DETAIL REFERENCES/);
    }
  }
});
