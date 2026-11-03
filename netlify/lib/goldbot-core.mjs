/* GoldBot AI 2.0: motor determinístico de simulação, sem acesso a corretoras.
   Usa velas DIÁRIAS; stops e alvos são verificados apenas quando há um fecho novo.
   O estado é independente da carteira virtual local do MacroPilot 1.1. */
import { evaluate, positionSizing } from '../../public/engine.js';
import { riskGate, summarizeNews } from '../../public/intelligence.js';

export const BOT_DEFAULTS = Object.freeze({
  startCash: 10000, riskPct: 0.5, stopPct: 2, takePct: 4,
  dailyLossPct: 2, minConfidence: 68, maxPositions: 1,
  slippagePct: 0.05, feePct: 0.1
});
const n2 = value => Math.round(value * 100) / 100;
export const initialState = () => ({
  version: 2, currency: 'USD', cash: BOT_DEFAULTS.startCash,
  startCash: BOT_DEFAULTS.startCash, positions: [], trades: [], events: [],
  lastBar: null, lastRunAt: null, lastPrice: null, lastDecision: null,
  checks: 0
});
function append(state, at, action, detail) {
  const event = {at, action, detail: String(detail).slice(0, 340)};
  state.events = [event, ...(state.events || [])].slice(0, 100);
  state.lastDecision = event;
}
export function normalizeBars(values) {
  const unique = new Map();
  for (const v of Array.isArray(values) ? values : []) {
    const date = String(v.t || v.datetime || '').slice(0, 10);
    const price = Number(v.c ?? v.close);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(price) && price > 0) {
      unique.set(date, {t: `${date}T00:00:00.000Z`, c: price});
    }
  }
  return [...unique.values()].sort((a,b) => a.t.localeCompare(b.t)).slice(-120);
}
function realizedToday(trades, at) {
  const today = at.slice(0, 10);
  return trades.filter(t => t.side === 'VENDA' && t.at.slice(0, 10) === today)
    .reduce((sum, t) => sum + t.pnl, 0);
}
function marketEquity(state, price) {
  return state.cash + state.positions.reduce((sum, p) => sum + p.qty * price, 0);
}
function recentBar(bar, now) {
  const dt = Date.parse(bar.t), age = Date.parse(now) - dt;
  // Evitar operar sobre uma vela diária demasiado antiga ou com data futura.
  return Number.isFinite(age) && age >= 0 && age <= 5 * 86400000;
}
export function advancePaperState(previous, {series, news, now = new Date().toISOString(), newsAvailable = true}, risk = {}) {
  const cfg = {...BOT_DEFAULTS, ...risk};
  const state = structuredClone(previous && previous.version === 2 ? previous : initialState());
  state.checks = (Number(state.checks) || 0) + 1;
  state.lastRunAt = now;
  // Excluir a vela de hoje: a série diária pode ainda estar em formação.
  const bars = normalizeBars(series).filter(b => b.t.slice(0,10) < now.slice(0,10));
  if (bars.length < 20) {
    append(state, now, 'SEM_DADOS', `Histórico insuficiente (${bars.length}/20). Não realizar operações.`);
    return state;
  }
  const bar = bars.at(-1), date = bar.t.slice(0, 10), price = bar.c;
  state.lastPrice = {symbol:'GOLD', value:price, date, source:'Twelve Data API · fecho diário'};
  if (!recentBar(bar, now)) {
    append(state, now, 'DADOS_ANTIGOS', `Fecho ${date} demasiado antigo ou futuro; sem operações.`);
    return state;
  }
  if (state.lastBar === date) {
    append(state, now, 'SEM_NOVA_VELA', `Fecho ${date} já avaliado. Não duplicar decisões.`);
    return state;
  }
  state.lastBar = date;
  // Preços de saída usam fecho diário + slippage: NÃO são stops reais de mercado.
  for (const pos of [...state.positions]) {
    if (price <= pos.stop || price >= pos.target) {
      const execution = price * (1 - cfg.slippagePct / 100);
      const fee = execution * pos.qty * cfg.feePct / 100;
      const revenue = execution * pos.qty - fee;
      const pnl = n2(revenue - pos.cost);
      state.cash = n2(state.cash + revenue);
      state.trades.unshift({id:`GOLD-${date}-SELL`, at:now, side:'VENDA', symbol:'GOLD',
        qty:pos.qty, price:n2(execution), pnl,
        reason:price <= pos.stop ? 'Stop virtual ao fecho diário' : 'Alvo virtual ao fecho diário'});
      state.positions = state.positions.filter(p=>p.id !== pos.id);
      append(state, now, 'VENDA_VIRTUAL', `Fecho ${date}: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USD de resultado virtual líquido.`);
      // Conservar intervalo entre saída e nova entrada, ainda que apareça um sinal.
      return trim(state);
    }
  }
  const floatingLoss = state.positions.reduce((sum,p)=>sum + Math.min(0,(price * p.qty - p.cost)),0);
  if (realizedToday(state.trades,now) + floatingLoss <= -state.startCash * cfg.dailyLossPct/100) {
    append(state,now,'LIMITE_PERDA','Limite de perda diária atingido; entradas virtuais suspensas.');
    return trim(state);
  }
  if (state.positions.length >= cfg.maxPositions) {
    append(state,now,'POSICAO_ABERTA','Aguardar stop/alvo da posição virtual atual.');
    return trim(state);
  }
  const tech = evaluate('GOLD',bars,{});
  const newsSummary = summarizeNews(Array.isArray(news)?news:[],new Date(now));
  const gate = riskGate('GOLD',news,{enabled:true,available:Boolean(newsAvailable)&&newsSummary.recentCount>0,mode:'live',now:new Date(now)});
  if (gate.blocked) {
    append(state,now,'BLOQUEIO_NOTICIAS',gate.reason);
    return trim(state);
  }
  if (tech.signal !== 'COMPRA' || tech.confidence < cfg.minConfidence) {
    append(state,now,'AGUARDAR',`GOLD: ${tech.signal}; pontuação ${tech.confidence}/90. ${tech.reason}`);
    return trim(state);
  }
  // Simulação sem margem nem alavancagem. Com custos de compra explícitos.
  const execution = price * (1 + cfg.slippagePct / 100);
  const sized = positionSizing({cash:state.cash,equity:marketEquity(state,price),riskPct:cfg.riskPct,
    stopPct:cfg.stopPct,price:execution});
  const qty = Math.floor(Math.min(sized.qty, state.cash / (execution * (1 + cfg.feePct / 100))) * 100000)/100000;
  if (!(qty>0) || qty * execution < 1) {
    append(state,now,'RISCO','Sinal encontrado, mas saldo ou limites insuficientes para compra virtual.');
    return trim(state);
  }
  const cost = execution * qty * (1 + cfg.feePct / 100);
  state.cash = n2(state.cash-cost);
  const pos={id:`GOLD-${date}-BUY`,symbol:'GOLD',at:now,qty,entry:execution,cost:n2(cost),
    stop:execution*(1-cfg.stopPct/100),target:execution*(1+cfg.takePct/100)};
  state.positions.push(pos);
  state.trades.unshift({id:pos.id,at:now,side:'COMPRA',symbol:'GOLD',qty,price:n2(execution),
    reason:'SMA5/20 + RSI14; notícias verificadas; só conta virtual'});
  append(state,now,'COMPRA_VIRTUAL',`GOLD: compra virtual ${qty} a ${execution.toFixed(2)} USD; pontuação ${tech.confidence}/90.`);
  return trim(state);
}
function trim(state) {
  state.trades = state.trades.slice(0, 100);
  state.events = state.events.slice(0, 100);
  return state;
}
