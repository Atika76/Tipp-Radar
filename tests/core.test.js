const test=require('node:test');
const assert=require('node:assert/strict');

const shared=require('../netlify/functions/_shared');
const {predictionProb}=require('../netlify/functions/_sports').__test;

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
