(function(root){
  'use strict';
  const zones=['TL','TR','BL','BR'];
  const safe=n=>Number.isSafeInteger(n)&&n>=0;
  function validate(s){
    if(!s||s.schema_version!==1||s.type!=='shot')return false;
    if(typeof s.device_id!=='string'||!s.device_id||typeof s.boot_id!=='string'||!s.boot_id||!safe(s.shot_id)||!safe(s.device_time_us))return false;
    if(![s.gate1_us,s.gate2_us].every(n=>n===null||safe(n)) || !(s.gate_spacing_m===null||(Number.isFinite(s.gate_spacing_m)&&s.gate_spacing_m>0)))return false;
    if(s.source!=='sensor'||!['valid','invalid'].includes(s.speed_status))return false;
    if(!['hit','miss','unknown'].includes(s.result)||![null,...zones].includes(s.selected_zone)||![null,...zones].includes(s.detected_zone))return false;
    if(s.result==='hit'&&(!s.selected_zone||s.selected_zone!==s.detected_zone))return false;
    if(s.result==='miss'&&(!s.selected_zone||s.selected_zone===s.detected_zone))return false;
    if(s.speed_status==='valid'){
      if(!Number.isFinite(s.gate_spacing_m)||s.gate_spacing_m<=0||!safe(s.gate1_us)||!safe(s.gate2_us)||s.gate2_us<=s.gate1_us||!Number.isFinite(s.speed_mps)||s.speed_mps<=0)return false;
      const expected=s.gate_spacing_m*1e6/(s.gate2_us-s.gate1_us);
      if(Math.abs(expected-s.speed_mps)>Math.max(.02,expected*.005))return false;
    }else if(s.speed_mps!==null)return false;
    return true;
  }
  function key(s){return [s.device_id,s.boot_id,s.shot_id].join(':');}
  function summary(shots){
    const valid=shots.filter(s=>s.speed_status==='valid');
    const classified=shots.filter(s=>s.result!=='unknown');
    return {count:shots.length,hits:classified.filter(s=>s.result==='hit').length,classified:classified.length,
      average:valid.length?valid.reduce((a,s)=>a+s.speed_mps,0)/valid.length:null};
  }
  const api={validate,key,summary,zones};
  if(typeof module!=='undefined')module.exports=api; else root.SoccerModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
