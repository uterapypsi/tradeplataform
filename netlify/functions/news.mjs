function decoded(s){return s.replace(/<!\[CDATA\[|\]\]>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
function tag(s,name){const m=s.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i'));return m?decoded(m[1]).trim():'';}
export function parseNews(xml){
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0,10).map((m)=>{
    const block=m[1];const link=tag(block,'link');
    const d=new Date(tag(block,'pubDate'));
    return {title:tag(block,'title').slice(0,200),url:/^https:\/\//.test(link)?link:'',published:Number.isFinite(d.getTime())?d.toISOString():null,source:tag(block,'source')||'Google News'};
  }).filter(x=>x.title&&x.url);
}
export default async (request)=>{
  if(request.method!=='GET')return new Response('Method not allowed',{status:405});
  const q='economy OR inflation OR interest rates OR gold OR stock market';
  const url='https://news.google.com/rss/search?q='+encodeURIComponent(q)+'&hl=en-US&gl=US&ceid=US:en';
  try{
    const c=new AbortController(),t=setTimeout(()=>c.abort(),6500);
    let response;
    try{response=await fetch(url,{signal:c.signal,headers:{Accept:'application/rss+xml, application/xml, text/xml'}});}finally{clearTimeout(t);}
    if(!response.ok)throw Error('HTTP '+response.status);
    const news=parseNews(await response.text());
    if(!news.length)throw Error('Sem títulos');
    return Response.json({asOf:new Date().toISOString(),source:'Google News RSS',items:news},
      {headers:{'Cache-Control':'public, max-age=120, s-maxage=900','X-Content-Type-Options':'nosniff'}});
  }catch{return Response.json({asOf:new Date().toISOString(),source:'Google News RSS',items:[],error:'Notícias indisponíveis neste momento'},
    {headers:{'Cache-Control':'public, max-age=30, s-maxage=120'}});}
};
