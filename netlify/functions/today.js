const {
  json,todayBudapest,apiConfigured,supabaseConfigured,getCache,putCache,savePicks,settleRecentPicks,filterUpcomingPicks,cacheExpiryForPicks,demoPayload,SPORT_CONFIG
}=require('./_shared');
const { analyseSportDay }=require('./_sports');

exports.handler=async(event)=>{
  const date=todayBudapest();
  const sport=String(event?.queryStringParameters?.sport||'football').toLowerCase();
  if(!SPORT_CONFIG[sport]) return json(400,{error:'Ismeretlen sportág.',supported:Object.keys(SPORT_CONFIG)});
  if(!apiConfigured()) return json(200,demoPayload(date,sport));
  const cacheKey=`analysis:${date}:multisport-v5:${sport}`;
  if(supabaseConfigured() && sport==='football')await settleRecentPicks(7);
  if(supabaseConfigured()){
    const cached=await getCache(cacheKey);
    if(cached){
      const picks=filterUpcomingPicks(cached.picks);
      return json(200,{...cached,picks,persistence:true,cached:true,stalePicksRemoved:(cached.picks||[]).length-picks.length});
    }
  }
  try{
    const result=await analyseSportDay(sport,date);
    const picks=filterUpcomingPicks(result.picks||[]).sort((a,b)=>{
      const order={green:0,yellow:1,red:2};return (order[a.rating]??3)-(order[b.rating]??3)||(b.edge??-999)-(a.edge??-999);
    });
    const cfg=SPORT_CONFIG[sport];
    const cacheExpiresAt=cacheExpiryForPicks(picks);
    const payload={sport,sportLabel:cfg.label,sportEmoji:cfg.emoji,date,generatedAt:new Date().toISOString(),cacheExpiresAt,totalEvents:result.totalEvents||0,eligibleEvents:result.eligibleEvents||0,demo:false,persistence:supabaseConfigured(),cached:false,note:result.note||null,dataPolicy:'Csak jövőbeli, valós API-adattal rendelkező események. A becslés nem garantált eredmény.',picks};
    if(supabaseConfigured()){
      await savePicks(date,picks);
      await putCache(cacheKey,payload,cacheExpiresAt);
    }
    return json(200,payload);
  }catch(e){console.error('today',sport,e);return json(500,{sport,error:e.message||'Ismeretlen hiba a sportelemzés közben.'});}
};
