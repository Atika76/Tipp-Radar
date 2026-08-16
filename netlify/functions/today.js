const {
  json,todayBudapest,apiConfigured,supabaseConfigured,football,getCache,putCache,pickCandidates,analyseFixture,savePicks,settleYesterday,demoPayload,TZ
} = require('./_shared');

exports.handler = async () => {
  const date = todayBudapest();
  if (!apiConfigured()) return json(200,demoPayload(date));
  const cacheKey = `analysis:${date}:v1`;
  if (supabaseConfigured()) {
    const cached = await getCache(cacheKey);
    if (cached) return json(200,{...cached,persistence:true,cached:true});
  }
  try {
    if (supabaseConfigured()) await settleYesterday();
    const fixtures = await football('fixtures',{date,timezone:TZ});
    const candidates = pickCandidates(fixtures,12);
    const picks=[];
    // Tudatosan sorban, kis csoportokban: így stabilabb a külső API felé és nem fut el a kvóta.
    for (let i=0;i<candidates.length;i+=4) {
      const group = candidates.slice(i,i+4);
      const analysed = await Promise.all(group.map(analyseFixture));
      picks.push(...analysed);
    }
    picks.sort((a,b) => {
      const order={green:0,yellow:1,red:2};
      return order[a.rating]-order[b.rating] || (b.edge ?? -999)-(a.edge ?? -999);
    });
    const payload={date,generatedAt:new Date().toISOString(),totalFixtures:fixtures.length,analysedFixtures:picks.length,demo:false,persistence:supabaseConfigured(),cached:false,picks};
    if (supabaseConfigured()) {
      await savePicks(date,picks);
      const tomorrow = new Date(Date.now()+20*60*60*1000).toISOString();
      await putCache(cacheKey,payload,tomorrow);
    }
    return json(200,payload);
  } catch (e) {
    console.error(e);
    return json(500,{error:e.message || 'Ismeretlen hiba a napi elemzés közben.'});
  }
};
