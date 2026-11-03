/** MacroPilot Market API. Fontes documentadas com credenciais do proprietário.
 *  Operações virtuais apenas: este endpoint nunca envia ordens. */
export const MARKETS={
 GOLD:{remote:'XAU/USD',label:'Ouro spot · XAU/USD',unit:'USD/onça'},
 SPY:{remote:'SPY',label:'S&P 500 · ETF',unit:'USD'},
 QQQ:{remote:'QQQ',label:'Nasdaq 100 · ETF',unit:'USD'},
 AAPL:{remote:'AAPL',label:'Apple',unit:'USD'},
 NVDA:{remote:'NVDA',label:'NVIDIA',unit:'USD'},
 GLD:{remote:'GLD',label:'Ouro · ETF GLD',unit:'USD'},
 TLT:{remote:'TLT',label:'Obrigações EUA · ETF',unit:'USD'},
 OIL:{remote:'CL1!',label:'Petróleo WTI · futuro',unit:'USD/barril'},
 BTC:{remote:'BTC/USD',label:'Bitcoin',unit:'USD'},
 EURUSD:{remote:'EUR/USD',label:'Euro / Dólar',unit:'USD/EUR'}
};
const env=k=>typeof Netlify!=='undefined'&&Netlify.env?.get?Netlify.env.get(k):process.env[k];
async function requestJSON(url,headers={}){
 const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),9000);
 try{const res=await fetch(url,{headers:{Accept:'application/json',...headers},signal:ctl.signal});if(!res.ok)throw Error('HTTP '+res.status);return await res.json()}finally{clearTimeout(t)}
}
export function normalizeTwelve(data,key){
 if(data?.status==='error'||data?.code)throw Error(String(data.message||'Fornecedor sem dados').slice(0,100));
 if(!Array.isArray(data?.values))throw Error('Sem série histórica nesta conta/API');
 const series=data.values.map(x=>({t:/^\d{4}-\d{2}-\d{2}$/.test(x.datetime)?x.datetime+'T00:00:00.000Z':new Date(x.datetime+'Z').toISOString(),c:Number(x.close)})).filter(x=>Number.isFinite(x.c)&&x.c>0).sort((a,b)=>a.t.localeCompare(b.t));
 if(!series.length)throw Error('Histórico sem preços válidos');
 const price=series.at(-1).c,previous=series.at(-2)?.c??null;
 return {symbol:key,label:MARKETS[key].label,price,previous,changePct:previous?(price/previous-1)*100:null,timestamp:series.at(-1).t,series:series.slice(-120),unit:MARKETS[key].unit,source:'Twelve Data API',frequency:'Histórico diário; pode sofrer atrasos ou exigir plano de dados'};
}
async function twelve(key,apiKey){
 const url=new URL('https://api.twelvedata.com/time_series');
 url.searchParams.set('symbol',MARKETS[key].remote);url.searchParams.set('interval','1day');url.searchParams.set('outputsize','90');url.searchParams.set('apikey',apiKey);
 return normalizeTwelve(await requestJSON(url),key);
}
async function gold(){
 const j=await requestJSON('https://api.gold-api.com/price/XAU');const price=Number(j.price),previous=Number(j.prev_close_price||j.prevClosePrice)||null;
 if(!Number.isFinite(price)||price<=0)throw Error('Preço do ouro indisponível');
 return {symbol:'GOLD',label:MARKETS.GOLD.label,price,previous,changePct:previous?(price/previous-1)*100:null,timestamp:j.updatedAt||j.updated_at||null,series:[],unit:MARKETS.GOLD.unit,source:'Gold API',frequency:'Cotação indicativa sem histórico de 20 períodos — motor aguarda histórico'};
}
async function finnhub(key,apiKey){
 const j=await requestJSON('https://finnhub.io/api/v1/quote?symbol='+encodeURIComponent(key),{'X-Finnhub-Token':apiKey});
 if(!(j.c>0))throw Error('Cotação Finnhub indisponível');
 return {symbol:key,label:MARKETS[key].label,price:Number(j.c),previous:Number(j.pc)||null,changePct:Number.isFinite(j.dp)?j.dp:null,timestamp:j.t?new Date(j.t*1000).toISOString():null,series:[],unit:MARKETS[key].unit,source:'Finnhub API',frequency:'Apenas snapshot; sem histórico para gerar sinais'};
}
export default async request=>{
 if(request.method!=='GET')return new Response('Método não permitido',{status:405});
 const raw=new URL(request.url).searchParams.get('symbols')||'GOLD,SPY,QQQ,NVDA,AAPL,TLT,OIL,EURUSD';
 const symbols=[...new Set(raw.toUpperCase().split(',').map(x=>x.trim()))].filter(s=>MARKETS[s]).slice(0,10);
 if(!symbols.length)return Response.json({error:'Ativos inválidos'},{status:400});
 const key=env('TWELVE_DATA_API_KEY'),fk=env('FINNHUB_API_KEY');
 const assets=await Promise.all(symbols.map(async symbol=>{
  try{
   if(key){try{return await twelve(symbol,key)}catch(e){if(symbol!=='GOLD'&&!(fk&&['SPY','QQQ','AAPL','NVDA','GLD','TLT'].includes(symbol)))throw e}}
   if(symbol==='GOLD')return await gold();
   if(fk&&['SPY','QQQ','AAPL','NVDA','GLD','TLT'].includes(symbol))return await finnhub(symbol,fk);
   throw Error('Configura TWELVE_DATA_API_KEY no Netlify para consultar este ativo');
  }catch(e){return {symbol,label:MARKETS[symbol].label,error:String(e.message).slice(0,120)}}
 }));
 return Response.json({asOf:new Date().toISOString(),assets,notice:'Cotações indicativas, potencialmente atrasadas. Consultar termos de uso dos fornecedores.'},{headers:{'Cache-Control':'public, max-age=180, s-maxage=900','X-Content-Type-Options':'nosniff'}});
};
