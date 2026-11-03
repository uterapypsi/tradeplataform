import {timingSafeEqual} from 'node:crypto';
import {readEnv} from './goldbot-services.mjs';
export function isAuthorized(request) {
  const expected=readEnv('GOLDBOT_V2_ADMIN_TOKEN');
  const given=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  if (!expected || expected.length<24 || !given || given.length>256) return false;
  const a=Buffer.from(given),b=Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}
export const privateJSON=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
