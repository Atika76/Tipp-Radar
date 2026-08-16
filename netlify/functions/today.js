const {
  json,todayBudapest,apiConfigured,supabaseConfigured,getCache,putCache,savePicks,settleYesterday,demoPayload,SPORT_CONFIG
}=require('./_shared');
const { analyseSportDay }=require('./_sports');

exports.handler=async(event)=>{
  const date=todayBudapest();
  const sport=String(event?.queryStringParameters?.sport||'football').toLowerCase();
  if(!SPORT_CONFIG[sport]) return json(400,{error:'Ismeretlen sportág.',supported:Object.keys(SPORT_CONFIG)});
  if(!apiConfigured()) return json(200,demoPayload(date,sport));
  const cacheKey=`analysis:${date}:multisport-v3:${sport}`;
  if(supabaseConfigured()){
    const cached=await getCache(cacheKey);
    if(cached)return json(200,{...cached,persistence:true,cached:true});
  }
  try{
    if(supabaseConfigured() && sport==='football')await settleYesterday();
    const result=await analyseSportDay(sport,date);
    const picks=(result.picks||[]).sort((a,b)=>{
      const order={green:0,yellow:1,red:2};return (order[a.rating]??3)-(order[b.rating]??3)||(b.edge??-999)-(a.edge??-999);
    });
    const cfg=SPORT_CONFIG[sport];
    const payload={sport,sportLabel:cfg.label,sportEmoji:cfg.emoji,date,generatedAt:new Date().toISOString(),totalEvents:result.totalEvents||0,eligibleEvents:result.eligibleEvents||0,demo:false,persistence:supabaseConfigured(),cached:false,note:result.note||null,picks};
    if(supabaseConfigured()){
      await savePicks(date,picks);
      const expires=new Date(Date.now()+10*60*60*1000).toISOString();
      await putCache(cacheKey,payload,expires);
    }
    return json(200,payload);
  }catch(e){console.error('today',sport,e);return json(500,{sport,error:e.message||'Ismeretlen hiba a sportelemzés közben.'});}
};
