import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';
import { authorizeSales, handleSalesRequest } from '../../worker/sales-flow.mjs';
import { decryptBuyerEmail, emailLookupHash, encryptBuyerEmail, ensureCompletionEmail, hashResultToken, normalizeBuyerEmail, resultTokenFromNonce, storeBuyerEmail } from '../../worker/result-delivery.mjs';

const secrets={
  MADOHA_EMAIL_ENCRYPTION_KEY:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  MADOHA_EMAIL_LOOKUP_SECRET:'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  MADOHA_RESULT_TOKEN_SECRET:'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
  RESEND_API_KEY:'re_test',PUBLIC_SITE_URL:'https://madoha.jp'
};
async function completed(t,{fetchImpl}={}){
  const db=await sqliteD1();t.after(()=>db.close());const id='88888888-8888-4888-8888-888888888888';
  await db.prepare(`INSERT INTO diagnosis_orders (id,target_url,amount_jpy,payment_status,diagnosis_status,created_at,updated_at,sales_stage,pipeline_state,completed_measurements,entity_json)
    VALUES (?, 'https://example.com',9800,'paid','complete',datetime('now'),datetime('now'),'completed','completed',30,?)`).bind(id,JSON.stringify({name:'テスト株式会社'})).run();
  const sent=[];const defaultFetch=async(_url,init)=>{sent.push({headers:init.headers,body:JSON.parse(init.body)});return Response.json({id:`mail_${sent.length}`})};const env={DB:db,...secrets,RESULT_RESEND_LIMITER:{async limit(){return{success:true}}},RESULT_EMAIL_FETCH:fetchImpl||defaultFetch};
  await storeBuyerEmail(env,id,'Buyer@Example.com');
  const nonce='initial-nonce';const token=await resultTokenFromNonce(env,id,nonce),hash=await hashResultToken(token);
  await db.prepare("UPDATE diagnosis_delivery SET result_token_hash=?,result_token_nonce=?,completion_email_status='sent',completion_email_sent_at=datetime('now') WHERE diagnosis_id=?").bind(hash,nonce,id).run();
  return{db,env,id,token,sent};
}

test('buyer email is normalized, encrypted, decryptable, and looked up by keyed hash',async()=>{
  const env=secrets,email=' Buyer@Example.com ';
  assert.equal(normalizeBuyerEmail(email),'buyer@example.com');
  const encrypted=await encryptBuyerEmail(env,email);
  assert.doesNotMatch(encrypted,/buyer@example\.com/);
  assert.equal(await decryptBuyerEmail(env,encrypted),'buyer@example.com');
  assert.equal(await emailLookupHash(env,email),await emailLookupHash(env,'buyer@example.com'));
});

test('result tokens are deterministic from secret nonce while only hashes are persisted',async()=>{
  const id='88888888-8888-4888-8888-888888888888',token=await resultTokenFromNonce(secrets,id,'nonce');
  assert.equal(token,await resultTokenFromNonce(secrets,id,'nonce'));
  assert.notEqual(token,await resultTokenFromNonce({...secrets,MADOHA_RESULT_TOKEN_SECRET:'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD'},id,'nonce'));
  assert.match(await hashResultToken(token),/^[a-f0-9]{64}$/);
});

test('resend rotates a completed result token only after successful delivery',async t=>{
  const {db,env,id,token:oldToken,sent}=await completed(t);
  const response=await handleSalesRequest(new Request('https://madoha.jp/api/sales/result/resend',{method:'POST',headers:{origin:'https://madoha.jp','content-type':'application/json','cf-connecting-ip':'203.0.113.1'},body:JSON.stringify({email:'buyer@example.com'})}),env);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{message:'該当する診断結果がある場合はメールを送信しました'});assert.equal(sent.length,1);
  const url=sent[0].body.text.match(/https:\/\/[^\s]+/)[0],newToken=decodeURIComponent(url.split('#result_token=')[1]);
  assert.notEqual(newToken,oldToken);assert.equal(await authorizeSales(db,id,oldToken),null);assert.equal((await authorizeSales(db,id,newToken)).authorization_type,'result');
  assert.equal(sent[0].body.from,'MADOHA <results@madoha.jp>');assert.equal(sent[0].body.reply_to,'info@madoha.jp');
});

test('completion notification retries with the same provider idempotency key and sends once',async t=>{
  const {db,env,id,sent}=await completed(t);await db.prepare("UPDATE diagnosis_delivery SET result_token_hash=NULL,result_token_nonce=NULL,completion_email_status='pending',completion_email_sent_at=NULL WHERE diagnosis_id=?").bind(id).run();
  let attempt=0;const requests=[];env.RESULT_EMAIL_FETCH=async(_url,init)=>{attempt+=1;requests.push({headers:init.headers,body:JSON.parse(init.body)});return attempt===1?Response.json({message:'temporary'},{status:503}):Response.json({id:'mail_ok'})};
  await assert.rejects(()=>ensureCompletionEmail(env,id),/送信できません/);const pending=await db.prepare('SELECT * FROM diagnosis_delivery WHERE diagnosis_id=?').bind(id).first();assert.ok(pending.pending_result_token_hash);assert.equal(pending.result_token_hash,null);
  assert.deepEqual(await ensureCompletionEmail(env,id),{sent:true});assert.deepEqual(await ensureCompletionEmail(env,id),{sent:false,reason:'already_sent'});assert.equal(requests.length,2);assert.equal(requests[0].headers['idempotency-key'],requests[1].headers['idempotency-key']);assert.equal(requests[0].body.text,requests[1].body.text);assert.equal(sent.length,0);
});

test('failed resend preserves the old result token and hides account existence',async t=>{
  const {db,env,id,token:oldToken}=await completed(t,{fetchImpl:async()=>Response.json({message:'failure'},{status:500})});
  const known=await handleSalesRequest(new Request('https://madoha.jp/api/sales/result/resend',{method:'POST',headers:{origin:'https://madoha.jp','content-type':'application/json'},body:JSON.stringify({email:'buyer@example.com'})}),env);
  const unknown=await handleSalesRequest(new Request('https://madoha.jp/api/sales/result/resend',{method:'POST',headers:{origin:'https://madoha.jp','content-type':'application/json'},body:JSON.stringify({email:'nobody@example.com'})}),env);
  assert.deepEqual(await known.json(),await unknown.json());assert.equal((await authorizeSales(db,id,oldToken)).authorization_type,'result');
  const delivery=await db.prepare('SELECT * FROM diagnosis_delivery WHERE diagnosis_id=?').bind(id).first();assert.equal(delivery.pending_result_token_hash,null);assert.ok(delivery.result_token_hash);
});

test('result access requires paid completed state and a token, while buyer token remains compatible',async t=>{
  const {db,id,token}=await completed(t);assert.equal(await authorizeSales(db,id,''),null);assert.equal(await authorizeSales(db,id,'guess'),null);assert.equal((await authorizeSales(db,id,token)).authorization_type,'result');
  await db.prepare("UPDATE diagnosis_orders SET payment_status='pending' WHERE id=?").bind(id).run();assert.equal(await authorizeSales(db,id,token),null);
});

test('resend endpoint rate limits before lookup without exposing diagnosis existence',async t=>{
  const {env}=await completed(t);env.RESULT_RESEND_LIMITER={async limit(){return{success:false}}};
  const response=await handleSalesRequest(new Request('https://madoha.jp/api/sales/result/resend',{method:'POST',headers:{origin:'https://madoha.jp','content-type':'application/json'},body:JSON.stringify({email:'buyer@example.com'})}),env);
  assert.equal(response.status,429);assert.deepEqual(await response.json(),{message:'該当する診断結果がある場合はメールを送信しました'});
});

test('migration 0008 preserves existing orders and adds isolated delivery storage',async t=>{
  const db=await sqliteD1({through:'0007_paid_diagnosis_v2_price.sql'});t.after(()=>db.close());const id='77777777-7777-4777-8777-777777777777';
  await db.prepare("INSERT INTO diagnosis_orders (id,target_url,amount_jpy,payment_status,diagnosis_status,created_at,updated_at) VALUES (?,'https://legacy.example',9800,'pending','locked',datetime('now'),datetime('now'))").bind(id).run();
  await db.applySchema(await readFile(new URL('../../migrations/0008_result_delivery.sql',import.meta.url),'utf8'));
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM diagnosis_orders WHERE id=?').bind(id).first()).n,1);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM diagnosis_delivery').first()).n,0);
});

test('public UI stores result token then removes it from the address bar and keeps authenticated PDF download',async()=>{
  const [script,html]=await Promise.all([readFile(new URL('../../sales.js',import.meta.url),'utf8'),readFile(new URL('../../index.html',import.meta.url),'utf8')]);
  assert.match(script,/madoha-result-/);assert.match(script,/history\.replaceState\(history\.state/);assert.match(script,/location\.hash\.startsWith\('#result_token='/);
  assert.match(script,/PDFをダウンロード/);assert.match(script,/x-diagnosis-token/);assert.doesNotMatch(script,/window\.print/);assert.match(html,/この診断結果は後から再閲覧できます/);assert.match(html,/診断結果URLを再送/);assert.match(html,/参照情報や他社の掲載状況は掲載順位やその要因を示すものではありません/);
});
