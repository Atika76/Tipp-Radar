import shared from './_shared.js';
import daily from './_daily.js';
import {handler as analyseToday} from './today.mjs';

const {SPORT_CONFIG,MODEL_VERSION,todayBudapest,apiConfigured,supabaseConfigured,putCache,dailyCacheExpiry}=shared;
const {validDailyToken,selectTopFive}=daily;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function analyseSport(sport){
  let last={sport,statusCode:500,error:'Ismeretlen elemzési hiba.'};
  for(let attempt=1;attempt<=2;attempt++){
    const response=await analyseToday({queryStringParameters:{sport},internalScheduled:true});
    const body=JSON.parse(response.body||'{}');
    if(response.statusCode===200&&!body.degraded)return{sport,statusCode:200,payload:body,attempt};
    if(body.degraded)return{sport,statusCode:503,error:body.providerError||body.note||'Csak korábbi elemzés érhető el.',fallbackAvailable:true,attempt};
    last={sport,statusCode:response.statusCode,error:body.error||body.note||`HTTP ${response.statusCode}`,attempt};
    if(response.statusCode!==202)break;
    await sleep(2000);
  }
  return last;
}

async function mapLimited(items,limit,worker){
  const results=new Array(items.length);let cursor=0;
  async function run(){while(cursor<items.length){const index=cursor++;results[index]=await worker(items[index]);}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},run));
  return results;
}

export default async function dailyAnalysisBackground(request){
  if(request.method!=='POST')return Response.json({error:'Method not allowed'},{status:405});
  const url=new URL(request.url);const date=url.searchParams.get('date')||'';
  const token=String(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  if(date!==todayBudapest()||!validDailyToken(date,token))return Response.json({error:'Unauthorized'},{status:401});
  if(!apiConfigured()||!supabaseConfigured())return Response.json({error:'A napi elemzéshez API és Supabase beállítás szükséges.'},{status:503});

  const startedAt=new Date().toISOString();
  const results=await mapLimited(Object.keys(SPORT_CONFIG),3,analyseSport);
  const completed=results.filter(item=>item.statusCode===200);
  const failed=results.filter(item=>item.statusCode!==200);
  const topFive=selectTopFive(completed.map(item=>item.payload));
  const summary={
    ok:failed.length===0,date,modelVersion:MODEL_VERSION,startedAt,completedAt:new Date().toISOString(),
    completedSports:completed.map(item=>item.sport),failedSports:failed.map(item=>({sport:item.sport,error:item.error,statusCode:item.statusCode})),
    totalEvents:completed.reduce((sum,item)=>sum+(Number(item.payload.totalEvents)||0),0),
    eligibleEvents:completed.reduce((sum,item)=>sum+(Number(item.payload.eligibleEvents)||0),0),
    picksCount:completed.reduce((sum,item)=>sum+(item.payload.picks||[]).length,0),topFive
  };
  await putCache(`daily-summary:${date}:${MODEL_VERSION}`,summary,dailyCacheExpiry());
  console.log('daily analysis completed',JSON.stringify({date,completed:completed.length,failed:failed.length,topFive:topFive.length}));
  return Response.json(summary,{status:failed.length?207:200});
}

export const config={background:true};
