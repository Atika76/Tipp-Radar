import shared from './_shared.js';
import sports from './_sports.js';

const {
  json,todayBudapest,apiConfigured,supabaseConfigured,getCache,putCache,savePicks,recordModelRun,filterUpcomingPicks,cacheExpiryForPicks,demoPayload,SPORT_CONFIG,MODEL_VERSION,singleFlight,claimAnalysisLock,releaseAnalysisLock
}=shared;
const {analyseSportDay}=sports;

export async function handler(event){
  const date=todayBudapest();
  const sport=String(event?.queryStringParameters?.sport||'football').toLowerCase();
  if(!SPORT_CONFIG[sport])return json(400,{error:'Ismeretlen sportág.',supported:Object.keys(SPORT_CONFIG)});
  if(!apiConfigured())return json(200,demoPayload(date,sport));
  const cacheKey=`analysis:${date}:${MODEL_VERSION}:${sport}`;
  if(supabaseConfigured()){
    const cached=await getCache(cacheKey);
    if(cached){
      const picks=filterUpcomingPicks(cached.picks);
      return json(200,{...cached,picks,persistence:true,cached:true,stalePicksRemoved:(cached.picks||[]).length-picks.length});
    }
  }
  return singleFlight(cacheKey,async()=>{
    let lock=null;
    try{
      if(supabaseConfigured()){
        const cached=await getCache(cacheKey);
        if(cached){const picks=filterUpcomingPicks(cached.picks);return json(200,{...cached,picks,persistence:true,cached:true,coalesced:true,stalePicksRemoved:(cached.picks||[]).length-picks.length});}
        lock=await claimAnalysisLock(cacheKey,120);
        if(!lock.claimed)return json(202,{sport,date,modelVersion:MODEL_VERSION,picks:[],processing:true,note:'Az elemzés már fut egy másik kérésben. Rövidesen frissítsd az oldalt.'});
      }
      const result=await analyseSportDay(sport,date);
      const picks=filterUpcomingPicks(result.picks||[]).sort((a,b)=>{
        const order={green:0,yellow:1,red:2};return (order[a.rating]??3)-(order[b.rating]??3)||(b.edge??-999)-(a.edge??-999);
      });
      const cfg=SPORT_CONFIG[sport];
      const cacheExpiresAt=cacheExpiryForPicks(picks);
      const payload={sport,sportLabel:cfg.label,sportEmoji:cfg.emoji,date,modelVersion:MODEL_VERSION,generatedAt:new Date().toISOString(),cacheExpiresAt,totalEvents:result.totalEvents||0,eligibleEvents:result.eligibleEvents||0,demo:false,persistence:supabaseConfigured(),cached:false,note:result.note||null,dataPolicy:'Csak jövőbeli, valós API-adattal rendelkező események. A becslés nem garantált eredmény.',picks};
      if(supabaseConfigured()){
        await savePicks(date,picks);
        await recordModelRun(date,sport,result,picks,{cacheKey});
        await putCache(cacheKey,payload,cacheExpiresAt);
      }
      return json(200,payload);
    }catch(e){console.error('today',sport,e);return json(500,{sport,error:e.message||'Ismeretlen hiba a sportelemzés közben.'});}
    finally{if(lock?.claimed)await releaseAnalysisLock(cacheKey,lock.ownerId);}
  });
}

export default async function today(request){
  const url=new URL(request.url);
  const result=await handler({queryStringParameters:Object.fromEntries(url.searchParams)});
  return new Response(result.body,{status:result.statusCode,headers:result.headers});
}

export const config={path:'/.netlify/functions/today',rateLimit:{windowLimit:24,windowSize:60,aggregateBy:['ip','domain']}};
