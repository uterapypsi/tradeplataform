/* Integração privada e conservadora com dados. Sem chamadas a corretoras. */
import {parseNews} from '../functions/news.mjs';
import {normalizeBars} from './goldbot-core.mjs';
export const readEnv = key => (typeof Netlify !== 'undefined' && Netlify.env?.get
  ? Netlify.env.get(key) : process.env[key]);
export async function fetchLimited(url, accept='application/json', timeout=7500) {
  const controller = new AbortController(), timer=setTimeout(()=>controller.abort(),timeout);
  try {
    const r = await fetch(url,{headers:{Accept:accept},signal:controller.signal});
    if (!r.ok) throw Error(`HTTP ${r.status}`);
    return r;
  } finally {clearTimeout(timer);}
}
export async function fetchGoldSeries(apiKey) {
  if (!apiKey) throw Error('TWELVE_DATA_API_KEY não configurada');
  const url = new URL('https://api.twelvedata.com/time_series');
  url.searchParams.set('symbol','XAU/USD');
  url.searchParams.set('interval','1day');
  url.searchParams.set('outputsize','90');
  url.searchParams.set('apikey',apiKey);
  const j = await (await fetchLimited(url)).json();
  if (j.status==='error'||j.code) throw Error(`Twelve Data: ${String(j.message||'sem dados').slice(0,90)}`);
  const bars = normalizeBars(j.values);
  if (bars.length<20) throw Error('Histórico da Twelve Data inferior a 20 fechos');
  return bars;
}
export async function fetchHeadlines() {
  const q='economy OR inflation OR interest rates OR gold OR stock market';
  const url='https://news.google.com/rss/search?q='+encodeURIComponent(q)+'&hl=en-US&gl=US&ceid=US:en';
  const xml=await (await fetchLimited(url,'application/rss+xml, text/xml',7000)).text();
  const news=parseNews(xml);
  if (!news.length) throw Error('Sem manchetes RSS');
  return news;
}
