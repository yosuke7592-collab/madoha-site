import { spawnSync } from 'node:child_process';
import { unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { derivePaidEntities, measurementsToPaidReport } from '../measurement/paid-pipeline.mjs';
import { enrichPaidMeasurementReliability } from '../measurement/reliability.mjs';

const diagnosisId=process.argv[2];
const execute=process.argv.includes('--execute');
if(!/^[0-9a-f-]{36}$/iu.test(diagnosisId||''))throw new Error('Usage: node scripts/reprocess-production-diagnosis.mjs <diagnosis-id> [--execute]');

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const database='madoha-paid-diagnosis-production';
const runner=process.platform==='win32'?'npx.cmd':'npx';
const runWrangler=(args,{parse=true}={})=>{
  const result=spawnSync(runner,['wrangler','d1','execute',database,'--remote','--json',...args],{cwd:root,encoding:'utf8',windowsHide:true,shell:process.platform==='win32',maxBuffer:64*1024*1024});
  if(result.status!==0)throw new Error([result.stderr,result.stdout,result.error?.message].filter(Boolean).join('\n')||'D1 command failed.');
  if(!parse)return result.stdout;
  const start=result.stdout.indexOf('[\n'),end=result.stdout.lastIndexOf(']');
  if(start<0||end<start)throw new Error('D1 command did not return JSON.');
  const payload=JSON.parse(result.stdout.slice(start,end+1));
  return payload?.[0]?.results||payload?.results||[];
};
const quote=value=>`'${String(value??'').replace(/'/g,"''")}'`;
const readOne=sql=>runWrangler(['--command',process.platform==='win32'?`"${sql}"`:sql])[0]||null;
const order=readOne(`SELECT id,target_url,entity_json,location,locale,payment_status,diagnosis_status,pipeline_state,questions_confirmed_at FROM diagnosis_orders WHERE id=${quote(diagnosisId)}`);
if(!order)throw new Error('Diagnosis not found.');
if(order.payment_status!=='paid'||order.diagnosis_status!=='complete'||order.pipeline_state!=='completed')throw new Error('Only a completed paid diagnosis can be reprocessed.');
if(!order.questions_confirmed_at)throw new Error('Confirmed questions are required.');
const questions=runWrangler(['--command',process.platform==='win32'?`"SELECT question_id,question_order,question_text,intent,selection_reason,measurement_purpose,source_signals_json,question_kind,confirmed FROM diagnosis_questions WHERE diagnosis_id=${quote(diagnosisId)} ORDER BY question_order"`:`SELECT question_id,question_order,question_text,intent,selection_reason,measurement_purpose,source_signals_json,question_kind,confirmed FROM diagnosis_questions WHERE diagnosis_id=${quote(diagnosisId)} ORDER BY question_order`]);
if(questions.length!==10||questions.some(question=>Number(question.confirmed)!==1))throw new Error('Exactly 10 confirmed questions are required.');
const stored=runWrangler(['--command',process.platform==='win32'?`"SELECT question_id,channel,measurement_json FROM paid_measurements WHERE diagnosis_id=${quote(diagnosisId)} ORDER BY question_order,channel_order"`:`SELECT question_id,channel,measurement_json FROM paid_measurements WHERE diagnosis_id=${quote(diagnosisId)} ORDER BY question_order,channel_order`]);
if(stored.length!==30)throw new Error('Exactly 30 stored measurements are required.');
const entity=JSON.parse(order.entity_json||'{}');
const registry=[{id:entity.id||diagnosisId,canonicalName:entity.name,displayName:entity.name,aliases:entity.aliases||[],officialDomains:entity.official_url?[new URL(entity.official_url).hostname.replace(/^www\./,'')]:[]}];
const kindById=new Map(questions.map(question=>[question.question_id,question.question_kind]));
const measurements=stored.map(item=>JSON.parse(item.measurement_json));
for(const row of measurements){
  if(row.error||!String(row.raw_answer||'').trim())throw new Error('Only successful stored measurements can be reprocessed.');
  Object.assign(row,derivePaidEntities(row.raw_answer,entity,registry));
  Object.assign(row,enrichPaidMeasurementReliability(row,entity,registry,kindById.get(row.question_id)||''));
}
const diagnosisRegion=typeof entity.diagnosis_region==='string'?entity.diagnosis_region.trim():Array.isArray(entity.diagnosis_region)?entity.diagnosis_region.map(value=>String(value||'').trim()).filter(Boolean):order.location||'';
const report=measurementsToPaidReport({schemaVersion:'paid-report-v1',sample:false,subject:{...entity,company_location:entity.company_location||entity.region||'',diagnosis_region:diagnosisRegion,area:typeof diagnosisRegion==='string'?diagnosisRegion:diagnosisRegion[0]||'',category:entity.category||''},measurement:{snapshotDate:new Date().toISOString().slice(0,10),queryCount:10,repetitions:1},queryDiscovery:{method:'対象企業のサービス、地域、検索需要、関連情報から確定した10問を使用'},queries:questions.map(question=>({id:question.question_id,query:question.question_text,intent:question.intent,kind:question.question_kind,selectionReason:question.selection_reason,measurementPurpose:question.measurement_purpose,channels:[]})),sources:[],actions:[]},measurements);
report.sources=[...new Map(measurements.flatMap(row=>row.sources||[]).map(source=>[source.url,{name:source.title||source.domain,role:source.citation_text||'AI回答が参照したWeb情報',url:source.url}])).values()];
const recommendationCount=measurements.filter(row=>row.recommendation).length;
const companies=[...new Set(measurements.flatMap(row=>(row.mentioned_entities||[]).filter(item=>!item.target).map(item=>item.name)))];
const output={diagnosis_id:diagnosisId,measurements:measurements.length,recommendation_count:recommendationCount,non_target_company_count:companies.length,execute};
if(!execute){process.stdout.write(`${JSON.stringify(output)}\n`);process.exit(0)}

for(const row of measurements){
  const statement=`UPDATE paid_measurements SET measurement_json=${quote(JSON.stringify(row))}, updated_at=datetime('now') WHERE diagnosis_id=${quote(diagnosisId)} AND question_id=${quote(row.question_id)} AND channel=${quote(row.channel)};`;
  const sqlPath=join(root,'tmp',`reprocess-${diagnosisId}.sql`);
  await writeFile(sqlPath,statement);
  try{runWrangler(['--file',sqlPath],{parse:false})}finally{await unlink(sqlPath).catch(()=>{})}
}
const reportStatement=`UPDATE diagnosis_orders SET report_json=${quote(JSON.stringify(report))}, updated_at=datetime('now') WHERE id=${quote(diagnosisId)};`;
const reportPath=join(root,'tmp',`reprocess-${diagnosisId}.sql`);
await writeFile(reportPath,reportStatement);
try{runWrangler(['--file',reportPath],{parse:false})}finally{await unlink(reportPath).catch(()=>{})}
process.stdout.write(`${JSON.stringify(output)}\n`);
