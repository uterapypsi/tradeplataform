import {test} from 'node:test';
import assert from 'node:assert/strict';
import marketHandler,{normalizeTwelve} from '../netlify/functions/market.mjs';
import {getECB} from '../netlify/functions/macro.mjs';
import {parseNews} from '../netlify/functions/news.mjs';
test('conversor de série usa valores recebidos do fornecedor',()=>{
 const q=normalizeTwelve({values:[{datetime:'2026-11-03',close:'101.3'},{datetime:'2026-11-02',close:'100.1'}]},'SPY');
 assert.equal(q.price,101.3);assert.equal(q.series.length,2);assert.ok(q.source.includes('Twelve Data'));
});
test('API de mercado bloqueia símbolos não previstos',async()=>{
 const r=await marketHandler(new Request('https://example.net/.netlify/functions/market?symbols=DROP_TABLE'));
 assert.equal(r.status,400);
});
test('API de ouro interpreta o snapshot sem inventar histórico',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({symbol:'XAU',price:3988.21,updatedAt:'2026-11-03T08:00:00Z'});
 try{
  const r=await marketHandler(new Request('https://example.net/.netlify/functions/market?symbols=GOLD'));
  const {assets}=await r.json();assert.equal(assets[0].price,3988.21);assert.equal(assets[0].series.length,0);assert.ok(assets[0].source.includes('Gold API'));
 }finally{globalThis.fetch=original}
});
test('BCE: parse de CSV com data e câmbio de referência',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response('KEY,TIME_PERIOD,OBS_VALUE\nfoo,2026-11-02,1.1512\nbar,2026-11-03,1.1563\n');
 try{const x=await getECB();assert.equal(x.value,1.1563);assert.equal(x.date,'2026-11-03');assert.equal(x.previous,1.1512)}finally{globalThis.fetch=original}
});
test('RSS não inclui links sem https',()=>{
 const xml='<rss><channel><item><title>Política monetária &amp; mercados</title><link>https://example.org/abc</link><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate></item><item><title>Malicioso</title><link>javascript:alert(1)</link></item></channel></rss>';
 const items=parseNews(xml);assert.equal(items.length,1);assert.equal(items[0].title,'Política monetária & mercados');
});
