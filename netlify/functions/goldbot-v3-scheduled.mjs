/** DEMO only; once per weekday after the daily candle is closed. Default OFF. */
import {runScheduledDemo} from '../lib/goldbot-v3-runner.mjs';
export const config={schedule:'35 1 * * 1-5'};
export default async function(){
  try{
    const outcome=await runScheduledDemo();
    console.log('GoldBot v3 DEMO cycle:',JSON.stringify(outcome));
  }catch(e){
    // Sanitized output; never log raw broker payloads, tokens or request URLs.
    console.error('GoldBot v3 demo cycle unavailable:',String(e?.code||'UNAVAILABLE'));
  }
}
