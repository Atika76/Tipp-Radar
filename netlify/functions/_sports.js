const {
  SPORT_CONFIG,TZ,sportApi,cachedSportCall,median,mean,clamp,normalCdf,normalize2,normalize3,syntheticId,
  scoreFromGame,rawGameId,isFinished
}=require('./_shared');

const TEAM_SPORTS=new Set(['basketball','hockey','nfl','baseball','handball','volleyball']);

const MODEL={
  basketball:{homeAdv:2.4,sigmaMargin:11.5,sigmaTotal:17,modelName:'Kosárlabda modell • pontkülönbség + forma + pihenő + hendikep/total'},
  hockey:{homeAdv:.22,sigmaMargin:1.75,sigmaTotal:2.15,drawBase:.09,modelName:'Jégkorong modell • gólforma + hazai előny + total + győztes'},
  nfl:{homeAdv:1.6,sigmaMargin:13.2,sigmaTotal:15.5,modelName:'NFL modell • pontkülönbség + pihenő + sérülések + spread/total'},
  baseball:{homeAdv:.18,sigmaMargin:3.6,sigmaTotal:4.4,modelName:'Baseball modell • futásátlag + forma + moneyline/total'},
  handball:{homeAdv:1.7,sigmaMargin:6.7,sigmaTotal:9.5,drawBase:.055,modelName:'Kézilabda modell • gólkülönbség + forma + hendikep/total'},
  volleyball:{homeAdv:.10,sigmaMargin:1.2,sigmaTotal:null,modelName:'Röplabda modell • szettforma + győzelmi arány + moneyline'}
};

const MAJOR_PATTERNS={
  football:[/premier league$/i,/championship$/i,/la liga$/i,/serie a$/i,/bundesliga$/i,/ligue 1$/i,/eredivisie$/i,/primeira liga$/i,/super lig$/i,/premiership$/i,/nb i$/i,/champions league/i,/europa league/i,/conference league/i,/copa libertadores/i,/mls/i,/women'?s super league/i,/nwsl/i,/liga f$/i,/frauen-bundesliga/i],
  basketball:[/nba$/i,/wnba$/i,/euroleague/i,/eurocup/i,/acb/i,/lega a/i,/bundesliga/i,/bbl/i,/pro a/i,/betclic elite/i,/basket league/i,/nbl/i,/bsl/i],
  hockey:[/nhl$/i,/pwhl$/i,/khl$/i,/shl$/i,/liiga$/i,/del$/i,/extraliga/i,/national league/i,/ice hockey league/i],
  nfl:[/^nfl$/i],
  baseball:[/mlb$/i,/npb$/i,/kbo$/i,/mexican league/i],
  handball:[/champions league/i,/bundesliga/i,/liga asobal/i,/starligue/i,/ehf european/i,/nemzeti bajnokság i/i],
  volleyball:[/champions league/i,/superlega/i,/plusliga/i,/bundesliga/i,/sultanlar/i,/superliga/i,/nations league/i]
};

const REJECT_COMMON=/\b(u[- ]?1[5-9]|u[- ]?2[0-3]|under[- ]?1[5-9]|under[- ]?2[0-3]|youth|junior|juniors|academy|reserve|reserves|development|amateur|regional)\b/i;

function eventLeague(raw){ return raw?.league?.name||raw?.competition?.name||raw?.category?.name||raw?.tournament?.name||''; }
function eventCountry(raw){ return raw?.country?.name||raw?.country||raw?.league?.country||raw?.competition?.location?.country||''; }
function eventSeason(raw){ return raw?.league?.season||raw?.season||raw?.competition?.season||new Date().getFullYear(); }
function eventDate(raw){ return raw?.date||raw?.fixture?.date||raw?.game?.date||raw?.race?.date||raw?.fight?.date||null; }
function statusText(raw){ return String(raw?.status?.short||raw?.status?.long||raw?.status||raw?.fixture?.status?.short||'').toLowerCase(); }
function notStarted(raw){ const s=statusText(raw); return !s||/ns|not started|scheduled|tbd|time to be defined|pending/.test(s); }
function teamSide(raw,side){ const t=raw?.teams?.[side]||raw?.team?.[side]||raw?.participants?.[side]; if(!t)return null; return {id:t.id,name:t.name||t.team?.name||String(t.id||side)}; }

function normalizeTeamEvent(sport,raw){
  const home=teamSide(raw,'home'),away=teamSide(raw,'away');
  if(!home||!away)return null;
  return {sport,sourceId:rawGameId(raw),raw,league:eventLeague(raw),country:eventCountry(raw),season:eventSeason(raw),kickoff:eventDate(raw),home,away,status:statusText(raw)};
}

function candidateScore(sport,event){
  const league=String(event.league||''); const country=String(event.country||'');
  const txt=`${league} ${country}`;
  if(REJECT_COMMON.test(txt)) return -999;
  if(sport==='nfl' && /ncaa|college/i.test(txt)) return -999;
  if(sport==='football' && /\b(ii|iii|iv)\b|liga 3|league two|national league north|national league south|county/i.test(league)) return -80;
  let score=0;
  for(const re of MAJOR_PATTERNS[sport]||[]) if(re.test(league)) score+=90;
  if(/england|spain|italy|germany|france|netherlands|portugal|usa|canada|hungary|turkey|sweden|finland|switzerland/i.test(country)) score+=15;
  if(notStarted(event.raw)) score+=10;
  return score;
}

function shortlist(sport,events,max=10){
  return events.map(r=>normalizeTeamEvent(sport,r)).filter(Boolean).filter(e=>notStarted(e.raw)).map(e=>({e,score:candidateScore(sport,e)})).filter(x=>x.score>-100)
    .sort((a,b)=>b.score-a.score||new Date(a.e.kickoff||0)-new Date(b.e.kickoff||0)).slice(0,max).map(x=>x.e);
}

function collectOdds(oddsPayload,homeName,awayName){
  const market={money:{home:[],draw:[],away:[]},spreads:[],totals:[],bookmakers:new Set()};
  const blocks=Array.isArray(oddsPayload)?oddsPayload:[oddsPayload];
  for(const block of blocks||[]){
    for(const bm of block?.bookmakers||[]){
      market.bookmakers.add(bm.id||bm.name||market.bookmakers.size+1);
      for(const bet of bm.bets||[]){
        const bn=String(bet.name||'').toLowerCase();
        const fullGame=!/1st|first|half|quarter|period|inning|set |set$|team total|home total|away total/i.test(bn);
        if(!fullGame)continue;
        for(const val of bet.values||[]){
          const odd=Number(val.odd); if(!Number.isFinite(odd)||odd<1.01)continue;
          const label=String(val.value??val.name??'').trim(); const low=label.toLowerCase();
          const handicap=Number(val.handicap??val.handicap_value??val.points??extractNumber(label));
          if(/match winner|winner|home\/away|moneyline|1x2|3way|three way|result$/i.test(bn)){
            if(isHomeLabel(low,homeName))market.money.home.push(odd);
            else if(isAwayLabel(low,awayName))market.money.away.push(odd);
            else if(/^(draw|x|tie)$/i.test(low))market.money.draw.push(odd);
          }
          if(/handicap|spread|asian/i.test(bn)){
            const side=isHomeLabel(low,homeName)?'home':isAwayLabel(low,awayName)?'away':null;
            let line=Number.isFinite(Number(val.handicap))?Number(val.handicap):extractSignedNumber(label);
            if(side&&Number.isFinite(line))market.spreads.push({side,line,odd});
          }
          if(/total|over\/under|over under/i.test(bn)){
            const ou=/\bover\b/i.test(low)?'over':/\bunder\b/i.test(low)?'under':null;
            let line=Number.isFinite(Number(val.handicap))?Number(val.handicap):extractNumber(label);
            if(ou&&Number.isFinite(line))market.totals.push({side:ou,line,odd});
          }
        }
      }
    }
  }
  return {
    money:{home:median(market.money.home),draw:median(market.money.draw),away:median(market.money.away)},
    spreads:collapseLines(market.spreads),totals:collapseLines(market.totals),bookmakerCount:market.bookmakers.size
  };
}
function isHomeLabel(low,name){ const n=String(name||'').toLowerCase(); return low==='home'||low==='1'||low===n||low.startsWith(`${n} `)||/^home\b/.test(low)||/^1\s/.test(low); }
function isAwayLabel(low,name){ const n=String(name||'').toLowerCase(); return low==='away'||low==='2'||low===n||low.startsWith(`${n} `)||/^away\b/.test(low)||/^2\s/.test(low); }
function extractNumber(s){ const m=String(s).match(/(-?\d+(?:\.\d+)?)/); return m?Number(m[1]):NaN; }
function extractSignedNumber(s){ const m=String(s).match(/([+-]?\d+(?:\.\d+)?)/); return m?Number(m[1]):NaN; }
function collapseLines(items){
  const groups=new Map(); for(const x of items){ const k=`${x.side}:${x.line}`; if(!groups.has(k))groups.set(k,[]);groups.get(k).push(x.odd); }
  return [...groups.entries()].map(([k,vals])=>{const [side,line]=k.split(':');return{side,line:Number(line),odd:median(vals),samples:vals.length};}).sort((a,b)=>b.samples-a.samples);
}
function hasUsefulOdds(m){ return Boolean(m?.money?.home||m?.money?.away||m?.spreads?.length||m?.totals?.length); }

async function oddsForEvent(sport,event){
  const cfg=SPORT_CONFIG[sport];
  try{ const r=await sportApi(sport,'odds',{[cfg.idParam]:event.sourceId}); return collectOdds(r.response,event.home?.name,event.away?.name); }
  catch(e){ console.error('odds',sport,event.sourceId,e.message); return collectOdds([],event.home?.name,event.away?.name); }
}

async function recentGames(sport,teamId,season,before){
  const key=`games-team-${teamId}-${season}`;
  let rows=[];
  try{ rows=await cachedSportCall(sport,key,'games',{team:teamId,season},720); }catch(e){ console.error('recent',sport,teamId,e.message); return []; }
  const t=before?new Date(before).getTime():Infinity;
  return (rows||[]).filter(g=>isFinished(g)&&(new Date(eventDate(g)||0).getTime()<t)).sort((a,b)=>new Date(eventDate(b)||0)-new Date(eventDate(a)||0)).slice(0,8);
}

function teamForm(rows,teamId){
  let games=0,wins=0,scored=[],allowed=[],lastDate=null;
  for(const g of rows||[]){
    const home=teamSide(g,'home'),away=teamSide(g,'away'); const hs=scoreFromGame(g,'home'),as=scoreFromGame(g,'away');
    if(!home||!away||!Number.isFinite(hs)||!Number.isFinite(as))continue;
    const isHome=Number(home.id)===Number(teamId); if(!isHome&&Number(away.id)!==Number(teamId))continue;
    const pf=isHome?hs:as,pa=isHome?as:hs; games++; scored.push(pf);allowed.push(pa); if(pf>pa)wins++;
    const d=eventDate(g);if(!lastDate&&d)lastDate=d;
  }
  return {games,wins,winRate:games?wins/games:null,scored:mean(scored),allowed:mean(allowed),diff:games?mean(scored.map((x,i)=>x-allowed[i])):null,lastDate};
}
function restDays(lastDate,kickoff){ if(!lastDate||!kickoff)return null; return Math.max(0,(new Date(kickoff)-new Date(lastDate))/86400000); }

function noVigMoney(money,drawAllowed=false){
  const ih=money.home?1/money.home:null,ia=money.away?1/money.away:null,id=drawAllowed&&money.draw?1/money.draw:null;
  if(!ih||!ia)return null; return drawAllowed&&id?normalize3(ih,id,ia):normalize2(ih,ia);
}

function evaluateTeamMarkets(sport,event,odds,model){
  const options=[]; const cfg=MODEL[sport];
  const p=model.probabilities;
  if(odds.money.home)options.push(opt('ML_HOME',`${event.home.name} – győzelem`,p.home,odds.money.home));
  if(odds.money.away)options.push(opt('ML_AWAY',`${event.away.name} – győzelem`,p.away,odds.money.away));
  if(p.draw!=null&&odds.money.draw)options.push(opt('ML_DRAW','Döntetlen',p.draw,odds.money.draw));
  if(model.formSufficient&&cfg.sigmaMargin){
    for(const s of odds.spreads.slice(0,10)){
      const prob=(s.side==='home'?normalCdf((model.predMargin+s.line)/cfg.sigmaMargin):normalCdf((-model.predMargin+s.line)/cfg.sigmaMargin))*100;
      options.push(opt(`SPREAD_${s.side.toUpperCase()}:${s.line}`,`${s.side==='home'?event.home.name:event.away.name} ${s.line>=0?'+':''}${s.line}`,prob,s.odd));
    }
  }
  if(model.formSufficient&&cfg.sigmaTotal&&Number.isFinite(model.predTotal)){
    for(const t of odds.totals.slice(0,8)){
      const pOver=normalCdf((model.predTotal-t.line)/cfg.sigmaTotal)*100;
      const prob=t.side==='over'?pOver:100-pOver;
      options.push(opt(`TOTAL_${t.side.toUpperCase()}:${t.line}`,`${t.side==='over'?'Over':'Under'} ${t.line}`,prob,t.odd));
    }
  }
  return options.sort((a,b)=>b.ev-a.ev)[0]||null;
}
function opt(market,label,prob,odd){ const p=Number(prob),o=Number(odd); return {market,label,prob:p,odd:o,fair:p>0?100/p:null,ev:Number.isFinite(o)?(p/100*o-1)*100:-999}; }

function buildTeamModel(sport,event,hf,af,odds,injuries={home:0,away:0}){
  const cfg=MODEL[sport]; const formSufficient=hf.games>=3&&af.games>=3;
  let predMargin=0,predTotal=null,probs;
  if(formSufficient){
    if(sport==='volleyball'){
      const rawHome=clamp(.5+(hf.winRate-af.winRate)*.55+cfg.homeAdv,0.12,.88); probs={home:rawHome*100,away:(1-rawHome)*100}; predMargin=(rawHome-.5)*2; predTotal=null;
    }else{
      const expHome=((hf.scored??0)+(af.allowed??0))/2+cfg.homeAdv/2;
      const expAway=((af.scored??0)+(hf.allowed??0))/2-cfg.homeAdv/2;
      predMargin=expHome-expAway; predTotal=expHome+expAway;
      const hr=restDays(hf.lastDate,event.kickoff),ar=restDays(af.lastDate,event.kickoff);
      if(Number.isFinite(hr)&&Number.isFinite(ar)) predMargin+=clamp((hr-ar)*.22,-1.8,1.8);
      if(sport==='nfl') predMargin+=clamp((injuries.away-injuries.home)*.22,-2.2,2.2);
      const baseHome=normalCdf(predMargin/cfg.sigmaMargin);
      if(cfg.drawBase){ const draw=clamp(cfg.drawBase*Math.exp(-Math.abs(predMargin)/3),.025,.14); probs={home:baseHome*(1-draw)*100,draw:draw*100,away:(1-baseHome)*(1-draw)*100}; }
      else probs={home:baseHome*100,away:(1-baseHome)*100};
    }
  }else{
    const nv=noVigMoney(odds.money,Boolean(cfg.drawBase));
    probs=nv|| (cfg.drawBase?{home:46,draw:8,away:46}:{home:50,away:50});
  }
  return {formSufficient,predMargin,predTotal,probabilities:probs,homeForm:hf,awayForm:af,injuries};
}

async function nflInjuries(event){
  const result={home:0,away:0};
  try{
    const [h,a]=await Promise.allSettled([
      cachedSportCall('nfl',`inj-${event.home.id}-${event.season}`,'injuries',{team:event.home.id,season:event.season},360),
      cachedSportCall('nfl',`inj-${event.away.id}-${event.season}`,'injuries',{team:event.away.id,season:event.season},360)
    ]);
    if(h.status==='fulfilled')result.home=(h.value||[]).length;if(a.status==='fulfilled')result.away=(a.value||[]).length;
  }catch{}
  return result;
}

async function analyseTeamEvent(sport,event,odds){
  const [hg,ag]=await Promise.all([recentGames(sport,event.home.id,event.season,event.kickoff),recentGames(sport,event.away.id,event.season,event.kickoff)]);
  const hf=teamForm(hg,event.home.id),af=teamForm(ag,event.away.id); const injuries=sport==='nfl'?await nflInjuries(event):{home:0,away:0};
  const model=buildTeamModel(sport,event,hf,af,odds,injuries); const sel=evaluateTeamMarkets(sport,event,odds,model);
  const coverageScore=(model.formSufficient?2:0)+(odds.bookmakerCount?2:0)+(sport==='nfl'&&(injuries.home+injuries.away>0)?1:0);
  const coverage=coverageScore>=4?'Magas':coverageScore>=2?'Közepes':'Alacsony';
  let rating='red'; if(sel&&model.formSufficient&&coverage!=='Alacsony'&&sel.odd>=1.35&&sel.prob>=54&&sel.ev>=5)rating='green'; else if(sel&&model.formSufficient&&sel.prob>=50&&sel.ev>=1.5)rating='yellow';
  const reasons=[];
  if(!model.formSufficient)reasons.push('Nincs elég friss, lezárt mérkőzés a saját forma-modellhez, ezért a rendszer nem erőltet tippet.');
  else{
    reasons.push(`Utolsó ${hf.games}/${af.games} meccs: ${event.home.name} ${Math.round((hf.winRate||0)*100)}% győzelem, ${event.away.name} ${Math.round((af.winRate||0)*100)}%.`);
    if(sport!=='volleyball'&&Number.isFinite(model.predMargin))reasons.push(`A saját pont/gólmodell várható különbsége: ${model.predMargin>=0?'+':''}${model.predMargin.toFixed(1)} a hazai csapat szemszögéből.`);
    if(sport==='nfl'&&(injuries.home+injuries.away))reasons.push(`Elérhető sérülés-adatok: hazai ${injuries.home}, vendég ${injuries.away}.`);
  }
  if(sel){ if(sel.ev>=1)reasons.push(`Becsült esély ${sel.prob.toFixed(1)}%, fair odds ${sel.fair.toFixed(2)}, piaci medián ${sel.odd.toFixed(2)} → számított érték ${sel.ev>=0?'+':''}${sel.ev.toFixed(1)}%.`); else reasons.push('A jelenlegi piaci odds a modell szerint nem ad elég értéket.'); }
  else reasons.push('Nem találtam használható teljes meccses oddsot ehhez az eseményhez.');
  return {
    sport,sportLabel:SPORT_CONFIG[sport].label,sportEmoji:SPORT_CONFIG[sport].emoji,fixtureId:syntheticId(sport,event.sourceId),sourceId:event.sourceId,
    league:event.league,country:event.country,home:event.home.name,away:event.away.name,kickoff:event.kickoff,recommendation:rating==='red'?'Kihagyás':sel.label,
    market:sel?.market||'NONE',marketLabel:sel?.label||'Nincs megfelelő piac',probability:sel?Number(sel.prob.toFixed(2)):Math.max(...Object.values(model.probabilities||{}).filter(Number.isFinite)),
    fairOdds:sel?.fair?Number(sel.fair.toFixed(2)):null,marketOdds:sel?.odd?Number(sel.odd.toFixed(2)):null,edge:sel&&sel.ev>-900?Number(sel.ev.toFixed(2)):null,rating,
    probabilities:Object.fromEntries(Object.entries(model.probabilities||{}).map(([k,v])=>[k,Number(v.toFixed(1))])),injuries,
    apiAdvice:null,coverage,modelName:MODEL[sport].modelName,reasons:reasons.slice(0,5),bookmakerCount:odds.bookmakerCount,
    modelData:{homeWinRate:hf.winRate,awayWinRate:af.winRate,predMargin:model.predMargin,predTotal:model.predTotal,homeRest:restDays(hf.lastDate,event.kickoff),awayRest:restDays(af.lastDate,event.kickoff)}
  };
}

// ------------------------- FOCI -------------------------
function normalizeFootball(raw){
  return {sport:'football',sourceId:raw?.fixture?.id,raw,league:raw?.league?.name||'',country:raw?.league?.country||'',season:raw?.league?.season,kickoff:raw?.fixture?.date,
    home:{id:raw?.teams?.home?.id,name:raw?.teams?.home?.name},away:{id:raw?.teams?.away?.id,name:raw?.teams?.away?.name}};
}
function footballScore(e){ const txt=`${e.league} ${e.country}`; if(REJECT_COMMON.test(txt))return-999;if(/\b(ii|iii|iv)\b|nb iii|liga 3|regional|county|reserve/i.test(txt))return-200;let s=0;for(const re of MAJOR_PATTERNS.football)if(re.test(e.league))s+=100;if(/england|spain|italy|germany|france|netherlands|portugal|hungary|turkey|usa/i.test(e.country))s+=15;return s; }
function predictionProb(pred){ const p=pred?.predictions?.percent||{}; const h=Number(String(p.home||'').replace('%','')),d=Number(String(p.draw||'').replace('%','')),a=Number(String(p.away||'').replace('%','')); return [h,d,a].every(Number.isFinite)?normalize3(h,d,a):null; }
function injuryCount(rows,homeId,awayId){let home=0,away=0;for(const x of rows||[]){if(Number(x?.team?.id)===Number(homeId))home++;if(Number(x?.team?.id)===Number(awayId))away++;}return{home,away};}
async function analyseFootball(event,odds){
  const [pr,ir]=await Promise.allSettled([sportApi('football','predictions',{fixture:event.sourceId}),sportApi('football','injuries',{fixture:event.sourceId})]);
  const pred=pr.status==='fulfilled'?pr.value.response[0]:null;const inj=injuryCount(ir.status==='fulfilled'?ir.value.response:[],event.home.id,event.away.id);
  let probs=predictionProb(pred)||noVigMoney(odds.money,true)||{home:33,draw:34,away:33};
  const delta=clamp((inj.away-inj.home)*.65,-4,4);probs=normalize3(probs.home+delta,probs.draw,probs.away-delta);
  const opts=[]; if(odds.money.home)opts.push(opt('ML_HOME',`${event.home.name} (1)`,probs.home,odds.money.home));if(odds.money.draw)opts.push(opt('ML_DRAW','Döntetlen (X)',probs.draw,odds.money.draw));if(odds.money.away)opts.push(opt('ML_AWAY',`${event.away.name} (2)`,probs.away,odds.money.away));
  const sel=opts.sort((a,b)=>b.ev-a.ev)[0]||null;const coverage=(pred&&odds.bookmakerCount)?'Magas':(pred||odds.bookmakerCount)?'Közepes':'Alacsony';
  let rating='red';if(sel&&pred&&sel.prob>=52&&sel.ev>=5&&sel.odd>=1.30)rating='green';else if(sel&&pred&&sel.prob>=45&&sel.ev>=1.5)rating='yellow';
  const reasons=[];if(sel)reasons.push(`Becsült esély ${sel.prob.toFixed(1)}%, fair odds ${sel.fair.toFixed(2)}, piaci medián ${sel.odd.toFixed(2)}.`);else reasons.push('Nincs használható 1X2 odds.');
  if(pred?.predictions?.winner?.name)reasons.push(`Az API-Football prediction esélyese: ${pred.predictions.winner.name}.`);if(inj.home+inj.away)reasons.push(`Elérhető hiányzók/sérülések: hazai ${inj.home}, vendég ${inj.away}.`);if(sel&&sel.ev<1)reasons.push('A piac és a modell között nincs elég különbség, ezért kihagyás.');
  return {sport:'football',sportLabel:'Foci',sportEmoji:'⚽',fixtureId:syntheticId('football',event.sourceId),sourceId:event.sourceId,league:event.league,country:event.country,home:event.home.name,away:event.away.name,kickoff:event.kickoff,recommendation:rating==='red'?'Kihagyás':sel.label,market:sel?.market||'NONE',marketLabel:sel?.label||'1X2',probability:sel?Number(sel.prob.toFixed(2)):Math.max(probs.home,probs.draw,probs.away),fairOdds:sel?.fair?Number(sel.fair.toFixed(2)):null,marketOdds:sel?.odd?Number(sel.odd.toFixed(2)):null,edge:sel?Number(sel.ev.toFixed(2)):null,rating,probabilities:{home:Number(probs.home.toFixed(1)),draw:Number(probs.draw.toFixed(1)),away:Number(probs.away.toFixed(1))},injuries:inj,apiAdvice:pred?.predictions?.advice||null,coverage,modelName:'Foci modell • API prediction + sérülések + 1X2 value',reasons,bookmakerCount:odds.bookmakerCount};
}

async function analyseFootballDay(date){
  const fixtures=(await sportApi('football','fixtures',{date,timezone:TZ})).response; const normalized=fixtures.map(normalizeFootball).filter(e=>e.sourceId&&e.home?.id&&e.away?.id).map(e=>({e,score:footballScore(e)})).filter(x=>x.score>-100).sort((a,b)=>b.score-a.score||new Date(a.e.kickoff)-new Date(b.e.kickoff)).slice(0,12).map(x=>x.e);
  const withOdds=[]; for(let i=0;i<normalized.length;i+=4){const group=normalized.slice(i,i+4);const odds=await Promise.all(group.map(e=>oddsForEvent('football',e)));group.forEach((e,j)=>{if(hasUsefulOdds(odds[j]))withOdds.push({e,odds:odds[j]});});if(withOdds.length>=4)break;}
  const selected=withOdds.slice(0,4);const picks=[];for(let i=0;i<selected.length;i+=2){picks.push(...await Promise.all(selected.slice(i,i+2).map(x=>analyseFootball(x.e,x.odds))));}
  return {totalEvents:fixtures.length,eligibleEvents:withOdds.length,picks};
}

// ------------------------- CSAPATSPORTOK -------------------------
async function analyseTeamSportDay(sport,date){
  const raw=(await sportApi(sport,'games',{date,timezone:TZ})).response; const candidates=shortlist(sport,raw,10);const withOdds=[];
  for(let i=0;i<candidates.length;i+=4){const group=candidates.slice(i,i+4);const odds=await Promise.all(group.map(e=>oddsForEvent(sport,e)));group.forEach((e,j)=>{if(hasUsefulOdds(odds[j]))withOdds.push({e,odds:odds[j]});});if(withOdds.length>=3)break;}
  const selected=withOdds.slice(0,3);const picks=[];for(const x of selected)picks.push(await analyseTeamEvent(sport,x.e,x.odds));return{totalEvents:raw.length,eligibleEvents:withOdds.length,picks};
}

// ------------------------- MMA -------------------------
function fighterSide(raw,side){ const obj=raw?.fighters?.[side]||raw?.fighter?.[side]||raw?.teams?.[side];return obj?{id:obj.id,name:obj.name||obj.firstname&&`${obj.firstname} ${obj.lastname||''}`.trim()||String(obj.id)}:null; }
function normalizeFight(raw){ const a=fighterSide(raw,'first')||fighterSide(raw,'home')||raw?.fighters?.a||raw?.fighters?.red; const b=fighterSide(raw,'second')||fighterSide(raw,'away')||raw?.fighters?.b||raw?.fighters?.blue; if(!a||!b)return null;return{sport:'mma',sourceId:rawGameId(raw),raw,league:eventLeague(raw)||raw?.category||'MMA',country:eventCountry(raw),kickoff:eventDate(raw),home:a,away:b}; }
function recursiveFind(obj,patterns){ if(!obj||typeof obj!=='object')return null;for(const [k,v] of Object.entries(obj)){if(patterns.some(r=>r.test(k))&&Number.isFinite(Number(v)))return Number(v);}for(const v of Object.values(obj)){if(v&&typeof v==='object'){const r=recursiveFind(v,patterns);if(r!=null)return r;}}return null; }
async function fighterRecord(id){ try{const r=await cachedSportCall('mma',`fighterstats-${id}`,'fights/statistics/fighters',{id},1440);const root=Array.isArray(r)?r[0]:r;const wins=recursiveFind(root,[/^wins?$/i,/win_total/i]),losses=recursiveFind(root,[/^loss(es)?$/i,/loss_total/i]),draws=recursiveFind(root,[/^draws?$/i]);return{wins,losses,draws,raw:root};}catch{return{wins:null,losses:null,draws:null};} }
async function analyseMmaDay(date){
  let fights=[];try{fights=(await sportApi('mma','fights',{date,timezone:TZ})).response;}catch(e){return{totalEvents:0,eligibleEvents:0,picks:[],note:e.message};}
  const candidates=fights.map(normalizeFight).filter(Boolean).slice(0,8),withOdds=[];for(const e of candidates){const o=await oddsForEvent('mma',e);if(hasUsefulOdds(o))withOdds.push({e,odds:o});if(withOdds.length>=3)break;}
  const picks=[];for(const {e,odds} of withOdds.slice(0,3)){
    const [ra,rb]=await Promise.all([fighterRecord(e.home.id),fighterRecord(e.away.id)]);const gamesA=(ra.wins||0)+(ra.losses||0)+(ra.draws||0),gamesB=(rb.wins||0)+(rb.losses||0)+(rb.draws||0);let probs=noVigMoney(odds.money,false)||{home:50,away:50};let statsOk=gamesA>=3&&gamesB>=3;
    if(statsOk){const wrA=(ra.wins+.5*(ra.draws||0))/gamesA,wrB=(rb.wins+.5*(rb.draws||0))/gamesB;const rec=normalize2(Math.exp((wrA-.5)*2.2),Math.exp((wrB-.5)*2.2));probs={home:rec.home,away:rec.away};}
    const opts=[];if(odds.money.home)opts.push(opt('ML_HOME',`${e.home.name} – győztes`,probs.home,odds.money.home));if(odds.money.away)opts.push(opt('ML_AWAY',`${e.away.name} – győztes`,probs.away,odds.money.away));const sel=opts.sort((a,b)=>b.ev-a.ev)[0]||null;let rating='red';if(sel&&statsOk&&sel.prob>=55&&sel.ev>=5)rating='green';else if(sel&&statsOk&&sel.prob>=51&&sel.ev>=2)rating='yellow';const reasons=[];if(statsOk)reasons.push(`Elérhető mérleg: ${e.home.name} ${ra.wins}-${ra.losses}, ${e.away.name} ${rb.wins}-${rb.losses}.`);else reasons.push('A harcosokhoz nem érkezett elég egységes történeti statisztika, ezért a rendszer nem gyárt mesterséges előnyt.');if(sel)reasons.push(`Becsült esély ${sel.prob.toFixed(1)}%, piaci odds ${sel.odd.toFixed(2)}, value ${sel.ev>=0?'+':''}${sel.ev.toFixed(1)}%.`);
    picks.push({sport:'mma',sportLabel:'MMA',sportEmoji:'🥊',fixtureId:syntheticId('mma',e.sourceId),sourceId:e.sourceId,league:e.league,country:e.country,home:e.home.name,away:e.away.name,kickoff:e.kickoff,recommendation:rating==='red'?'Kihagyás':sel.label,market:sel?.market||'NONE',marketLabel:sel?.label||'Fight winner',probability:sel?Number(sel.prob.toFixed(2)):Math.max(probs.home,probs.away),fairOdds:sel?.fair?Number(sel.fair.toFixed(2)):null,marketOdds:sel?.odd?Number(sel.odd.toFixed(2)):null,edge:sel?Number(sel.ev.toFixed(2)):null,rating,probabilities:{home:Number(probs.home.toFixed(1)),away:Number(probs.away.toFixed(1))},injuries:{home:0,away:0},apiAdvice:null,coverage:statsOk&&odds.bookmakerCount?'Magas':odds.bookmakerCount?'Közepes':'Alacsony',modelName:'MMA modell • fighter mérleg + piaci odds',reasons,bookmakerCount:odds.bookmakerCount});
  }
  return{totalEvents:fights.length,eligibleEvents:withOdds.length,picks};
}

// ------------------------- FORMULA 1 -------------------------
async function analyseFormula1Day(date){
  const season=new Date(`${date}T12:00:00Z`).getUTCFullYear();
  let seasonRaces=[];try{seasonRaces=(await sportApi('formula1','races',{season,timezone:TZ})).response;}catch(e){return{totalEvents:0,eligibleEvents:0,picks:[],note:e.message};}
  const races=(seasonRaces||[]).filter(r=>String(eventDate(r)||'').slice(0,10)===date);
  let rankings=[];try{rankings=(await cachedSportCall('formula1',`driver-rankings-${season}`,'rankings/drivers',{season},720))||[];}catch{}
  const picks=[];for(const r of races.slice(0,3)){
    const rid=rawGameId(r)||r?.id||hashSimple(JSON.stringify(r));const raceName=r?.competition?.name||r?.name||r?.race?.name||'Formula–1 esemény';const top=rankings.slice(0,3).map(x=>x?.driver?.name||x?.driver?.lastname||x?.name).filter(Boolean);
    picks.push({sport:'formula1',sportLabel:'F1',sportEmoji:'🏎️',fixtureId:syntheticId('formula1',rid),sourceId:rid,league:'Formula 1',country:r?.competition?.location?.country||'',home:raceName,away:'',kickoff:eventDate(r),recommendation:'Kihagyás – nincs API odds',market:'NONE',marketLabel:'Nincs odds',probability:null,fairOdds:null,marketOdds:null,edge:null,rating:'red',probabilities:{},injuries:{home:0,away:0},apiAdvice:null,coverage:top.length?'Közepes':'Alacsony',modelName:'F1 modell • verseny + szezonbeli pilótarangsor',reasons:[top.length?`Aktuális rangsor élmezőnye: ${top.join(', ')}.`:'A rangsoradat nem volt elérhető.','Az API-Sports Formula–1 adatforrás nem publikál fogadási odds piacot, ezért fair/value fogadást nem találunk ki.']});
  }
  return{totalEvents:races.length,eligibleEvents:0,picks};
}
function hashSimple(s){let h=0;for(let i=0;i<s.length;i++)h=((h<<5)-h)+s.charCodeAt(i)|0;return Math.abs(h);}

async function analyseSportDay(sport,date){
  if(sport==='football')return analyseFootballDay(date);
  if(TEAM_SPORTS.has(sport))return analyseTeamSportDay(sport,date);
  if(sport==='mma')return analyseMmaDay(date);
  if(sport==='formula1')return analyseFormula1Day(date);
  throw new Error(`Nem támogatott sport: ${sport}`);
}

module.exports={analyseSportDay};
