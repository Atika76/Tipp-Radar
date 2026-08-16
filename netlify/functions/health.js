const {json,apiConfigured,supabaseConfigured,SPORT_CONFIG}=require('./_shared');
exports.handler=async()=>json(200,{ok:true,apiConfigured:apiConfigured(),supabaseConfigured:supabaseConfigured(),mode:apiConfigured()?(supabaseConfigured()?'live+persistence':'live'):'demo',version:'v4',sports:Object.entries(SPORT_CONFIG).map(([key,v])=>({key,label:v.label,emoji:v.emoji}))});
