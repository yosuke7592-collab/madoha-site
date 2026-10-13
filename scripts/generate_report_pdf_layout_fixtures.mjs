import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generateReportPdf } from '../worker/report-pdf.mjs';

const outputDirectory=resolve(process.argv[2]||'output/qa/report-pdf-layout');
const fontBytes=new Uint8Array(await readFile(new URL('../assets/fonts/NotoSansJP-Regular.ttf',import.meta.url)));
const channels=['chatgpt','gemini','google_ai_mode'];
const makeSources=count=>Array.from({length:count},(_,index)=>({title:`参照ページ${index+1}`,url:`https://reference-${index+1}.example.com/${'long-path/'.repeat(3)}${index+1}`}));
const longQuestion='千葉・船橋で、配送条件や依頼方法を比較しながら、継続的な軽貨物配送について相談できる会社を探す場合に確認すべき候補は？'.repeat(2);
const longAnswer='これは可変長のAI回答を確認するための表示fixtureです。回答内容そのものではなく、複数ページへ自然に流れることだけを検証します。'.repeat(24);
const base={
  subject:{name:'PDF可変長QA対象',diagnosis_region:'千葉・船橋',official_url:'https://example.com/',services:['軽貨物配送'],language:'ja'},
  measurement:{snapshotDate:'2026-10-13',channelCount:3},
  queries:Array.from({length:10},(_,index)=>({
    query:index===0?longQuestion:`千葉・船橋で軽貨物配送を依頼する場合の確認事項${index+1}は？`,
    kind:index<6?'nonbrand':'branded',
    channels:channels.map(channel=>({channel,appeared:index%3===0,recommended:false,answer:index===0&&channel==='google_ai_mode'?longAnswer:`質問${index+1}に対する${channel}の回答です。`,sources:[],provenance:{measuredAt:'2026-10-13T00:00:00.000Z',apiLocationName:'Japan'}}))
  })),
  dashboard:{competitors:Array.from({length:24},(_,index)=>({name:`確認企業${index+1}`,appearances:24-index})),sources:[]}
};

await mkdir(outputDirectory,{recursive:true});
const results=[];
for(const observationCount of [2,4,8]){
  const observations=Array.from({length:observationCount},(_,index)=>({text:`可変長観測事実${index+1}。${'重要な観測内容を説明します。'.repeat(index%3+1)}`,warning:index%2===0}));
  for(const referenceCount of [0,3,20,60]){
    const report=structuredClone(base),googleRow=report.queries[0].channels.find(row=>row.channel==='google_ai_mode');
    googleRow.sources=makeSources(referenceCount);
    if(referenceCount===60)googleRow.sources.push({title:'長大な中継URL',url:`https://vertexaisearch.cloud.google.com/grounding-api-redirect/${'x'.repeat(800)}`});
    const pdf=await generateReportPdf(report,fontBytes,{observations}),filename=`layout-observations-${observationCount}-references-${referenceCount}.pdf`,path=resolve(outputDirectory,filename);
    await writeFile(path,pdf.bytes);results.push({filename,pageCount:pdf.pageCount,bytes:pdf.bytes.length});
  }
}
process.stdout.write(JSON.stringify({outputDirectory,results},null,2));
