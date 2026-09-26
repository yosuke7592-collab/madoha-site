(()=>{
const subject='LUMO Flow';
const sourceCatalog=[
 {name:'LUMO Flow 公式サイト',url:'https://lumo-flow.example/',role:'機能・料金・導入条件の確認'},
 {name:'SaaS Guide',url:'https://saas-guide.example/workflow/',role:'業務管理ツールの比較'},
 {name:'Workstyle Lab',url:'https://workstyle-lab.example/no-code/',role:'ノーコード活用事例'},
 {name:'Cloud Review',url:'https://cloud-review.example/lumo-flow/',role:'利用者レビューの整理'}
];
const definitions=[
 ['q1','nonbrand','課題解決','Excelで案件管理を続けるのが難しくなった。少人数でも導入しやすいツールは？'],
 ['q2','nonbrand','比較','複数部署で案件情報を共有できるノーコードの業務管理ツールを比較したい。'],
 ['q3','nonbrand','利用判断','営業とサポートの進捗を一つの画面で管理できるサービスは？'],
 ['q4','nonbrand','導入判断','専門担当者がいなくても運用を始めやすい業務管理サービスは？'],
 ['q5','nonbrand','価格・条件','20人程度のチームで使いやすい案件管理ツールの選び方は？'],
 ['q6','nonbrand','比較','外部サービスと連携しやすいノーコード業務ツールは？'],
 ['q7','branded','会社理解','LUMO Flowはどんなサービス？'],
 ['q8','branded','信頼確認','LUMO Flowの評判や信頼性は？'],
 ['q9','branded','比較','LUMO Flowは他の業務管理ツールと比べて何が強い？'],
 ['q10','branded','利用判断','LUMO Flowを導入する前に確認すべきことは？']
];
const channels=['chatgpt','gemini','google_ai_mode'];
const competitors=['FlowNest','TaskLoom','NimbleDesk'];
function row(q,index,channel,channelIndex){
 const branded=q[1]==='branded',appeared=branded||((index+channelIndex)%3!==0),recommended=!branded&&appeared&&(index+channelIndex)%2===0;
 const listedPosition=appeared?((index+channelIndex)%3)+1:null;
 const intro=branded
  ?`${subject}は、案件・顧客対応・社内申請を一つの画面で管理できる架空のノーコード業務サービスです。`
  :appeared
   ?`候補としてはFlowNest、${subject}、TaskLoomなどが考えられます。`
   :'候補としてはFlowNest、TaskLoom、NimbleDeskなどが考えられます。';
 const detail=branded?'公式情報ではテンプレートから運用を始められる点と、外部サービス連携が案内されています。一方、実際の導入工数や自社業務との適合は、無料試用と見積条件を確認する必要があります。':'少人数での開始しやすさ、権限設定、既存データの移行方法を比較してください。チーム構成や必要な連携機能によって適する候補は変わります。';
 return {channel,appeared,recommended,listedPosition,aiRank:recommended&&listedPosition===1?1:null,answer:`## 回答\n\n${intro}\n\n${detail}\n\n### 比較するときの確認点\n\n1. 初期設定に必要な時間\n2. 利用人数に応じた料金\n3. 既存ツールとの連携`,competitors:branded?[]:competitors.filter((_,i)=>i!==channelIndex),sources:[sourceCatalog[(index+channelIndex)%sourceCatalog.length].url,sourceCatalog[0].url],strengths:branded?['テンプレートから始められる','複数部署の情報をまとめられる']:[],informationGaps:branded?['実際の移行工数','個別要件を含む総費用']:[],comment:index===1&&channelIndex===2?'AIによって候補の並びと参照元に差がありました。':''};
}
const queries=definitions.map((q,index)=>({id:q[0],kind:q[1],intent:q[2],query:q[3],selection_reason:'公式サイトの利用場面と、導入前によく比較される条件をもとに選定した架空質問です。',measurement_purpose:'同じ検討場面で、対象サービスが候補または判断材料として示されるかを確認します。',channels:channels.map((c,ci)=>row(q,index,c,ci))}));
globalThis.MADOHA_PUBLIC_SAMPLE={schemaVersion:'paid-report-sample-v2',sample:true,subject:{entity_type:'product',name:subject,official_url:'https://lumo-flow.example/',area:'地域指定なし',category:'ノーコード業務管理SaaS'},measurement:{snapshotDate:'2026-09-26',channelCount:3,resultCount:30,queryCount:10,mode:'商品表示確認用の架空データ'},queries,sources:sourceCatalog,actions:[{target:'公式サイトの導入情報を整理する',change:'利用人数・初期設定・移行条件を、AIが参照しやすい形で明示する選択肢があります。'},{target:'第三者情報を確認する',change:'比較記事やレビューで、説明が公式情報と一致しているか確認する選択肢があります。'},{target:'不足する事例を補う',change:'代表的な利用場面について、確認可能な導入事例を補う選択肢があります。'}],reliabilityNotice:'このページは架空企業の完成版サンプルです。企業・回答・競合・参照元は商品表示確認用に作成したもので、実際のAI測定結果ではありません。'};
})();
