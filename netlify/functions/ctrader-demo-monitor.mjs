/** Background health check every six hours, cTrader DEMO, view-only. */
import {checkAndRecord} from './ctrader-demo-status.mjs';
import {readEnv} from '../lib/goldbot-services.mjs';
export const config={schedule:'7 */6 * * *'}; // 00:07, 06:07, 12:07, 18:07 UTC
export default async function ctraderDemoMonitor(){
  if(readEnv('CTRADER_DEMO_MONITOR_ENABLED')==='false'){
    console.log('cTrader demo monitor disabled by configuration');
    return;
  }
  try{
    const result=await checkAndRecord({source:'scheduled'});
    // No tokens, no full JSON response, no private account identifiers in logs.
    console.log('cTrader DEMO monitor: OK',result.checkedAt);
  }catch(error){
    // Error messages from checkAndRecord are sanitized; no raw API responses.
    console.warn('cTrader DEMO monitor:',error.code||'UNAVAILABLE');
  }
}
