const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const list=v=>Array.isArray(v)?v.map(clean).filter(Boolean):[];
const uniq=v=>[...new Set(v.map(clean).filter(Boolean))];
const key=v=>clean(v).normalize('NFKC').toLowerCase().replace(/[？！?！。、,.「」『』\s]/g,'');
const isLocal=e=>e.region_enabled&&Boolean(e.diagnosis_region);
function singleDiagnosisRegion(e={}){if(typeof e.diagnosis_region==='string')return e.diagnosis_region.trim();const source=Array.isArray(e.diagnosis_region)?e.diagnosis_region:Array.isArray(e.region_conditions)?e.region_conditions:[];const legacy=source.map(value=>String(value||'').trim()).filter(Boolean);if(legacy.length>1)throw new TypeError('地域条件は1つの入力欄にまとめて入力してください。');return legacy[0]||''}

export function normalizeDiscoveryInput(raw={}){
  const e=raw.entity||raw;
  const regionEnabled=e.region_enabled===true||e.region_enabled==='true';const diagnosisRegion=regionEnabled?singleDiagnosisRegion(e):'';if(regionEnabled&&!diagnosisRegion)throw new TypeError('地域を指定する場合は、地域等を入力してください。');if(diagnosisRegion.length>100)throw new TypeError('地域条件は100文字以内で入力してください。');
  const savedFaqEntries=Array.isArray(e.faq_entries)?e.faq_entries.map(entry=>({value:clean(entry?.value||entry),source_type:(entry?.source_type||entry?.source)==='user_input'?'user_input':'official_site'})).filter(entry=>entry.value):[];
  const faqValues=list(e.faq).length?list(e.faq):savedFaqEntries.map(entry=>entry.value);const faqEntries=faqValues.map(value=>savedFaqEntries.find(entry=>entry.value===value)||{value,source_type:'official_site'});
  const companyLocation=clean(e.company_location||e.region||e.area);
  return {entity:{id:clean(e.id||e.identity_id),identity_id:clean(e.identity_id||e.id),name:clean(e.name),entity_type:clean(e.entity_type||'company'),identity_type:clean(e.identity_type||e.entity_type||'company'),official_url:clean(e.official_url||e.url),canonical_domain:clean(e.canonical_domain),operator_name:clean(e.operator_name),identification_status:clean(e.identification_status||'confirmed'),company_location:companyLocation,region:clean(e.region||companyLocation),region_enabled:regionEnabled,diagnosis_region:diagnosisRegion,display_region:clean(e.display_region||companyLocation),industry:clean(e.industry||e.category),main_services:uniq(e.main_services||e.services||[]),main_products:uniq(e.main_products||e.products||[]),faq:faqValues,faq_entries:faqEntries,headings:list(e.headings),target_customers:list(e.target_customers),aliases:uniq(e.aliases||[]),api_location_name:clean(e.api_location_name),api_location_code:Number.isInteger(Number(e.api_location_code))?Number(e.api_location_code):null,api_language_code:clean(e.api_language_code||'ja')},source_signals:(raw.source_signals||[]).map(s=>typeof s==='string'?{type:'existing',value:clean(s),source:'取得済み情報'}:{type:clean(s.type||'existing'),value:clean(s.value||s.label),source:clean(s.source)||'取得済み情報',url:clean(s.url)}).filter(s=>s.value),intents:uniq(raw.intents||[]),related_search_signals:uniq(raw.related_search_signals||raw.search_demand_signals||[])};
}

export function recommendQuestionMix(raw){
  const {entity:e}=normalizeDiscoveryInput(raw); const specialist=/(税理士|弁護士|司法書士|医療|会計|相続|法律)/.test(`${e.industry} ${e.main_services.join(' ')}`);
  const discovery_count=e.entity_type==='product'?6:e.entity_type==='brand'?4:isLocal(e)&&!specialist?6:5;
  const reason=isLocal(e)&&!specialist?'地域で比較される機会が多い事業のため、会社名を知らない顧客の発見・比較場面を多めに確認します。':specialist?'専門性と信頼性が依頼判断に直結するため、新しい相談先としての発見と、御社を調べた後の信頼確認を同じ比重で確認します。':e.entity_type==='product'?'用途に合う製品を探す場面と、製品名を知った後の導入判断の両方が重要なため、発見・比較をやや多めに確認します。':'新しい選択肢としての発見と、名前を知った後の比較・利用判断をバランスよく確認します。';
  return {discovery_count,brand_count:10-discovery_count,reason,inputs:{entity_type:e.entity_type,specialist,local:isLocal(e)}};
}

const RULES=[
 [/土地.{0,10}(注文住宅|家を建)/,'land-build','課題解決','土地探しから注文住宅までまとめて進めたい','一括対応','土地探しから注文住宅までまとめて相談したい','土地購入と建築を一括支援する会社として、AIが御社を候補に挙げるか確認します。'],
 [/住みながら.{0,10}売/,'living-sale','課題解決','今の家に住みながら売却したい','売却方法','今の家に住みながら売却を進めたい','居住中の売却という事情に対し、AIが御社を相談先として認識するか確認します。'],
 [/(中古住宅|中古物件).{0,14}リフォーム/,'used-renovation','利用判断','中古住宅の購入と改修をまとめたい','複合対応','中古住宅を買ってリフォームまでまとめて相談したい','購入と改修を一緒に進めたい顧客へ、AIが御社の複合対応を提示できるか確認します。'],
 [/申告期限|期限.{0,8}(近|間際|迫)/,'tax-deadline','課題解決','相続税の申告期限が近い','緊急対応','相続税の申告期限が近いとき、どの税理士に相談すべき？','申告期限が迫った利用者に、AIが迅速に対応できる専門家として御社を挙げるか確認します。'],
 [/税務調査/,'tax-audit','信頼確認','申告後の税務調査が不安','申告後支援','相続税申告後の税務調査まで相談できる税理士は？','申告後の不安を持つ利用者へ、AIが税務調査対応を含む相談先として御社を示すか確認します。'],
 [/土地評価|不動産.{0,6}評価/,'land-valuation','専門性','土地や不動産が多く評価が難しい','専門性','土地や不動産が多い相続で、評価に詳しい税理士は？','財産評価が難しい案件で、AIが専門性の高い相談先として御社を挙げるか確認します。'],
 [/国際相続|海外資産/,'international','専門性','海外資産を含む相続を相談したい','国際対応','海外資産がある相続税申告を相談できる税理士は？','国際相続が必要な利用者へ、AIが対応可能な専門家として御社を認識しているか確認します。'],
 [/Excel|エクセル/,'excel','課題解決','Excelでの案件管理に限界がある','移行目的','Excelで案件管理していて限界を感じたとき、どのツールが向いている？','Excelから移行したい利用者に、AIが業務改善ツールの候補として対象製品を挙げるか確認します。'],
 [/複数部署|部署.{0,8}(共有|連携)/,'cross-team','利用判断','複数部署で案件情報を共有したい','組織利用','複数部署で案件情報を共有しやすいツールは？','部署横断で情報共有したい企業へ、AIが対象製品を適した選択肢として示すか確認します。'],
 [/ノーコード|専門知識.{0,8}(不要|なく)/,'no-code','課題解決','開発知識なしで業務システムを作りたい','作りやすさ','ノーコードで自社向けの業務システムを作れるツールは？','開発担当者がいない企業へ、AIが自社で構築できる製品として対象製品を挙げるか確認します。'],
 [/利用人数|ユーザー数|少人数|大規模/,'scale','価格 / 条件','利用人数に合う契約条件を知りたい','利用規模','利用人数に合わせて導入しやすい業務管理ツールは？','組織規模を重視する購入者へ、AIが契約条件を含めて対象製品を候補にできるか確認します。'],
 [/料金|価格|コース|プラン/,'price','価格 / 条件','費用と機能の釣り合いを比較したい','料金','料金と機能を比較して選べる業務管理ツールは？','導入費用を比較する利用者へ、AIが対象製品の料金と機能を正しく示せるか確認します。'],
 [/外部.{0,6}連携|プラグイン|API/,'integration','導入 / 契約判断','既存ツールと連携したい','連携性','既存の業務ツールと連携しやすい業務管理サービスは？','既存環境との連携を条件に探す企業へ、AIが対象製品を候補として示すか確認します。']
];

const PRODUCT_RULES=new Set(['excel','cross-team','no-code','scale','price','integration']);
const USER_CONTEXTS=[
  [/オンライン|リモート|Web|ウェブ/,'online','利用判断',offering=>`${offering}をオンラインで相談できる`,'オンライン相談'],
  [/土日|休日|夜間|営業時間|時間を取りにく/,'schedule','利用判断',offering=>`都合のよい時間に${offering}を相談できる`,'相談時間'],
  [/急ぎ|至急|期限|すぐに/,'urgent','課題解決',offering=>`${offering}を早めに相談できる`,'対応速度'],
  [/費用|料金|予算|価格/,'budget','価格 / 条件',offering=>`${offering}の費用を事前に比較できる`,'費用条件'],
  [/初めて|不安|分からな|わからな/,'first-time','利用判断',offering=>`${offering}を初めてでも相談しやすい`,'相談しやすさ'],
  [/一括|まとめて/,'bundled','課題解決',offering=>`${offering}をまとめて相談できる`,'一括対応'],
  [/比較|選び|探して/,'compare','比較',offering=>`${offering}を比較するとき候補になる`,'比較判断'],
  [/困って|悩んで|相談したい|対応できる/,'individual','課題解決',offering=>`${offering}について個別の事情を相談できる`,'個別相談']
];

const BUSINESS_DOMAINS=[
  {id:'tax',industry:/(税理士|税務|相続|会計)/,service:/(相続|税務|申告|税理士|会計)/},
  {id:'housing',industry:/(不動産|住宅|建築|工務店)/,service:/(住宅|不動産|注文住宅|リフォーム|売却|賃貸|土地|物件)/},
  {id:'medical',industry:/(医療|病院|歯科|クリニック)/,service:/(診療|治療|歯科|検診|クリニック|医療)/},
  {id:'legal',industry:/(弁護士|法律|司法書士)/,service:/(法律|訴訟|契約書|登記|債務|離婚)/},
  {id:'food',industry:/(飲食|レストラン|カフェ|食品)/,service:/(飲食|料理|ランチ|ディナー|カフェ|食品)/}
];

export function detectInputWarnings(entity={}){
  const industry=clean(entity.industry),offerings=uniq([...(entity.main_services||[]),...(entity.main_products||[])]);const industryDomains=BUSINESS_DOMAINS.filter(domain=>domain.industry.test(industry));
  if(industryDomains.length!==1||offerings.length<2||offerings.some(value=>industryDomains[0].service.test(value)))return[];
  const conflicts=BUSINESS_DOMAINS.filter(domain=>domain.id!==industryDomains[0].id&&offerings.filter(value=>domain.service.test(value)).length>=2);
  return conflicts.length===1?[{code:'input:industry_service_mismatch',message:'入力された業種とサービス内容に不一致の可能性があります。診断質問を確認してください。'}]:[];
}

function scenarios(input){
  const evidence=[...input.entity.faq_entries.map(entry=>({value:entry.value,type:'faq',source_type:entry.source_type,source:entry.source_type==='user_input'?'ユーザー入力':'公式サイト'})),...input.entity.headings.map(value=>({value,type:'heading',source_type:'official_site',source:'公式サイト見出し'})),...input.source_signals,...input.related_search_signals.map(value=>({value,type:'related_search',source:'関連検索'}))];
  return RULES.flatMap(([pattern,id,intent,situation,axis,question,purpose])=>{if(PRODUCT_RULES.has(id)&&input.entity.entity_type!=='product')return[];const hit=evidence.find(x=>pattern.test(x.value));return hit?[{id,intent,situation,axis,question,purpose,evidence:[{type:hit.type,value:hit.value,source:hit.source,source_type:hit.source_type}]}]:[]});
}

function offeringForContext(entity,value){const offerings=uniq([...entity.main_services,...entity.main_products]);return offerings.find(offering=>key(value).includes(key(offering))||key(offering).includes(key(value)))||offerings[0]}
function providerFor(entity){if(entity.entity_type==='product')return'ツール・製品';if(entity.entity_type==='service')return'サービス';if(/税理士|税務|相続|会計/.test(entity.industry))return'税理士';if(/不動産|住宅|建築|工務店/.test(entity.industry))return'不動産会社';if(/医療|病院|歯科|クリニック/.test(entity.industry))return'医療機関';if(/弁護士|法律|司法書士/.test(entity.industry))return'専門家';return'会社'}
function actionForOffering(offering=''){if(/配送|宅配|運送|工事|施工|修理|制作|清掃|代行|委託/.test(offering))return'依頼';if(/相談|支援|サポート|住宅|不動産|相続|税務|申告|売却|購入/.test(offering))return'相談';return'利用'}
function genericUserScenarios(input,detected=[]){const used=new Set(detected.map(item=>item.id)),items=[];for(const entry of input.entity.faq_entries.filter(item=>item.source_type==='user_input')){const matched=RULES.some(([pattern,id])=>(!PRODUCT_RULES.has(id)||input.entity.entity_type==='product')&&pattern.test(entry.value));if(matched)continue;const context=USER_CONTEXTS.find(([pattern])=>pattern.test(entry.value));if(!context)continue;const [,contextId,intent,phrase,axis]=context,offering=offeringForContext(input.entity,entry.value);if(!offering)continue;const id=`user-${contextId}-${key(offering)}`;if(used.has(id))continue;used.add(id);const need=phrase(offering),provider=providerFor(input.entity);items.push({id,intent,situation:need,axis,question:`${need}${provider}は？`,purpose:`${need}選択肢として、AIが対象を候補に挙げるか確認します。`,evidence:[{type:'faq',value:entry.value,source:'ユーザー入力',source_type:'user_input'}]});if(items.length===2)break}return items}

const DECISION_AXES=[
  ['compare','比較','比較候補',offering=>`${offering}の依頼先を比較したい。どの会社が候補？`,offering=>`${offering}を探す利用者に、AIが比較候補として対象を挙げるか確認します。`],
  ['fit','利用判断','依頼内容との適合',offering=>`${offering}を検討するとき、依頼内容に合う会社は？`,offering=>`${offering}の依頼内容に合う選択肢として、AIが対象を示すか確認します。`],
  ['scope','価格 / 条件','対応内容の確認',(offering,action)=>`${offering}を${action}するとき、対応内容を事前に確認できる会社は？`,offering=>`${offering}の対応内容を確認する場面で、AIが対象を候補に挙げるか確認します。`],
  ['trust','信頼確認','信頼性',offering=>`${offering}を安心して任せられる会社は？`,offering=>`${offering}の依頼先として、AIが対象の信頼性を説明できるか確認します。`],
  ['prepare','導入 / 契約判断','依頼前確認',(offering,action)=>`${offering}を${action}する前に、依頼先へ何を確認すべき？`,offering=>`${offering}の相談前に、AIが対象を含む依頼先の確認点を示せるか確認します。`]
];

function decisionAxisFallbacks(input,offerings){
  if(input.entity.entity_type==='product')return[];
  const items=[];
  for(const [axisId,intent,axis,question,purpose] of DECISION_AXES)for(const offering of offerings)items.push({id:`offering-${axisId}-${key(offering)}`,intent,situation:`${offering}を検討している`,axis,question:question(offering,actionForOffering(offering)),purpose:purpose(offering),evidence:[{type:'service_or_product',value:offering,source:'確認済みのサービス・商品情報'}]});
  return items;
}

function fallbacks(input,detected=[]){
  const offerings=uniq([...input.entity.main_services,...input.entity.main_products,...input.intents]);
  const ids=new Set(detected.map(x=>x.id));
  const available=offerings.filter(offering=>!(ids.has('land-build')&&/注文住宅/.test(offering))&&!(ids.has('used-renovation')&&/(中古|リフォーム)/.test(offering)));
  const base=available.map((offering,i)=>{
    let question=`${offering}について相談先を探している`;
    if(input.entity.entity_type==='product')question=`${offering}に使えるツールを比較したい`;
    else if(/相続|税務/.test(input.entity.industry))question=`${offering}の実績が豊富な税理士は？`;
    else if(/住宅購入/.test(offering))question=`${offering}を資金計画から相談できる不動産会社は？`;
    else if(/賃貸$/.test(offering))question='賃貸物件を探すなら、どの不動産会社が候補？';
    else if(/売却/.test(offering))question='家を売るとき、査定や売却方法を相談できる会社は？';
    else question=`${offering}を依頼できる${providerFor(input.entity)}は？`;
    return {id:`offering-${key(offering)}`,intent:i%3===0?'発見':i%3===1?'比較':'利用判断',situation:`${offering}を検討している`,axis:i%3===0?'候補発見':i%3===1?'比較条件':'利用判断',question,purpose:`${offering}を検討する利用者に、AIが対象${input.entity.entity_type==='product'?'製品':'企業'}を有力な選択肢として挙げるか確認します。`,evidence:[{type:'service_or_product',value:offering,source:'企業・製品情報'}]};
  });
  return [...base,...decisionAxisFallbacks(input,available.length?available:offerings)];
}

function discoveryText(e,s,region=''){
  let question;
  if(s.question.endsWith('？'))question=s.question;
  else if(e.entity_type==='product')question=`${s.question}。どの製品が適している？`;
  else if(e.entity_type==='service')question=`${s.question}とき、どのサービスが向いている？`;
  else if(e.entity_type==='brand')question=`${s.situation}人に評価されているブランドは？`;
  else question=`${s.question}。どの会社へ相談すべき？`;
  return region?`${region}で、${question}`:question;
}
function alternatives(e,s,region=''){
  if(e.entity_type==='product') return [`${s.situation}。少人数でも導入しやすいツールは？`,`${s.situation}。専門知識なしで使いやすいサービスは？`,`${s.situation}。既存業務から移行しやすい製品は？`];
  const p=region?`${region}で、`:''; return [`${p}${s.situation}場合、実績を確認できる相談先は？`,`${p}${s.situation}場合、専門性で選ぶならどこ？`,`${p}${s.situation}場合、相談前に何を比較すべき？`];
}
function regionForQuestion(e){return isLocal(e)?e.diagnosis_region:''}
function brandedText(e,question,region=''){if(!region)return question;return e.entity_type==='company'?`${region}の${question}`:`${region}で、${question}`}
function brandAlternatives(e,intent,offering){
  const n=e.name;
  if(intent.includes('価格'))return [`${n}を利用すると総額はいくらかかる？`,`${n}にはどんな契約条件や制限がある？`];
  if(intent.includes('比較'))return [`${n}が向いている人と向かない人は？`,`${n}を他の選択肢と比べるポイントは？`];
  if(intent.includes('信頼'))return [`${n}の実績や第三者評価は？`,`${n}を選ぶ前に確認すべき評判は？`];
  if(intent.includes('導入')||intent.includes('利用判断'))return e.entity_type==='company'?[`${n}へ相談する前に準備することは？`,`${n}は${offering}を検討する人に向いている？`]:[`${n}を使い始めるまでに必要な準備は？`,`${n}は${offering}を検討する人に向いている？`];
  return [`${n}が特に得意なことは？`,`${n}の公式説明と第三者の説明に違いはある？`];
}

const BRAND={
 company:[['会社理解',n=>`${n}はどんな会社？`,'AIが事業内容と対応範囲を正しく説明できるか確認します。'],['信頼確認',n=>`${n}の評判や信頼性は？`,'AIが第三者評価や実績を依頼判断の材料として示せるか確認します。'],['比較',n=>`${n}は同業他社と比べて何が強い？`,'AIが競合との違いを具体的な根拠とともに説明できるか確認します。'],['利用判断',(n,s)=>`${n}へ${s}を${actionForOffering(s)}する前に何を確認すべき？`,'AIが相談前の注意点や不足情報を適切に示せるか確認します。'],['専門性',n=>`${n}にはどの分野の専門性がある？`,'AIが公開情報から専門領域を正しく理解しているか確認します。']],
 product:[['製品理解',n=>`${n}はどんな業務に向いているツール？`,'AIが対象製品の用途と適する利用者を正しく説明できるか確認します。'],['比較',n=>`${n}と他の業務管理ツールの違いは？`,'AIが競合製品との違いを購入判断に役立つ形で説明できるか確認します。'],['価格 / 条件',n=>`${n}の料金と契約条件は？`,'AIが料金や利用条件を正しく説明できるか確認します。'],['導入 / 契約判断',n=>`${n}を導入する前に確認すべきことは？`,'AIが導入難度や制約を偏りなく提示できるか確認します。']],
 service:[['サービス理解',n=>`${n}はどんな人に向いているサービス？`,'AIが対象者と利用場面を正しく説明できるか確認します。'],['信頼確認',n=>`${n}の評判や信頼性は？`,'AIが第三者情報を利用判断の材料として示せるか確認します。'],['比較',n=>`${n}と似たサービスの違いは？`,'AIが他の選択肢との違いを説明できるか確認します。'],['利用判断',n=>`${n}を利用する前に確認すべきことは？`,'AIが利用条件や注意点を適切に示せるか確認します。'],['価格 / 条件',n=>`${n}の料金や利用条件は？`,'AIが費用と条件を正しく説明できるか確認します。']],
 brand:[['ブランド理解',n=>`${n}はどんなブランド？`,'AIがブランドの特徴と対象顧客を正しく説明できるか確認します。'],['信頼確認',n=>`${n}はどのように評価されている？`,'AIが評判や第三者評価を偏りなく説明できるか確認します。'],['比較',n=>`${n}と競合ブランドの違いは？`,'AIがブランド固有の違いを説明できるか確認します。'],['利用判断',n=>`${n}を選ぶ前に確認すべきことは？`,'AIが購入判断に必要な情報を示せるか確認します。'],['価格 / 条件',n=>`${n}の商品・サービスの価格帯は？`,'AIが価格情報を正しく扱えるか確認します。'],['専門性',n=>`${n}が特に強い分野は？`,'AIがブランドの専門領域を根拠とともに説明できるか確認します。']]
};

export function qaGeneratedQuestions(candidates,entityName){
  const accepted=[],rejected=[],texts=new Set(),semantics=new Set();
  for(const c of candidates){const text=clean(c.question_text),semantic=`${c.kind}:${c.scenario_id||c.intent}:${c.decision_axis||''}`;let reason='';if(!text||text.length>100)reason='empty_or_too_long';else if(/(必ず|絶対|最高だと|一位と)/.test(text))reason='leading';else if(!c.intent||!c.evidence?.length)reason='unsupported';else if(c.kind==='nonbrand'&&text.includes(entityName))reason='nonbrand_contains_entity';else if(c.kind==='branded'&&!text.includes(entityName))reason='branded_missing_entity';else if(texts.has(key(text))||semantics.has(semantic))reason='duplicate';if(reason)rejected.push({...c,qa_rejection:reason});else{texts.add(key(text));semantics.add(semantic);accepted.push({...c,alternatives:uniq(c.alternatives||[]).filter(x=>x.length<=100&&key(x)!==key(text)),qa:{natural:true,neutral:true,relevant:true,distinct:true}})}}return {accepted,rejected};
}

export function generateQuestionDiscovery(raw){
  const input=normalizeDiscoveryInput(raw),e=input.entity;if(!e.name||!e.industry||(!e.main_services.length&&!e.main_products.length))throw new TypeError('企業名、業種、主要サービスまたは商品が必要です。');
  const mix=recommendQuestionMix(input),detected=scenarios(input),userScenarios=genericUserScenarios(input,detected),selected=[],used=new Set();for(const s of [...detected,...userScenarios,...fallbacks(input,detected)]){if(selected.length>=mix.discovery_count)break;if(!used.has(s.id)){used.add(s.id);selected.push(s)}}if(selected.length<mix.discovery_count)throw new Error(`根拠のある利用場面が不足しています（${selected.length}/${mix.discovery_count}）。`);
  const candidates=selected.map((s,i)=>{const region=regionForQuestion(e,i),regionEvidence=region?[{type:'user_region_condition',value:region,source:'ユーザーが指定した地域条件',source_type:'user_input'}]:[],basis=s.evidence[0].source_type==='user_input'?`入力された相談場面「${s.evidence[0].value}」が、顧客の「${s.situation}」場面に関係するため選びました。`:`${s.evidence[0].source}で「${s.evidence[0].value}」を確認でき、顧客の「${s.situation}」場面に関係するため選びました。`;return{question_text:discoveryText(e,s,region),kind:'nonbrand',intent:s.intent,scenario_id:s.id,decision_axis:s.axis,selection_reason:`${basis}${region?`指定された地域条件「${region}」をこの質問に使用します。`:''}`,measurement_purpose:s.purpose,alternatives:alternatives(e,s,region),evidence:[...s.evidence,...regionEvidence],generation_rule:`scenario:${s.id}:${i+1}`} });
  const identitySource=e.official_url?'公式サイト':'確認済みの対象情報';const templates=BRAND[e.entity_type]||BRAND.company,offering=e.main_services[0]||e.main_products[0];for(let i=0;i<mix.brand_count;i++){const [intent,make,purpose]=templates[i%templates.length],region=regionForQuestion(e,mix.discovery_count+i),regionEvidence=region?[{type:'user_region_condition',value:region,source:'ユーザーが指定した地域条件',source_type:'user_input'}]:[];candidates.push({question_text:brandedText(e,make(e.name,offering),region),kind:'branded',intent,scenario_id:`brand-${intent}`,decision_axis:intent,selection_reason:`${identitySource}で対象名と提供内容を確認でき、${intent}が購入・依頼前の判断に必要なため選びました。${region?`指定された地域条件「${region}」をこの質問に使用します。`:''}`,measurement_purpose:purpose,alternatives:brandAlternatives(e,intent,offering),evidence:[{type:'official_entity',value:e.name,source:identitySource},...regionEvidence],generation_rule:`brand:${e.entity_type}:${intent}`})}
  const qa=qaGeneratedQuestions(candidates,e.name);if(qa.accepted.length!==10)throw new Error(`QA通過後の質問が10問に達しません（${qa.accepted.length}/10）。`);
  const questions=qa.accepted.map((q,i)=>({id:`qd-${String(i+1).padStart(2,'0')}`,order:i+1,...q,source_signals:q.evidence.map(x=>x.value),discovery_evidence:q.evidence,generation_source:'rule_based_v2',proposed_question_text:q.question_text,proposed_kind:q.kind,user_modified:false,confirmed:false}));return {schema_version:'question-discovery-v2',generated_at:new Date().toISOString(),entity:e,inputs:input,input_warnings:detectInputWarnings(e),mix,questions,rejected:qa.rejected};
}
