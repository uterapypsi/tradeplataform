/* MacroPilot Etapa 3 — leitura conservadora de manchetes.
   Classificação por regras explicáveis. Não é IA generativa nem previsão de preços. */
import {ASSETS, FACTORS, clamp} from './engine.js';

const TOPICS = [
  {id:'inflation',label:'Inflação',patterns:[/\binflation\b/g,/\bconsumer prices?\b/g,/\b\bcpi\b/g,/\binfla[cç][aã]o\b/g,/\bpre[cç]os ao consumidor\b/g]},
  {id:'rates',label:'Juros e bancos centrais',patterns:[/\binterest rates?\b/g,/\brate (?:hikes?|cuts?|decisions?)\b/g,/\b(?:fed|fomc|ecb|bce|central bank)\b/g,/\btaxas? de juro\b/g,/\bjuros\b/g]},
  {id:'dollar',label:'Dólar',patterns:[/\bdollar\b/g,/\busd\b/g,/\bd[oó]lar\b/g]},
  {id:'growth',label:'Crescimento',patterns:[/\bgdp\b/g,/\brecession\b/g,/\beconomic growth\b/g,/\bpib\b/g,/\brecess[aã]o\b/g,/\bcrescimento\b/g]},
  {id:'jobs',label:'Emprego',patterns:[/\bjobs? report\b/g,/\bunemployment\b/g,/\bpayrolls?\b/g,/\bemprego\b/g,/\bdesemprego\b/g]},
  {id:'geopolitics',label:'Geopolítica',patterns:[/\bwar\b/g,/\bconflict\b/g,/\btariffs?\b/g,/\bsanctions?\b/g,/\bgeopolitic\w*\b/g,/\bguerra\b/g,/\bconflito\b/g,/\btarifas?\b/g,/\bsan[cç][oõ]es\b/g]},
  {id:'oil',label:'Energia e petróleo',patterns:[/\boil\b/g,/\bcrude\b/g,/\bopec\b/g,/\bbrent\b/g,/\bpetr[oó]leo\b/g,/\benergia\b/g]}
];
const UP=/\b(?:rises?|rising|rose|surges?|surging|jumps?|higher|increases?|increased|gains?|gain|accelerates?|hikes?|climbs?|up|subi\w*|aument\w*|alta|acelera\w*)\b/g;
const DOWN=/\b(?:falls?|falling|fell|drops?|dropping|declines?|declining|lower|decreases?|decreased|cuts?|cutting|eases?|cooling|slows?|down|cai\w*|queda|redu\w*|cort\w*|desacelera\w*)\b/g;
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[\u2013\u2014]/g,' ');
function matchPositions(value,patterns){const positions=[];for(const p of patterns){for(const m of value.matchAll(p))positions.push(m.index||0);}return positions;}
function directionAround(text,anchors){if(!anchors.length)return 0;const ups=[...text.matchAll(UP)].map(m=>m.index||0),downs=[...text.matchAll(DOWN)].map(m=>m.index||0);
  let up=0,down=0;for(const at of anchors){if(ups.some(i=>Math.abs(i-at)<=45))up++;if(downs.some(i=>Math.abs(i-at)<=45))down++;}
  if(up&&down)return 0;return up?1:down?-1:0;
}
const nowMs=date=>{const t=new Date(date).getTime();return Number.isFinite(t)?t:NaN;};
export function analyzeHeadline(item,now=new Date()){
  const title=String(item?.title||'').trim().slice(0,220),text=normalize(title),at=nowMs(item?.published),age=nowMs(now)-at;
  const recent=Number.isFinite(age)&&age>=-3600000&&age<=48*3600000;
  const factors=TOPICS.map(topic=>{
    const positions=matchPositions(text,topic.patterns);
    return positions.length?{id:topic.id,name:topic.label,direction:directionAround(text,positions),mentionCount:positions.length}:null;
  }).filter(Boolean);
  const topics=factors.map(f=>f.id);
  const highImpact=/\b(?:fomc|fed decision|fed (?:cuts?|hikes?|holds?)|ecb decision|bce decide|cpi|nonfarm payroll|payrolls|central bank|interest rate|rate hike|rate cut|inflation report|unemployment report|war|attack|invasion|tariffs|sanctions|guerra|ataque|invasa\w*|taxas? de juro|tarifas|sancoes)\b/.test(text);
  const affected=Object.entries(ASSETS).map(([symbol,a])=>({symbol,weight:Math.max(0,...topics.map(id=>Math.abs(a.weights[id]||0)))}))
    .filter(o=>o.weight>=.55).sort((a,b)=>b.weight-a.weight).slice(0,6).map(o=>o.symbol);
  return {title,source:String(item?.source||'Fonte não identificada').slice(0,100),published:item?.published||null,url:item?.url||'',factors,topics,affected,recent,highImpact,
    classification:'Regras de palavras-chave: contexto económico possível, não causalidade nem previsão.'};
}
export function summarizeNews(items,now=new Date()){
  const seen=new Set(),headlines=[];
  for(const item of (items||[]).slice(0,40)){
    const key=normalize(item.title).replace(/[^a-z0-9]/g,'').slice(0,120);
    if(!key||seen.has(key))continue;seen.add(key);headlines.push(analyzeHeadline(item,now));
  }
  const recent=headlines.filter(x=>x.recent),indexed=Object.fromEntries(FACTORS.map(f=>[f.id,{id:f.id,label:f.name,count:0,up:0,down:0,neutral:0}]));
  for(const h of recent){for(const f of h.factors){const s=indexed[f.id];s.count++;if(f.direction>0)s.up++;else if(f.direction<0)s.down++;else s.neutral++;}}
  const ranked=Object.values(indexed).filter(x=>x.count).sort((a,b)=>b.count-a.count);
  const proposals=ranked.map(x=>{const direction=x.up>=2&&x.up>=x.down*2?1:x.down>=2&&x.down>=x.up*2?-1:0;return {id:x.id,direction,count:x.count};}).filter(x=>x.direction!==0);
  return {headlines, recentCount:recent.length,highImpact:recent.filter(x=>x.highImpact),ranked,proposals,asOf:new Date(now).toISOString(),method:'Classificação local de títulos. Sem leitura dos artigos nem validação de causalidade.'};
}
export function riskGate(symbol,items,{enabled=true,available=true,mode='live',now=new Date()}={}){
  if(!enabled)return {blocked:false,reason:'Filtro de eventos desativado pelo utilizador.'};
  if(mode==='live'&&!available)return {blocked:true,reason:'Fonte de notícias indisponível: sem novas entradas virtuais até haver contexto verificável.'};
  const nowTime=nowMs(now),analyzed=(items||[]).map(x=>x.factors?x:analyzeHeadline(x,now));
  const conflicts=analyzed.filter(h=>h.highImpact&&h.affected?.includes(symbol)&&Number.isFinite(nowMs(h.published))&&nowTime-nowMs(h.published)>=-3600000&&nowTime-nowMs(h.published)<=6*3600000);
  if(conflicts.length)return {blocked:true,reason:`Cautela: ${conflicts.length} manchete(s) de potencial impacto nas últimas 6h sobre temas ligados a ${symbol}.`,headlines:conflicts.slice(0,3)};
  return {blocked:false,reason:'Nenhum evento crítico recente identificado pelas regras.'};
}
export function decisionExplain({symbol,signal,score,macro,gate,quote}){
  return {symbol,signal,ruleScore:Number(score)||0,macroScenario:Number(macro)||0,marketSource:quote?.source||'Sem fonte',quoteAt:quote?.timestamp||null,
    permitted:!gate?.blocked&&signal==='COMPRA',
    explanation:gate?.blocked?gate.reason:`Sinal técnico ${signal}; pontuação heurística ${score}/90; cenário macro hipotético ${macro}/100.`,
    disclosure:'Pontuações e títulos não preveem retornos. Execução limitada a dinheiro virtual.'};
}
