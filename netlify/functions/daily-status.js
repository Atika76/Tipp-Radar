const {json,todayBudapest,getCache,MODEL_VERSION}=require('./_shared');

exports.handler=async()=>{
  const date=todayBudapest();
  const summary=await getCache(`daily-summary:${date}:${MODEL_VERSION}`);
  return json(200,summary?{available:true,...summary}:{available:false,date,modelVersion:MODEL_VERSION,note:'A mai automatikus elemzés még nem fejeződött be.'});
};
