const {json,supabaseConfigured,supa,parseSportTag,MODEL_VERSION}=require('./_shared');
exports.handler=async()=>{
  if(!supabaseConfigured())return json(200,{modelVersion:MODEL_VERSION,total:0,settled:0,unsettled:0,wins:0,losses:0,pushes:0,hitRate:null,profit:null,roi:null,brier:null,persistence:false,bySport:{},sampleStatus:'unavailable'});
  try{
    const rows=await supa('picks?rating=eq.green&select=settled,won,unit_profit,api_advice,model_version,brier_score&order=pick_date.desc&limit=1500');
    const settled=(rows||[]).filter(r=>r.settled);const wins=settled.filter(r=>r.won===true).length;const losses=settled.filter(r=>r.won===false).length;const pushes=settled.filter(r=>r.won==null).length;const graded=wins+losses;const profit=settled.reduce((s,r)=>s+(Number(r.unit_profit)||0),0);const bySport={};
    for(const r of rows||[]){const sport=parseSportTag(r.api_advice);const s=bySport[sport]||={total:0,settled:0,wins:0,losses:0,pushes:0,profit:0};s.total++;if(r.settled){s.settled++;if(r.won===true)s.wins++;else if(r.won===false)s.losses++;else s.pushes++;s.profit+=Number(r.unit_profit)||0;}}
    for(const s of Object.values(bySport)){const g=s.wins+s.losses;s.hitRate=g?s.wins/g*100:null;s.roi=s.settled?s.profit/s.settled*100:null;}
    const briers=settled.map(r=>Number(r.brier_score)).filter(Number.isFinite);const brier=briers.length?briers.reduce((a,b)=>a+b,0)/briers.length:null;const byModel={};for(const r of rows||[]){const v=r.model_version||'legacy';const m=byModel[v]||={total:0,settled:0,wins:0,brierValues:[]};m.total++;if(r.settled){m.settled++;if(r.won===true)m.wins++;const b=Number(r.brier_score);if(Number.isFinite(b))m.brierValues.push(b);}}for(const m of Object.values(byModel)){m.hitRate=m.settled?m.wins/m.settled*100:null;m.brier=m.brierValues.length?m.brierValues.reduce((a,b)=>a+b,0)/m.brierValues.length:null;delete m.brierValues;}
    return json(200,{modelVersion:MODEL_VERSION,total:(rows||[]).length,settled:settled.length,unsettled:(rows||[]).length-settled.length,wins,losses,pushes,hitRate:graded?wins/graded*100:null,profit:settled.length?profit:null,roi:settled.length?profit/settled.length*100:null,brier,sampleStatus:graded>=100?'measured':'insufficient-sample',minimumSample:100,persistence:true,bySport,byModel});
  }catch(e){return json(500,{error:e.message});}
};
