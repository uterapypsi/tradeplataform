/* Executado automaticamente pelo Netlify apenas no deploy publicado.
   Cron UTC de hora a hora. Ativa apenas com GOLDBOT_V2_ENABLED=true.
   NÃO envia ordens nem liga a corretoras. */
import {getStore} from '@netlify/blobs';
import {advancePaperState,initialState} from '../lib/goldbot-core.mjs';
import {fetchGoldSeries,fetchHeadlines,readEnv} from '../lib/goldbot-services.mjs';

export const config = {schedule: '15 * * * *'}; // hora a hora, ao minuto 15 UTC
export default async () => {
  if (readEnv('GOLDBOT_V2_ENABLED') !== 'true') {
    console.log('GoldBot 2.0 desativado; não foram feitas consultas.');
    return;
  }
  const store = getStore({name:'goldbot-v2',consistency:'strong'});
  const control = await store.get('control',{type:'json'});
  if (control?.enabled !== true) {
    console.log('GoldBot pausado no painel; nenhuma análise executada.');
    return;
  }
  const prior = await store.getWithMetadata('paper-state',{type:'json'});
  const oldState = prior?.data || initialState();
  const now = new Date().toISOString();
  let bars, headlines=[], newsAvailable=true;
  // Falhar fechado em ausência de preços; nunca substituir por preços fictícios.
  try {bars = await fetchGoldSeries(readEnv('TWELVE_DATA_API_KEY'));}
  catch (error) {console.error('GoldBot: preços indisponíveis:', error.message); return;}
  try {headlines = await fetchHeadlines();}
  catch(error) { newsAvailable=false; console.warn('GoldBot: manchetes indisponíveis:',error.message);}
  const next = advancePaperState(oldState,{series:bars,news:headlines,newsAvailable,now});
  // Escrita condicional reduz perdas por concorrência acidental. Não é uma BD transacional.
  const result = await store.setJSON('paper-state',next,prior?.etag
    ? {onlyIfMatch:prior.etag} : {onlyIfNew:true});
  if (!result.modified) {
    console.warn('GoldBot: atualização concorrente; ciclo descartado em segurança.');
    return;
  }
  console.log('GoldBot:',next.lastDecision?.action,'vela',next.lastBar,'saldo virtual',next.cash);
};
