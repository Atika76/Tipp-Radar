const {json,settleRecentPicks,MODEL_VERSION}=require('./_shared');

exports.handler=async()=>{
  const summary=await settleRecentPicks(14);
  return json(summary.errors?207:200,{ok:summary.errors===0,modelVersion:MODEL_VERSION,...summary,completedAt:new Date().toISOString()});
};
