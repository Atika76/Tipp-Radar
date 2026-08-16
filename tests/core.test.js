const test=require('node:test');
const assert=require('node:assert/strict');

const shared=require('../netlify/functions/_shared');
const {predictionProb,collectOdds,teamForm,headToHead}=require('../netlify/functions/_sports').__test;

test('hianyzo prediction nem gyart 33-33-33 szazalekot',()=>{
  assert.equal(predictionProb({predictions:{}}),null);
  assert.equal(predictionProb({predictions:{percent:{home:'',draw:'',away:''}}}),null);
});

test('kozel egyenlo prediction gyenge jelzes',()=>{
  const result=predictionProb({predictions:{percent:{home:'33%',draw:'33%',away:'34%'}}});
  assert.equal(result.lowSignal,true);
});

test('ervenyes prediction normalizalhato',()=>{
  const result=predictionProb({predictions:{percent:{home:'52%',draw:'27%',away:'21%'}}});
  assert.equal(result.lowSignal,false);
  assert.equal(Math.round(result.probs.home+result.probs.draw+result.probs.away),100);
});

test('csak legalabb ot perccel kesobbi esemeny marad aktiv',()=>{
  const now=Date.parse('2026-08-16T18:00:00Z');
  assert.equal(shared.isFutureKickoff('2026-08-16T18:06:00Z',now),true);
  assert.equal(shared.isFutureKickoff('2026-08-16T18:04:00Z',now),false);
  assert.equal(shared.isFutureKickoff('hibas-datum',now),false);
});

test('a cache legfeljebb egy oraig es az elso kezdes elott ervenyes',()=>{
  const now=Date.parse('2026-08-16T18:00:00Z');
  const expiry=Date.parse(shared.cacheExpiryForPicks([{kickoff:'2026-08-16T18:40:00Z'}],now));
  assert.equal(expiry,Date.parse('2026-08-16T18:35:00Z'));
  assert.ok(expiry<=now+60*60000);
});

test('moneyline spread es total elszamolas determinisztikus',()=>{
  assert.deepEqual(shared.settleMarket('ML_HOME',{home:2,away:1}),{won:true,push:false});
  assert.deepEqual(shared.settleMarket('SPREAD_AWAY:+1.5',{home:2,away:1}),{won:true,push:false});
  assert.deepEqual(shared.settleMarket('TOTAL_UNDER:3',{home:1,away:2}),{won:null,push:true});
});

test('rendes jatekidos piac nem keveredik a ketkimenetelu gyoztessel',()=>{
  const odds=collectOdds([{bookmakers:[{id:1,bets:[{name:'Match Result',values:[{value:'Home',odd:'2.10'},{value:'Draw',odd:'3.20'},{value:'Away',odd:'3.50'}]},{name:'Money Line',values:[{value:'Home',odd:'1.70'},{value:'Away',odd:'2.15'}]}]}]}],'A','B');
  assert.equal(odds.moneyPeriod,'regulation');
  assert.equal(odds.threeWay.draw,3.2);
  assert.equal(odds.twoWay.home,1.7);
});

test('REG piacnal a dontetlen nem push',()=>{
  assert.deepEqual(shared.settleMarket('REG_HOME',{home:1,away:1}),{won:false,push:false});
  assert.deepEqual(shared.settleMarket('REG_DRAW',{home:1,away:1}),{won:true,push:false});
});

test('frissebb forma nagyobb sulyt kap es a h2h deduplikalt',()=>{
  const game=(id,date,homeId,awayId,home,away)=>({id,date,status:{short:'FT'},teams:{home:{id:homeId,name:'H'},away:{id:awayId,name:'A'}},scores:{home:{total:home},away:{total:away}}});
  const rows=[game(2,'2026-08-10',1,3,10,0),game(1,'2026-08-01',1,2,0,10)];
  assert.ok(teamForm(rows,1).winRate>.5);
  assert.equal(headToHead([rows[1],rows[1]],1,2).games,1);
});

test('API nelkuli demo mod nem mutat mesterseges tippet',()=>{
  const demo=shared.demoPayload('2026-08-16','football');
  assert.equal(demo.demo,true);
  assert.equal(demo.totalEvents,0);
  assert.deepEqual(demo.picks,[]);
});
