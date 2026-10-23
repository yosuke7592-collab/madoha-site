// Identity lookup sources (Google Maps autocomplete, Knowledge Graph, gBizINFO). Run: node measurement/tests/identity-sources.test.mjs
import assert from 'node:assert/strict';
import { resolveIdentityInput, dedupeCandidates } from '../../worker/identity-resolution.mjs';
import { autocompletePlaces, getPlaceCandidate, searchPlaces } from '../../worker/place-search.mjs';
import { searchKnowledgeGraph, searchGBizInfo, searchFallbackSources } from '../../worker/identity-fallback.mjs';
import { handleSalesRequest } from '../../worker/sales-flow.mjs';

const J=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json'}});
const calls=[];
const fx=async(url,init={})=>{url=String(url);calls.push({url,init});
 if(url.includes('places:autocomplete'))return J({suggestions:[{placePrediction:{placeId:'ChIJabcdefghijk',text:{text:'ナナガーデン 浦安'},structuredFormat:{mainText:{text:'ナナガーデン'},secondaryText:{text:'千葉県浦安市'}}}},{queryPrediction:{text:{text:'x'}}}]});
 if(url.includes('/v1/places/ChIJ'))return J({id:'ChIJabcdefghijk',displayName:{text:'ナナガーデン'},formattedAddress:'日本、〒279-0002 千葉県浦安市北栄1-1',primaryTypeDisplayName:{text:'花屋'},types:['florist','store'],websiteUri:'https://nana.example/'});
 if(url.includes('places:searchText'))return J({places:[]});
 if(url.includes('kgsearch')&&!decodeURIComponent(url).includes('トヨタ'))return J({itemListElement:[]});
 if(url.includes('kgsearch'))return J({itemListElement:[{result:{'@type':['Corporation','Organization','Thing'],name:'トヨタ自動車',description:'日本の自動車メーカー',url:'https://global.toyota/'}},{result:{'@type':['Person'],name:'人物'}}]});
 if(url.includes('gbiz'))return J({'hojin-infos':[{name:'株式会社ナナガーデン',location:'千葉県浦安市北栄1-1',company_url:'https://nana.example/',business_summary:'花卉小売'},{name:'株式会社ナナガーデン',location:'北海道札幌市',company_url:''}]});
 return J({},404)};

// autocomplete
assert.equal(await autocompletePlaces({}, 'ナナ','sess-12345678',fx), null);              // no key => disabled
const env={GOOGLE_PLACES_API_KEY:'k',GBIZINFO_API_TOKEN:'t'};
const sug=await autocompletePlaces(env,'ナナガ','sess-12345678',fx);
assert.deepEqual(sug,[{place_id:'ChIJabcdefghijk',name:'ナナガーデン',detail:'千葉県浦安市'}]);
assert.deepEqual(await autocompletePlaces(env,'ナ','sess-12345678',fx),[]);               // too short
assert.deepEqual(await autocompletePlaces(env,'ナナ','bad token!',fx),[]);                // bad session
const ac=calls.find(c=>c.url.includes('autocomplete'));
assert.equal(JSON.parse(ac.init.body).sessionToken,'sess-12345678'); assert.equal(ac.init.headers['X-Goog-Api-Key'],'k');
// details
const cand=await getPlaceCandidate(env,'ChIJabcdefghijk','sess-12345678',fx);
assert.equal(cand.name,'ナナガーデン'); assert.equal(cand.identity_type,'store'); assert.equal(cand.region,'千葉県浦安市'); assert.equal(cand.official_url,'https://nana.example/');
assert.ok(calls.find(c=>c.url.includes('/places/ChIJ')).url.includes('sessionToken=sess-12345678'));
assert.equal(await getPlaceCandidate(env,'../../etc','sess-12345678',fx),null);          // id validation
// KG + gBiz
const kg=await searchKnowledgeGraph(env,'トヨタ',fx); assert.equal(kg.length,1); assert.equal(kg[0].official_url,'https://global.toyota/');
const gb=await searchGBizInfo(env,'ナナガーデン 浦安',fx); assert.equal(gb.length,1); assert.equal(gb[0].region,'千葉県浦安市'); assert.equal(gb[0].source,'gbizinfo');
assert.deepEqual(await searchGBizInfo({}, 'x',fx),[]);                                   // no token => skip
// resolve: Places empty -> fallback
let r=await resolveIdentityInput({query:'ナナガーデン 浦安'},{searchPlaces:async()=>[],searchFallback:q=>searchFallbackSources(env,q,fx)});
assert.equal(r.status,'confirmation_required'); assert.equal(r.candidates[0].source,'gbizinfo'); assert.equal(r.candidates[0].official_url,'https://nana.example/');
// resolve: nothing anywhere -> needs_details
r=await resolveIdentityInput({query:'存在しない名前'},{searchPlaces:async()=>[],searchFallback:async()=>[]});
assert.equal(r.status,'needs_details');
// dedupe: same domain from Places and gBiz
const d=dedupeCandidates([{name:'ナナガーデン',region:'浦安市',official_url:'https://nana.example/'},{name:'株式会社ナナガーデン',region:'千葉県浦安市',official_url:'https://www.nana.example/'},{name:'別店',region:'x',official_url:''}]);
assert.equal(d.length,2);
// HTTP endpoints
const mk=(path,body,ip='1.1.1.1')=>new Request('https://madoha.jp'+path,{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':ip},body:JSON.stringify(body)});
const realFetch=globalThis.fetch; globalThis.fetch=fx;
let res=await handleSalesRequest(mk('/api/sales/suggest',{input:'ナナガ',session:'sess-12345678'}),{GOOGLE_PLACES_API_KEY:'k'}); let b=await res.json();
assert.equal(res.status,200); assert.equal(b.enabled,true); assert.equal(b.suggestions.length,1);
res=await handleSalesRequest(mk('/api/sales/suggest',{input:'ナナガ',session:'sess-12345678'}),{}); b=await res.json(); assert.equal(b.enabled,false);
res=await handleSalesRequest(mk('/api/sales/place',{place_id:'ChIJabcdefghijk',session:'sess-12345678'}),{GOOGLE_PLACES_API_KEY:'k'}); b=await res.json(); assert.equal(b.candidate.name,'ナナガーデン');
res=await handleSalesRequest(mk('/api/sales/place',{place_id:'bad'}),{GOOGLE_PLACES_API_KEY:'k'}); assert.equal(res.status,404);
let limited=0; const lim={limit:async()=>({success:++limited<3})};
res=await handleSalesRequest(mk('/api/sales/suggest',{input:'ナナ',session:'sess-12345678'}),{GOOGLE_PLACES_API_KEY:'k',DIAGNOSIS_ENTRY_LIMITER:lim}); assert.equal(res.status,200);
await handleSalesRequest(mk('/api/sales/suggest',{input:'ナナ',session:'sess-12345678'}),{GOOGLE_PLACES_API_KEY:'k',DIAGNOSIS_ENTRY_LIMITER:lim});
res=await handleSalesRequest(mk('/api/sales/suggest',{input:'ナナ',session:'sess-12345678'}),{GOOGLE_PLACES_API_KEY:'k',DIAGNOSIS_ENTRY_LIMITER:lim}); assert.equal(res.status,429);
// full inspect through the endpoint: name -> fallback (Places 0 hits) with keys set
res=await handleSalesRequest(mk('/api/sales/inspect',{query:'ナナガーデン 浦安'}),{GOOGLE_PLACES_API_KEY:'k',GBIZINFO_API_TOKEN:'t'}); b=await res.json();
assert.equal(b.candidates[0].source,'gbizinfo');
// without any key: unchanged behaviour
res=await handleSalesRequest(mk('/api/sales/inspect',{query:'ナナガーデン 浦安'}),{}); b=await res.json(); assert.equal(b.status,'needs_details');
globalThis.fetch=realFetch;
console.log('ALL OK');
