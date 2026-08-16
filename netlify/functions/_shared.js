const TZ = 'Europe/Budapest';
const MODEL_VERSION = 'v6.0.1';
const inFlight = new Map();

const SPORT_CONFIG = {
  football:   { code:1, label:'Foci', emoji:'⚽', base:'https://v3.football.api-sports.io', endpoint:'fixtures', idParam:'fixture', draw:true },
  basketball: { code:2, label:'Kosárlabda', emoji:'🏀', base:'https://v1.basketball.api-sports.io', endpoint:'games', idParam:'game', draw:false },
  hockey:     { code:3, label:'Jégkorong', emoji:'🏒', base:'https://v1.hockey.api-sports.io', endpoint:'games', idParam:'game', draw:true },
  nfl:        { code:4, label:'NFL', emoji:'🏈', base:'https://v1.american-football.api-sports.io', endpoint:'games', idParam:'game', draw:false },
  baseball:   { code:5, label:'Baseball', emoji:'⚾', base:'https://v1.baseball.api-sports.io', endpoint:'games', idParam:'game', draw:false },
  handball:   { code:6, label:'Kézilabda', emoji:'🤾', base:'https://v1.handball.api-sports.io', endpoint:'games', idParam:'game', draw:true },
  volleyball: { code:7, label:'Röplabda', emoji:'🏐', base:'https://v1.volleyball.api-sports.io', endpoint:'games', idParam:'game', draw:false },
  mma:        { code:8, label:'MMA', emoji:'🥊', base:'https://v1.mma.api-sports.io', endpoint:'fights', idParam:'fight', draw:false },
  formula1:   { code:9, label:'F1', emoji:'🏎️', base:'https://v1.formula-1.api-sports.io', endpoint:'races', idParam:'race', draw:false }
};

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
    body: JSON.stringify(body)
  };
}

function todayBudapest() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
}

function dateDaysAgoBudapest(days=1,from=new Date()) {
  const now = new Date(from);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(now);
  const y = Number(parts.find(x => x.type === 'year').value);
  const m = Number(parts.find(x => x.type === 'month').value);
  const d = Number(parts.find(x => x.type === 'day').value);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() - Math.max(0,Number(days)||0));
  return utc.toISOString().slice(0,10);
}

function yesterdayBudapest() { return dateDaysAgoBudapest(1); }

function apiKey() { return process.env.API_SPORTS_KEY || process.env.API_FOOTBALL_KEY || ''; }
function apiConfigured() { return Boolean(apiKey()); }
function supabaseConfigured() { return Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)); }
function supabaseKey() { return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''; }

async function sportApi(sport, path, params = {}) {
  const cfg = SPORT_CONFIG[sport];
  if (!cfg) throw new Error(`Ismeretlen sport: ${sport}`);
  if (!apiConfigured()) throw new Error('API_FOOTBALL_KEY / API_SPORTS_KEY nincs beállítva.');
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k,v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, String(v)); });
  const url = `${cfg.base}/${path}${qs.size ? '?' + qs.toString() : ''}`;
  const res = await fetch(url, { headers: { 'x-apisports-key': apiKey(), 'accept':'application/json' } });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${cfg.label} API HTTP ${res.status}`);
  if (payload.errors && (typeof payload.errors === 'string' ? payload.errors : Object.keys(payload.errors).length)) {
    const msg = typeof payload.errors === 'string' ? payload.errors : Object.values(payload.errors).flat().join('; ');
    throw new Error(`${cfg.label} API: ${msg}`);
  }
  return { response: payload.response || [], paging: payload.paging || null, parameters: payload.parameters || {}, raw: payload };
}

async function football(path, params={}) { return (await sportApi('football',path,params)).response; }

function supaHeaders(extra = {}) {
  const key = supabaseKey();
  const headers = { 'apikey': key, 'content-type':'application/json', ...extra };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function supa(path, options = {}) {
  if (!supabaseConfigured()) throw new Error('Supabase nincs beállítva.');
  const base = process.env.SUPABASE_URL.replace(/\/$/,'');
  const res = await fetch(`${base}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers: supaHeaders(options.headers || {}),
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

async function supaRpc(name,body={}) {
  return supa(`rpc/${encodeURIComponent(name)}`,{method:'POST',body});
}

async function getCache(cacheKey) {
  if (!supabaseConfigured()) return null;
  try {
    const rows = await supa(`app_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=payload,expires_at&limit=1`);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;
    if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
    return row.payload || null;
  } catch (e) { console.error('cache read', e.message); return null; }
}

async function putCache(cacheKey, payload, expiresAt) {
  if (!supabaseConfigured()) return;
  try {
    await supa('app_cache?on_conflict=cache_key', {
      method:'POST', headers:{ 'Prefer':'resolution=merge-duplicates,return=minimal' },
      body:[{ cache_key:cacheKey, payload, expires_at:expiresAt || null, updated_at:new Date().toISOString() }]
    });
  } catch (e) { console.error('cache write', e.message); }
}

async function cachedSportCall(sport, cacheKey, path, params, ttlMinutes=720) {
  const fullKey = `api:${sport}:${cacheKey}`;
  const cached = await getCache(fullKey);
  if (cached) return cached;
  const result = (await sportApi(sport,path,params)).response;
  if (supabaseConfigured()) {
    const expires = new Date(Date.now()+ttlMinutes*60000).toISOString();
    await putCache(fullKey,result,expires);
  }
  return result;
}

function singleFlight(key,work) {
  if(inFlight.has(key))return inFlight.get(key);
  const promise=Promise.resolve().then(work).finally(()=>inFlight.delete(key));
  inFlight.set(key,promise);
  return promise;
}

async function claimAnalysisLock(lockKey,ttlSeconds=90) {
  if(!supabaseConfigured())return {claimed:true,ownerId:'local'};
  const ownerId=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try{
    const claimed=await supaRpc('claim_analysis_lock',{p_lock_key:lockKey,p_owner_id:ownerId,p_ttl_seconds:ttlSeconds});
    return {claimed:claimed===true,ownerId};
  }catch(e){console.error('analysis lock',e.message);return {claimed:true,ownerId:null};}
}

async function releaseAnalysisLock(lockKey,ownerId) {
  if(!supabaseConfigured()||!ownerId)return;
  try{await supaRpc('release_analysis_lock',{p_lock_key:lockKey,p_owner_id:ownerId});}catch(e){console.error('analysis unlock',e.message);}
}

function parsePercent(value) {
  if (value === null || value === undefined) return null;
  const n = Number(String(value).replace('%','').replace(',','.'));
  return Number.isFinite(n) ? n : null;
}
function median(arr) { const xs=arr.map(Number).filter(Number.isFinite).sort((a,b)=>a-b); if(!xs.length)return null; const m=Math.floor(xs.length/2); return xs.length%2?xs[m]:(xs[m-1]+xs[m])/2; }
function mean(arr) { const xs=arr.map(Number).filter(Number.isFinite); return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null; }
function clamp(n,min,max){ return Math.max(min,Math.min(max,n)); }
function normalCdf(x) { // Abramowitz-Stegun approximation
  const t=1/(1+0.2316419*Math.abs(x));
  const d=0.3989423*Math.exp(-x*x/2);
  let p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));
  p=1-p; return x>=0?p:1-p;
}
function normalize2(a,b){ const x=Math.max(.001,Number(a)||0), y=Math.max(.001,Number(b)||0), s=x+y; return {home:x*100/s,away:y*100/s}; }
function normalize3(a,d,b){ const vals=[a,d,b].map(v=>Math.max(.001,Number(v)||0)); const s=vals.reduce((x,y)=>x+y,0); return {home:vals[0]*100/s,draw:vals[1]*100/s,away:vals[2]*100/s}; }

function syntheticId(sport, sourceId) {
  const code=SPORT_CONFIG[sport]?.code || 0;
  const id=Number(sourceId);
  if (!Number.isFinite(id)) return code*1000000000000 + Math.abs(hashCode(String(sourceId)))%999999999999;
  return code*1000000000000 + Math.abs(Math.trunc(id))%999999999999;
}
function sourceIdFromSynthetic(sport, id) { return Number(id) % 1000000000000; }
function hashCode(str){ let h=0; for(let i=0;i<str.length;i++) h=((h<<5)-h)+str.charCodeAt(i)|0; return h; }

function parseSportTag(text='') { const m=String(text).match(/\[sport:([a-z0-9-]+)\]/i); return m?m[1]:'football'; }
function withSportTag(sport,text='') { return `[sport:${sport}]${text?` ${text}`:''}`; }

async function savePicks(date,picks) {
  if (!supabaseConfigured()) return;
  // Csak olyan piacot mentunk, amelyet kesobb ugyanazzal a rendszerrel le is tudunk zarni.
  const recommended=(picks||[]).filter(p=>(p.rating==='green' || p.rating==='yellow') && !['mma','formula1'].includes(p.sport) && isFutureKickoff(p.kickoff));
  if (!recommended.length) return;
  const rows=recommended.map(p=>({
    fixture_id:p.fixtureId, pick_date:date, league:p.league||p.eventName||p.sportLabel, country:p.country||p.sportLabel,
    home_team:p.home||p.participantA||p.eventName||p.sportLabel, away_team:p.away||p.participantB||'—', kickoff:p.kickoff,
    recommendation:p.recommendation, market:p.market, probability:p.probability, fair_odds:p.fairOdds, market_odds:p.marketOdds,
    edge:p.edge, rating:p.rating, probabilities:p.probabilities||{}, injuries:p.injuries||{},
    api_advice:withSportTag(p.sport,p.apiAdvice||p.modelName||''), coverage:p.coverage, reasons:p.reasons||[],
    model_version:MODEL_VERSION, model_family:p.modelName||null, data_quality:p.dataQuality??null, market_period:p.marketPeriod||'full',
    evidence:p.evidence||p.modelData||{}, updated_at:new Date().toISOString()
  }));
  try {
    await supa('picks?on_conflict=fixture_id,pick_date', {method:'POST',headers:{'Prefer':'resolution=merge-duplicates,return=minimal'},body:rows});
  } catch(e) { console.error('save picks',e.message); }
}

async function recordModelRun(date,sport,result,picks,metadata={}) {
  if(!supabaseConfigured())return;
  const generatedAt=new Date().toISOString();
  const body={run_id:`${MODEL_VERSION}:${date}:${sport}:${generatedAt}`,model_version:MODEL_VERSION,sport,run_date:date,generated_at:generatedAt,
    total_events:Number(result?.totalEvents)||0,eligible_events:Number(result?.eligibleEvents)||0,picks_count:(picks||[]).length,
    green_count:(picks||[]).filter(p=>p.rating==='green').length,yellow_count:(picks||[]).filter(p=>p.rating==='yellow').length,metadata};
  try{await supa('model_runs',{method:'POST',headers:{Prefer:'return=minimal'},body});}catch(e){console.error('model run',e.message);}
}

function scoreFromGame(raw,side) {
  const candidates=[raw?.scores?.[side]?.total,raw?.scores?.[side]?.points,raw?.scores?.[side],raw?.goals?.[side],raw?.score?.[side],raw?.results?.[side]];
  for(const v of candidates){ const n=Number(v); if(Number.isFinite(n)) return n; }
  return null;
}

function rawGameId(raw){ return raw?.id ?? raw?.game?.id ?? raw?.fixture?.id ?? raw?.fight?.id ?? raw?.race?.id; }

function isFinished(raw) {
  const s=String(raw?.status?.short ?? raw?.status?.long ?? raw?.status ?? raw?.fixture?.status?.short ?? '').toLowerCase();
  return /ft|finished|after|aet|pen|final|completed|ended|closed/.test(s);
}

function resultFromRaw(raw) {
  const h=scoreFromGame(raw,'home'), a=scoreFromGame(raw,'away');
  if(Number.isFinite(h)&&Number.isFinite(a)) return {home:h,away:a};
  return null;
}

function regulationResultFromRaw(raw) {
  const directHome=Number(raw?.score?.fulltime?.home ?? raw?.scores?.home?.regulation ?? raw?.scores?.home?.regular);
  const directAway=Number(raw?.score?.fulltime?.away ?? raw?.scores?.away?.regulation ?? raw?.scores?.away?.regular);
  if(Number.isFinite(directHome)&&Number.isFinite(directAway))return{home:directHome,away:directAway};
  const periods=raw?.periods||raw?.scores?.periods;
  if(periods&&typeof periods==='object'){
    const keys=['first','second','third','1','2','3'];
    const home=keys.map(k=>Number(periods[k]?.home)).filter(Number.isFinite);
    const away=keys.map(k=>Number(periods[k]?.away)).filter(Number.isFinite);
    if(home.length>=2&&home.length===away.length)return{home:home.reduce((a,b)=>a+b,0),away:away.reduce((a,b)=>a+b,0)};
  }
  return null;
}

function settleMarket(market,result) {
  if(!result || !market) return null;
  const margin=result.home-result.away, total=result.home+result.away;
  if(market==='ML_HOME') return {won:margin>0,push:margin===0};
  if(market==='ML_AWAY') return {won:margin<0,push:margin===0};
  if(market==='ML_DRAW') return {won:margin===0,push:false};
  if(market==='REG_HOME') return {won:margin>0,push:false};
  if(market==='REG_AWAY') return {won:margin<0,push:false};
  if(market==='REG_DRAW') return {won:margin===0,push:false};
  let m=String(market).match(/^SPREAD_(HOME|AWAY):([+-]?\d+(?:\.\d+)?)$/);
  if(m){ const line=Number(m[2]); const adjusted=m[1]==='HOME'?margin+line:-margin+line; return {won:adjusted>0,push:adjusted===0}; }
  m=String(market).match(/^TOTAL_(OVER|UNDER):(\d+(?:\.\d+)?)$/);
  if(m){ const line=Number(m[2]); if(total===line)return {won:null,push:true}; return {won:m[1]==='OVER'?total>line:total<line,push:false}; }
  return null;
}

async function fetchDayEvents(sport,date) {
  const cfg=SPORT_CONFIG[sport];
  if(!cfg) return [];
  if(sport==='football') return (await sportApi(sport,'fixtures',{date,timezone:TZ})).response;
  if(sport==='formula1') return (await sportApi(sport,'races',{date,timezone:TZ})).response;
  if(sport==='mma') return (await sportApi(sport,'fights',{date,timezone:TZ})).response;
  return (await sportApi(sport,'games',{date,timezone:TZ})).response;
}

async function settleRecentPicks(lookbackDays=7) {
  if (!supabaseConfigured() || !apiConfigured()) return {pending:0,settled:0,errors:0,skipped:0};
  const today=todayBudapest();
  const start=dateDaysAgoBudapest(Math.max(1,Math.min(30,Number(lookbackDays)||7)));
  const summary={pending:0,settled:0,errors:0,skipped:0};
  let runId=null;
  try {
    try{const created=await supa('settlement_runs',{method:'POST',headers:{Prefer:'return=representation'},body:{lookback_days:Number(lookbackDays)||7}});runId=Array.isArray(created)?created[0]?.id:created?.id;}catch(e){console.error('settlement run start',e.message);}
    const pending=await supa(`picks?pick_date=gte.${start}&pick_date=lt.${today}&settled=eq.false&select=fixture_id,pick_date,market,market_period,market_odds,probability,api_advice&order=pick_date.asc&limit=1000`);
    summary.pending=Array.isArray(pending)?pending.length:0;
    if(!Array.isArray(pending)||!pending.length)return summary;
    const groups={};
    for(const p of pending){ const sport=parseSportTag(p.api_advice); const key=`${p.pick_date}|${sport}`; (groups[key] ||= []).push(p); }
    for(const [key,rows] of Object.entries(groups)) {
      const [date,sport]=key.split('|');
      if(sport==='formula1'||sport==='mma'){summary.skipped+=rows.length;continue;} // Nem találgatunk nem igazolható eredményt.
      let events=[]; try { events=await fetchDayEvents(sport,date); } catch(e){ console.error('settle fetch',sport,e.message); summary.errors++; continue; }
      const byId=new Map(events.map(r=>[Number(rawGameId(r)),r]));
      for(const pick of rows){
        const src=sourceIdFromSynthetic(sport,pick.fixture_id); const raw=byId.get(Number(src));
        if(!raw||!isFinished(raw)){summary.skipped++;continue;}
        const result=pick.market_period==='regulation'?regulationResultFromRaw(raw):resultFromRaw(raw); const settled=settleMarket(pick.market,result); if(!settled){summary.skipped++;continue;}
        const unitProfit=settled.push?0:(settled.won&&pick.market_odds?Number(pick.market_odds)-1:-1);
        const outcome=settled.push?null:(settled.won?1:0);const prob=Number(pick.probability)/100;const brier=outcome==null||!Number.isFinite(prob)?null:(prob-outcome)**2;
        await supa(`picks?fixture_id=eq.${pick.fixture_id}&pick_date=eq.${date}`,{method:'PATCH',headers:{'Prefer':'return=minimal'},body:{settled:true,won:settled.push?null:Boolean(settled.won),home_score:result.home,away_score:result.away,unit_profit:unitProfit,brier_score:brier,settled_at:new Date().toISOString(),settlement_source:'api-sports',updated_at:new Date().toISOString()}});
        summary.settled++;
      }
    }
  } catch(e){ console.error('settlement',e.message); summary.errors++; }
  finally{if(runId){try{await supa(`settlement_runs?id=eq.${runId}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:{completed_at:new Date().toISOString(),pending_count:summary.pending,settled_count:summary.settled,error_count:summary.errors,metadata:{skipped:summary.skipped}}});}catch(e){console.error('settlement run finish',e.message);}}}
  return summary;
}

// Visszafele kompatibilis nev a korabbi Netlify function szamara.
async function settleYesterday() { return settleRecentPicks(1); }

function isFutureKickoff(value,now=Date.now(),bufferMinutes=5) {
  const ts=new Date(value).getTime();
  return Number.isFinite(ts) && ts>Number(now)+Math.max(0,Number(bufferMinutes)||0)*60000;
}

function filterUpcomingPicks(picks,now=Date.now()) {
  return (picks||[]).filter(p=>isFutureKickoff(p?.kickoff,now));
}

function cacheExpiryForPicks(picks,now=Date.now()) {
  const current=Number(now);
  const maximum=current+60*60000;
  const kickoffs=(picks||[]).map(p=>new Date(p?.kickoff).getTime()).filter(t=>Number.isFinite(t)&&t>current);
  const beforeFirst=kickoffs.length?Math.min(...kickoffs)-5*60000:maximum;
  return new Date(Math.max(current+5*60000,Math.min(maximum,beforeFirst))).toISOString();
}

function demoPayload(date,sport='football') {
  const cfg=SPORT_CONFIG[sport]||SPORT_CONFIG.football;
  return {sport,sportLabel:cfg.label,sportEmoji:cfg.emoji,date,generatedAt:new Date().toISOString(),totalEvents:0,eligibleEvents:0,demo:true,persistence:false,note:'Az API-kulcs nincs beállítva ebben a környezetben. A rendszer nem jelenít meg minta tippet vagy mesterséges valószínűséget.',picks:[]};
}

module.exports={json,TZ,MODEL_VERSION,SPORT_CONFIG,todayBudapest,yesterdayBudapest,dateDaysAgoBudapest,apiConfigured,supabaseConfigured,sportApi,football,supa,supaRpc,getCache,putCache,cachedSportCall,singleFlight,claimAnalysisLock,releaseAnalysisLock,parsePercent,median,mean,clamp,normalCdf,normalize2,normalize3,syntheticId,sourceIdFromSynthetic,parseSportTag,withSportTag,savePicks,recordModelRun,scoreFromGame,rawGameId,isFinished,resultFromRaw,regulationResultFromRaw,settleMarket,settleYesterday,settleRecentPicks,isFutureKickoff,filterUpcomingPicks,cacheExpiryForPicks,demoPayload};
