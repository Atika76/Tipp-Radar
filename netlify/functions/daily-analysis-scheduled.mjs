import shared from './_shared.js';
import daily from './_daily.js';

const {todayBudapest,apiConfigured,supabaseConfigured,MODEL_VERSION}=shared;
const {dailyToken}=daily;

export default async function dailyAnalysisScheduled(request){
  const date=todayBudapest();
  if(!apiConfigured()||!supabaseConfigured())return Response.json({ok:false,error:'A napi elemzéshez API és Supabase beállítás szükséges.'},{status:503});
  const origin=(process.env.DEPLOY_PRIME_URL||process.env.URL||new URL(request.url).origin).replace(/\/$/,'');
  const response=await fetch(`${origin}/.netlify/functions/daily-analysis-background?date=${encodeURIComponent(date)}`,{
    method:'POST',headers:{authorization:`Bearer ${dailyToken(date)}`,'content-type':'application/json'}
  });
  const result={ok:response.ok,dispatched:response.status===202,date,modelVersion:MODEL_VERSION,workerStatus:response.status,dispatchedAt:new Date().toISOString()};
  console.log('daily analysis dispatched',JSON.stringify(result));
  return Response.json(result,{status:response.ok?200:502});
}
