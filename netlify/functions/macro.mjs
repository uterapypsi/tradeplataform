const fred = {
  CPI: {id:'CPIAUCSL',name:'Inflação EUA · IPC anual',unit:'%'},
  YIELD: {id:'DGS10',name:'Treasury EUA · 10 anos',unit:'%'},
  UNEMPLOYMENT: {id:'UNRATE',name:'Desemprego EUA',unit:'%'},
  FED: {id:'FEDFUNDS',name:'Taxa efetiva Fed',unit:'%'}
};
const env = (k) => (typeof Netlify !== 'undefined' && Netlify.env ? Netlify.env.get(k) : process.env[k]);
const timedFetch = async url => {const c=new AbortController(),t=setTimeout(()=>c.abort(),6000);try{const r=await fetch(url,{signal:c.signal,headers:{Accept:url.includes('data-api.ecb.europa.eu')?'text/csv':'application/json'}});if(!r.ok)throw Error('HTTP '+r.status);return r;} finally{clearTimeout(t);}};
function csvParseLine(line){return [...line.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g)].map(m=>(m[1] ?? m[2] ?? '').replaceAll('""','"'));}
export async function getECB(){
  const url='https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?lastNObservations=2&format=csvdata';
  const r=await timedFetch(url);
  const raw=await r.text();
  const lines=raw.trim().split(/\r?\n/).filter(Boolean);
  const h=csvParseLine(lines[0]);
  const iDate=h.indexOf('TIME_PERIOD'),iValue=h.indexOf('OBS_VALUE');
  if(iDate<0||iValue<0)throw Error('Formato ECB inesperado');
  const values=lines.slice(1).map(csvParseLine).map(row=>({date:row[iDate],value:Number(row[iValue])})).filter(x=>Number.isFinite(x.value)&&x.value>0).sort((a,b)=>a.date.localeCompare(b.date));
  const last=values.at(-1);
  if(!last)throw Error('Sem câmbio ECB');
  return {id:'EURUSD',name:'EUR/USD · referência BCE',value:last.value,unit:'USD/EUR',date:last.date,source:'BCE',previous:values.at(-2)?.value??null};
}
export async function getFred(kind,key){
  const info=fred[kind];
  const url=new URL('https://api.stlouisfed.org/fred/series/observations');
  url.searchParams.set('series_id',info.id);
  url.searchParams.set('api_key',key);
  url.searchParams.set('file_type','json');
  url.searchParams.set('sort_order','desc');
  url.searchParams.set('limit',kind==='CPI'?'15':'4');
  const r=await timedFetch(url);
  const j=await r.json();
  const obs=(j.observations||[]).filter(o=>Number.isFinite(Number(o.value)) && o.value !== '.');
  if(!obs.length)throw Error('Sem dados');
  let value=Number(obs[0].value), previous=null;
  if(kind==='CPI') {
    const comparison = obs.find(o => {
      const d=new Date(obs[0].date+'T00:00:00Z');d.setUTCFullYear(d.getUTCFullYear()-1);
      return o.date===d.toISOString().slice(0,10);
    });
    if (!comparison || Number(comparison.value)===0) throw Error('Histórico insuficiente');
    value=(value/Number(comparison.value)-1)*100;
  } else previous=obs.length>1?Number(obs[1].value):null;
  return {id:kind,name:info.name,value:+value.toFixed(2),unit:info.unit,date:obs[0].date,source:'FRED / Federal Reserve',previous};
}
export default async (request)=>{
  if(request.method!=='GET')return new Response('Method not allowed',{status:405});
  const items=[];
  const errors=[];
  const ecb = await Promise.allSettled([getECB()]);
  if(ecb[0].status==='fulfilled')items.push(ecb[0].value);else errors.push('Câmbio BCE indisponível');
  const key=env('FRED_API_KEY');
  if(key){
    const data=await Promise.allSettled(Object.keys(fred).map(id=>getFred(id,key)));
    data.forEach((item,i)=>{if(item.status==='fulfilled')items.push(item.value);else errors.push('FRED '+Object.keys(fred)[i]+': '+String(item.reason?.message||item.reason).slice(0,80));});
  }else errors.push('Configura FRED_API_KEY para inflação, taxa Fed, desemprego e rendimento das obrigações.');
  return Response.json({asOf:new Date().toISOString(),items,errors},
    {headers:{'Cache-Control':'public, max-age=120, s-maxage=1800','X-Content-Type-Options':'nosniff'}});
};
