/** GoldBot v3 security policy and risk rules — deterministic, offline-testable. */
export const V3 = Object.freeze({
  demoOnly: true, riskPct: 0.5, maxExposureMultiplier: 2,
  stopPct: 2, takePct: 4, maxSpreadPct: 0.15,
  maxPriceDeviationPct: 4, minConfidence: 68, maxClients: 5,
  maxAgeQuoteMs: 90_000, maxAgeBarMs: 5*86_400_000,
});
export class V3Error extends Error {
  constructor(code, message, status=400){super(message);this.name='V3Error';this.code=code;this.status=status;}
}
export const requireV3=(condition,code,message,status)=>{
  if(!condition)throw new V3Error(code,message,status);
};
export const safeKeyId=id=>typeof id==='string'&&/^[a-f0-9]{12}$/.test(id);
export const validDemoLogin=x=>typeof x==='string'&&/^\d{5,12}$/.test(x);
export const isTradeScope=x=>x===1||x==='1'||x==='SCOPE_TRADE';
export const isDemoAccount=a=>a && (a.isLive===false||a.isLive==='false') && a.ctidTraderAccountId!=null;
export const money=(n,digits)=>Number.isInteger(Number(digits))&&Number(digits)>=0&&Number(digits)<=12
  ?Number(n)/Math.pow(10,Number(digits)):NaN;
export const lastClosedBars=(raw,now=new Date().toISOString())=>{
  const target=now.slice(0,10);
  const unique=new Map();
  for(const item of raw||[]){
    const date=String(item.t||item.datetime||'').slice(0,10),price=Number(item.c??item.close);
    if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&date<target&&price>0&&Number.isFinite(price))
      unique.set(date,{t:`${date}T00:00:00.000Z`,c:price});
  }
  const bars=[...unique.values()].sort((a,b)=>a.t.localeCompare(b.t));
  const last=bars.at(-1),age=last?Date.parse(now)-Date.parse(last.t):Infinity;
  requireV3(bars.length>=20,'NO_BARS','Histórico insuficiente para a estratégia.');
  requireV3(age>=0&&age<=V3.maxAgeBarMs,'OLD_BAR','Sem vela diária fechada recente.');
  return bars;
};
export function sizeDemoBuy({balance,currency,eurUsd,ask,bid,close,volMin,volMax,volStep,limitedRisk=false,tradable=true}){
  requireV3(!limitedRisk,'LIMITED_RISK','Conta com proteção especial: revisão manual obrigatória.');
  requireV3(tradable===true,'SYMBOL_CLOSED','Instrumento sem permissão de negociação.');
  requireV3(currency==='EUR'||currency==='USD','CURRENCY','Apenas contas demo EUR ou USD nesta versão.');
  for(const [k,x] of Object.entries({balance,ask,bid,close,volMin,volMax,volStep}))
    requireV3(Number.isFinite(x)&&x>0,'INVALID_'+k.toUpperCase(),'Dados essenciais do broker ausentes ou inválidos.');
  requireV3(balance>=100,'BALANCE','Saldo demo insuficiente para esta estratégia.');
  requireV3(ask>bid,'QUOTE','Cotação bid/ask inválida.');
  requireV3((ask-bid)/ask*100<=V3.maxSpreadPct,'SPREAD','Spread elevado: operação bloqueada.');
  requireV3(Math.abs(ask-close)/close*100<=V3.maxPriceDeviationPct,'DEVIATION','Cotação distante do fecho diário; sem operações.');
  requireV3(Number.isSafeInteger(volMin)&&Number.isSafeInteger(volMax)&&Number.isSafeInteger(volStep),'VOLUME','Volume do instrumento inválido.');
  requireV3(volMin<=volMax,'VOLUME','Restrições de volume inconsistentes.');
  const fx=currency==='EUR'?eurUsd:1;
  requireV3(Number.isFinite(fx)&&fx>=0.75&&fx<=1.6,'FX','Taxa EUR/USD indisponível ou fora da faixa segura.');
  // Converting account currency to XAUUSD quote. 25% reserve for slip, conversion drift and fees.
  const budgetUsd=balance*(V3.riskPct/100)*fx*.75;
  const riskPerUnitUsd=ask*(V3.stopPct/100);
  // cTrader volume integer counts hundredths of units (e.g. 100 = 1 unit).
  const rawCents=Math.floor(budgetUsd/riskPerUnitUsd*100);
  const maxExposureCents=Math.floor((balance*fx*V3.maxExposureMultiplier/ask)*100);
  const capped=Math.min(rawCents,maxExposureCents,volMax);
  const cents=Math.floor(capped/volStep)*volStep;
  requireV3(cents>=volMin&&cents>0,'MIN_VOLUME','Volume mínimo do broker ultrapassa o limite de risco. Nenhuma ordem enviada.');
  const units=cents/100;
  const estimatedLossUsd=units*riskPerUnitUsd;
  requireV3(estimatedLossUsd<=budgetUsd+0.00001,'RISK_CAP','Risco superior ao limite.');
  return {
    volume:cents,units,accountCurrency:currency,
    approxRiskAccountCurrency:estimatedLossUsd/fx,
    riskPercent:V3.riskPct,
    relativeStopLoss:Math.round(ask*V3.stopPct/100*100000),
    relativeTakeProfit:Math.round(ask*V3.takePct/100*100000),
    limitLossAccountCurrency:balance*V3.riskPct/100,
  };
}
export function evaluateSignal({bars,tech,newsAllowed,newsReason}){
  requireV3(Array.isArray(bars)&&bars.length>=20,'NO_BARS','Sem histórico suficiente.');
  const bar=bars.at(-1);
  const date=bar?.t?.slice(0,10);
  requireV3(/^\d{4}-\d{2}-\d{2}$/.test(date||''),'BAD_DATE','Data da vela inválida.');
  if(!newsAllowed)return {action:'WAIT',reason:newsReason||'Notícias não validadas',date};
  if(tech?.signal!=='COMPRA'||!(Number(tech.confidence)>=V3.minConfidence))
    return {action:'WAIT',reason:`Sem sinal confirmado (${tech?.signal||'NEUTRO'}, ${Number(tech?.confidence)||0} pontos).`,date};
  return {action:'BUY',reason:'SMA5/20 e RSI14 com bloqueio de notícias aplicado',date};
}
export function canArm({user,globalEnabled,connected,scope}){
  requireV3(user?.active===true,'REVOKED','Utilizador revogado.',403);
  requireV3(globalEnabled===true,'MASTER_OFF','Execução demo desativada pelo administrador.');
  requireV3(connected===true,'NOT_LINKED','Liga primeiro uma conta cTrader Demo.');
  requireV3(isTradeScope(scope),'VIEW_ONLY','Autoriza a permissão oficial de negociação demo.');
  requireV3(user?.account?.isLive===false,'LIVE_BLOCK','Contas reais são proibidas nesta versão.');
  return true;
}
