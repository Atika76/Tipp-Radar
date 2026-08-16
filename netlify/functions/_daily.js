const crypto=require('node:crypto');

function dailySecret(){
  return process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'';
}

function dailyToken(date){
  const secret=dailySecret();
  if(!secret)return'';
  return crypto.createHmac('sha256',secret).update(`tipp-radar-daily:${date}`).digest('hex');
}

function validDailyToken(date,token){
  const expected=dailyToken(date);
  if(!expected||typeof token!=='string'||token.length!==expected.length)return false;
  return crypto.timingSafeEqual(Buffer.from(token),Buffer.from(expected));
}

function rankPicks(a,b){
  const rating={green:0,yellow:1,red:2};
  return (rating[a.rating]??3)-(rating[b.rating]??3)||(Number(b.edge)||-999)-(Number(a.edge)||-999)||(Number(b.probability)||0)-(Number(a.probability)||0);
}

function selectTopFive(payloads){
  return (payloads||[]).flatMap(item=>item?.picks||[]).filter(p=>p.rating==='green'||p.rating==='yellow').sort(rankPicks).slice(0,5);
}

module.exports={dailySecret,dailyToken,validDailyToken,selectTopFive};
