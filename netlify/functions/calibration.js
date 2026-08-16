const {json,supabaseConfigured,supa,MODEL_VERSION}=require('./_shared');

exports.handler=async()=>{
  if(!supabaseConfigured())return json(200,{modelVersion:MODEL_VERSION,status:'unavailable',sampleSize:0,buckets:[],message:'A visszaméréshez nincs Supabase-kapcsolat.'});
  try{
    const rows=await supa('model_calibration?select=model_version,sport,probability_bucket,sample_size,average_prediction,observed_win_rate,average_brier_score&order=model_version.desc,sport,probability_bucket');
    const buckets=Array.isArray(rows)?rows:[];const sampleSize=buckets.reduce((s,r)=>s+(Number(r.sample_size)||0),0);const weightedBrier=sampleSize?buckets.reduce((s,r)=>s+(Number(r.average_brier_score)||0)*(Number(r.sample_size)||0),0)/sampleSize:null;
    return json(200,{modelVersion:MODEL_VERSION,status:sampleSize>=100?'measured':'insufficient-sample',sampleSize,minimumSample:100,averageBrier:weightedBrier,buckets,message:sampleSize>=100?'A kalibrációs minta elérte a minimális küszöböt.':'A minta még kicsi; a találati arány nem tekinthető bizonyítéknak.'});
  }catch(e){return json(500,{error:e.message,modelVersion:MODEL_VERSION});}
};
