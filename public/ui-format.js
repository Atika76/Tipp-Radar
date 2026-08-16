(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.TippRadarFormat=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const hasNumber=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
  const fmtPct=value=>hasNumber(value)?`${Number(value).toFixed(1)}%`:'—';
  const fmtOdds=value=>hasNumber(value)&&Number(value)>0?Number(value).toFixed(2):'—';
  return{hasNumber,fmtPct,fmtOdds};
});
