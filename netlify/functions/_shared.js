const API_BASE = 'https://v3.football.api-sports.io';
const TZ = 'Europe/Budapest';

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

function yesterdayBudapest() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(now);
  const y = Number(parts.find(x => x.type === 'year').value);
  const m = Number(parts.find(x => x.type === 'month').value);
  const d = Number(parts.find(x => x.type === 'day').value);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() - 1);
  return utc.toISOString().slice(0,10);
}

function apiConfigured() { return Boolean(process.env.API_FOOTBALL_KEY); }
function supabaseConfigured() { return Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)); }
function supabaseKey() { return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''; }

async function football(path, params = {}) {
  if (!apiConfigured()) throw new Error('API_FOOTBALL_KEY nincs beállítva.');
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k,v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, String(v)); });
  const url = `${API_BASE}/${path}${qs.size ? '?' + qs.toString() : ''}`;
  const res = await fetch(url, { headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY, 'accept':'application/json' } });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`API-Football HTTP ${res.status}`);
  if (payload.errors && Object.keys(payload.errors).length) {
    const msg = typeof payload.errors === 'string' ? payload.errors : Object.values(payload.errors).join('; ');
    throw new Error(`API-Football: ${msg}`);
  }
  return payload.response || [];
}

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

async function getCache(cacheKey) {
  if (!supabaseConfigured()) return null;
  try {
    const rows = await supa(`app_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=payload,expires_at&limit=1`);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;
    if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
    return row.payload || null;
  } catch (e) {
    console.error('cache read', e.message);
    return null;
  }
}

async function putCache(cacheKey, payload, expiresAt) {
  if (!supabaseConfigured()) return;
  try {
    await supa('app_cache?on_conflict=cache_key', {
      method:'POST',
      headers:{ 'Prefer':'resolution=merge-duplicates,return=minimal' },
      body:[{ cache_key:cacheKey, payload, expires_at:expiresAt || null, updated_at:new Date().toISOString() }]
    });
  } catch (e) { console.error('cache write', e.message); }
}

function parsePercent(value) {
  if (value === null || value === undefined) return null;
  const n = Number(String(value).replace('%','').replace(',','.'));
  return Number.isFinite(n) ? n : null;
}

function median(arr) {
  const xs = arr.map(Number).filter(Number.isFinite).sort((a,b) => a-b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length/2);
  return xs.length % 2 ? xs[mid] : (xs[mid-1] + xs[mid]) / 2;
}

function clamp(n,min,max){ return Math.max(min,Math.min(max,n)); }

function normalizeProbabilities(home, draw, away) {
  const vals = [home,draw,away].map(v => Number(v));
  if (!vals.every(Number.isFinite)) return {home:33.3, draw:33.4, away:33.3};
  const sum = vals.reduce((a,b)=>a+b,0) || 100;
  return { home: vals[0]*100/sum, draw: vals[1]*100/sum, away: vals[2]*100/sum };
}

function leaguePriority(f) {
  const country = String(f?.league?.country || '').toLowerCase();
  const name = String(f?.league?.name || '').toLowerCase();
  const majorCountries = ['england','spain','italy','germany','france','netherlands','portugal','belgium','scotland','turkey','hungary','austria','switzerland','denmark','sweden','norway'];
  let score = 0;
  if (majorCountries.includes(country)) score += 50;
  if (['world','euro cups'].includes(country)) score += 35;
  if (/premier|championship|la liga|serie a|bundesliga|ligue 1|eredivisie|primeira|super lig|premiership|champions|europa|conference|nb i/.test(name)) score += 40;
  if (f?.league?.type === 'League') score += 8;
  const status = f?.fixture?.status?.short;
  if (['NS','TBD'].includes(status)) score += 10;
  return score;
}

function pickCandidates(fixtures, max = 12) {
  return fixtures
    .filter(f => ['NS','TBD'].includes(f?.fixture?.status?.short))
    .map(f => ({f, score:leaguePriority(f)}))
    .sort((a,b) => b.score-a.score || new Date(a.f.fixture.date)-new Date(b.f.fixture.date))
    .slice(0,max)
    .map(x => x.f);
}

function extractOdds(oddsPayload, homeName, awayName) {
  const samples = {home:[],draw:[],away:[]};
  for (const block of oddsPayload || []) {
    for (const bm of block.bookmakers || []) {
      const bet = (bm.bets || []).find(b => /match winner|1x2|winner/i.test(String(b.name || '')));
      if (!bet) continue;
      for (const v of bet.values || []) {
        const label = String(v.value || '').trim().toLowerCase();
        const odd = Number(v.odd);
        if (!Number.isFinite(odd)) continue;
        if (label === 'home' || label === '1' || label === homeName.toLowerCase()) samples.home.push(odd);
        else if (label === 'draw' || label === 'x') samples.draw.push(odd);
        else if (label === 'away' || label === '2' || label === awayName.toLowerCase()) samples.away.push(odd);
      }
    }
  }
  return { home:median(samples.home), draw:median(samples.draw), away:median(samples.away), bookmakerCount: Math.max(samples.home.length,samples.draw.length,samples.away.length) };
}

function injuryCounts(payload, homeId, awayId) {
  let home=0, away=0;
  for (const i of payload || []) {
    if (i?.team?.id === homeId) home++;
    if (i?.team?.id === awayId) away++;
  }
  return {home,away};
}

function predictionProbs(prediction) {
  const p = prediction?.predictions?.percent || {};
  return normalizeProbabilities(parsePercent(p.home), parsePercent(p.draw), parsePercent(p.away));
}

function adjustedProbs(base, injuries) {
  let {home,draw,away} = base;
  const delta = clamp((injuries.away - injuries.home) * 0.75, -4.5, 4.5);
  home += delta;
  away -= delta;
  return normalizeProbabilities(clamp(home,4,92), clamp(draw,6,70), clamp(away,4,92));
}

function evaluateSelection(probs, odds) {
  const options = [
    {key:'home',label:'1',prob:probs.home,odd:odds.home},
    {key:'draw',label:'X',prob:probs.draw,odd:odds.draw},
    {key:'away',label:'2',prob:probs.away,odd:odds.away}
  ].map(o => ({...o, ev: o.odd ? (o.prob/100*o.odd-1)*100 : -999, fair: o.prob ? 100/o.prob : null}));
  return options.sort((a,b)=>b.ev-a.ev)[0];
}

function buildReasons({selection, probs, odds, injuries, prediction}) {
  const reasons=[];
  if (selection.odd) {
    if (selection.ev >= 6) reasons.push(`A becsült ${selection.prob.toFixed(1)}%-os esélyhez ${selection.fair.toFixed(2)} fair odds tartozik, miközben a piaci medián ${selection.odd.toFixed(2)}.`);
    else if (selection.ev < 0) reasons.push('A piaci odds nem ad elég értéket a számított valószínűséghez képest.');
  } else reasons.push('Nem találtam használható 1X2 piaci oddsot, ezért ezt a meccset nem jelölöm erős tippnek.');
  const diff = injuries.home - injuries.away;
  if (Math.abs(diff) >= 2) reasons.push(diff > 0 ? `A hazai oldalon ${Math.abs(diff)}-vel több elérhető sérülés/hiányzó szerepel az adatforrásban.` : `A vendég oldalon ${Math.abs(diff)}-vel több elérhető sérülés/hiányzó szerepel az adatforrásban.`);
  const winner = prediction?.predictions?.winner?.name;
  if (winner) reasons.push(`Az API-Football prediction moduljának kijelölt esélyese: ${winner}.`);
  const maxProb = Math.max(probs.home,probs.draw,probs.away);
  if (maxProb < 48) reasons.push('A három kimenetel közül egyik sem emelkedik ki eléggé; a meccs kifejezetten bizonytalan.');
  return reasons.slice(0,4);
}

async function analyseFixture(f) {
  const fixtureId = f.fixture.id;
  const homeId = f.teams.home.id, awayId = f.teams.away.id;
  const [predR,injR,oddsR] = await Promise.allSettled([
    football('predictions',{fixture:fixtureId}),
    football('injuries',{fixture:fixtureId}),
    football('odds',{fixture:fixtureId})
  ]);
  const prediction = predR.status === 'fulfilled' ? predR.value[0] : null;
  const injuriesRaw = injR.status === 'fulfilled' ? injR.value : [];
  const oddsRaw = oddsR.status === 'fulfilled' ? oddsR.value : [];
  const injuries = injuryCounts(injuriesRaw,homeId,awayId);
  const probs = adjustedProbs(predictionProbs(prediction),injuries);
  const odds = extractOdds(oddsRaw,f.teams.home.name,f.teams.away.name);
  const sel = evaluateSelection(probs,odds);
  const chosenName = sel.key === 'home' ? f.teams.home.name : sel.key === 'away' ? f.teams.away.name : 'Döntetlen';
  const coverageParts = [prediction ? 1:0, injR.status === 'fulfilled' ? 1:0, odds.bookmakerCount ? 1:0].reduce((a,b)=>a+b,0);
  const coverage = coverageParts === 3 ? 'Magas' : coverageParts === 2 ? 'Közepes' : 'Alacsony';
  let rating='red';
  if (coverage !== 'Alacsony' && sel.odd && sel.prob >= 52 && sel.ev >= 6 && sel.odd >= 1.30) rating='green';
  else if (sel.odd && sel.prob >= 45 && sel.ev >= 1) rating='yellow';
  const recommendation = rating === 'red' ? 'Kihagyás' : `${chosenName} (${sel.label})`;
  return {
    fixtureId,
    league:f.league.name,
    country:f.league.country,
    home:f.teams.home.name,
    away:f.teams.away.name,
    kickoff:f.fixture.date,
    status:f.fixture.status.short,
    recommendation,
    market:sel.label,
    probability:Number(sel.prob.toFixed(2)),
    fairOdds:sel.fair ? Number(sel.fair.toFixed(2)) : null,
    marketOdds:sel.odd ? Number(sel.odd.toFixed(2)) : null,
    edge:Number.isFinite(sel.ev) && sel.ev > -900 ? Number(sel.ev.toFixed(2)) : null,
    rating,
    probabilities:{home:Number(probs.home.toFixed(1)),draw:Number(probs.draw.toFixed(1)),away:Number(probs.away.toFixed(1))},
    injuries,
    apiAdvice:prediction?.predictions?.advice || null,
    coverage,
    reasons:buildReasons({selection:sel,probs,odds,injuries,prediction}),
    bookmakerCount:odds.bookmakerCount || 0
  };
}

async function savePicks(date,picks) {
  if (!supabaseConfigured() || !picks.length) return;
  const rows = picks.map(p => ({
    fixture_id:p.fixtureId, pick_date:date, league:p.league, country:p.country, home_team:p.home, away_team:p.away,
    kickoff:p.kickoff, recommendation:p.recommendation, market:p.market, probability:p.probability, fair_odds:p.fairOdds,
    market_odds:p.marketOdds, edge:p.edge, rating:p.rating, probabilities:p.probabilities, injuries:p.injuries,
    api_advice:p.apiAdvice, coverage:p.coverage, reasons:p.reasons, updated_at:new Date().toISOString()
  }));
  try {
    await supa('picks?on_conflict=fixture_id,pick_date', {method:'POST',headers:{'Prefer':'resolution=merge-duplicates,return=minimal'},body:rows});
  } catch(e) { console.error('save picks',e.message); }
}

async function settleYesterday() {
  if (!supabaseConfigured() || !apiConfigured()) return;
  const date = yesterdayBudapest();
  try {
    const pending = await supa(`picks?pick_date=eq.${date}&settled=eq.false&select=fixture_id,market,market_odds&limit=100`);
    if (!Array.isArray(pending) || !pending.length) return;
    const results = await football('fixtures',{date,timezone:TZ});
    const byId = new Map(results.map(r => [r.fixture.id,r]));
    for (const pick of pending) {
      const r=byId.get(pick.fixture_id);
      if (!r || !['FT','AET','PEN'].includes(r.fixture?.status?.short)) continue;
      const hg=Number(r.goals.home), ag=Number(r.goals.away);
      const actual = hg>ag?'1':hg<ag?'2':'X';
      const won = pick.market === actual;
      const unitProfit = won && pick.market_odds ? Number(pick.market_odds)-1 : -1;
      await supa(`picks?fixture_id=eq.${pick.fixture_id}&pick_date=eq.${date}`, {
        method:'PATCH',headers:{'Prefer':'return=minimal'},body:{settled:true,won,home_score:hg,away_score:ag,unit_profit:unitProfit,updated_at:new Date().toISOString()}
      });
    }
  } catch(e) { console.error('settlement',e.message); }
}

function demoPayload(date) {
  return {
    date, generatedAt:new Date().toISOString(), totalFixtures:36, demo:true, persistence:false,
    picks:[
      {fixtureId:1,league:'DEMO Liga',country:'Minta',home:'Kék FC',away:'Fehér FC',kickoff:new Date().toISOString(),recommendation:'Kék FC (1)',market:'1',probability:62.4,fairOdds:1.60,marketOdds:1.88,edge:17.3,rating:'green',probabilities:{home:62.4,draw:22.1,away:15.5},injuries:{home:1,away:3},apiAdvice:'Demo adat',coverage:'Magas',reasons:['Ez csak bemutató adat, hogy kulcs nélkül is lásd a teljes működő felületet.','Éles API-kulcs beállítása után valódi mai meccsekkel számol.']},
      {fixtureId:2,league:'DEMO Liga',country:'Minta',home:'Város SC',away:'United',kickoff:new Date(Date.now()+3600000).toISOString(),recommendation:'Kihagyás',market:'X',probability:31.8,fairOdds:3.14,marketOdds:3.05,edge:-3.0,rating:'red',probabilities:{home:35.2,draw:31.8,away:33.0},injuries:{home:1,away:1},apiAdvice:'Demo adat',coverage:'Magas',reasons:['A három kimenetel túl közel van egymáshoz.','A piaci odds nem ad értéket a számított esélyhez képest.']}
    ]
  };
}

module.exports = {
  json,todayBudapest,apiConfigured,supabaseConfigured,football,supa,getCache,putCache,pickCandidates,analyseFixture,savePicks,settleYesterday,demoPayload,TZ
};
