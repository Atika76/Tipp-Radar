const { json, supabaseConfigured, supa } = require('./_shared');
exports.handler = async () => {
  if (!supabaseConfigured()) return json(200,{total:0,settled:0,wins:0,losses:0,hitRate:null,profit:null,roi:null,persistence:false});
  try {
    const rows = await supa('picks?rating=eq.green&select=settled,won,unit_profit&order=pick_date.desc&limit=1000');
    const settled=(rows||[]).filter(r=>r.settled);
    const wins=settled.filter(r=>r.won).length;
    const losses=settled.length-wins;
    const profit=settled.reduce((s,r)=>s+(Number(r.unit_profit)||0),0);
    return json(200,{
      total:(rows||[]).length,settled:settled.length,wins,losses,
      hitRate:settled.length?wins/settled.length*100:null,
      profit:settled.length?profit:null,
      roi:settled.length?profit/settled.length*100:null,
      persistence:true
    });
  } catch(e) { return json(500,{error:e.message}); }
};
