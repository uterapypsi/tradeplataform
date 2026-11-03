const CACHE='macropilot-static-v5';
const STATIC=['/','/index.html','/style.css','/app.js','/engine.js','/intelligence.js','/goldbot-v2.html','/manifest.webmanifest','/assets/icon.svg','/assets/icon-192.png','/assets/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET'||new URL(req.url).pathname.startsWith('/.netlify/'))return;
  if(req.mode==='navigate'){event.respondWith(fetch(req).catch(()=>caches.match('/index.html')));return;}
  event.respondWith(caches.match(req).then(old=>old||fetch(req)));
});
