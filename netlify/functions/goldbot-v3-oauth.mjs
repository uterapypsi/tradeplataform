/** cTrader OAuth callback: session in short-lived HttpOnly Lax cookie, NOT browser storage. */
import {consumeOAuth,getTenant,v3ErrorResponse} from '../lib/goldbot-v3-store.mjs';
import {exchangeCode,linkTenantDemo} from '../lib/goldbot-v3-runner.mjs';
import {V3Error,requireV3} from '../lib/goldbot-v3-policy.mjs';
export default async function goldbotV3OAuth(req){
  const clear='gb_v3_oauth=; Max-Age=0; HttpOnly; Secure; SameSite=Lax; Path=/.netlify/functions/goldbot-v3-oauth';
  if(req.method!=='GET')return new Response('Método não permitido',{status:405});
  try{
    const code=new URL(req.url).searchParams.get('code');
    requireV3(code,'NO_CODE','Autorização cancelada.',400);
    const cookie=String(req.headers.get('cookie')||'');
    const nonce=cookie.match(/(?:^|;\s*)gb_v3_oauth=([A-Za-z0-9_-]{32})(?:;|$)/)?.[1];
    const flow=await consumeOAuth(nonce);
    const user=await getTenant(flow.uid);
    requireV3(user?.active===true,'REVOKED','Chave revogada; ligação cancelada.',403);
    // cTrader auth code expires in ~60 seconds; immediately exchange server-side.
    const redirectUri='https://tradeplataform.netlify.app/.netlify/functions/goldbot-v3-oauth';
    const pair=await exchangeCode(code,redirectUri);
    await linkTenantDemo({uid:user.id,login:flow.login,pair});
    return new Response(null,{status:303,headers:{Location:'/goldbot-v3.html?connection=ok','Set-Cookie':clear,'Referrer-Policy':'no-referrer','Cache-Control':'no-store'}});
  }catch(error){
    // Do not render OAuth code/tokens or include sensitive data in redirect URLs.
    const code=error instanceof V3Error?error.code:'UNAVAILABLE';
    return new Response(null,{status:303,headers:{Location:'/goldbot-v3.html?connection=failed&reason='+encodeURIComponent(code),
      'Set-Cookie':clear,'Referrer-Policy':'no-referrer','Cache-Control':'no-store'}});
  }
}
