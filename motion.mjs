// One deterministic clock drives preview, scrubbing, stills, and encoded video.
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
export const motionDefaults={motion:'cascade',duration:12,energy:55,stagger:50,loop:false,turntable:false};
export function sanitizeMotion(input={}){
  const s={...motionDefaults};
  if(['cascade','unfurl','pulse'].includes(input.motion))s.motion=input.motion;
  for(const [key,min,max] of [['duration',6,24],['energy',0,100],['stagger',0,100]])if(typeof input[key]==='number'&&Number.isFinite(input[key]))s[key]=clamp(input[key],min,max);
  for(const key of ['loop','turntable'])if(typeof input[key]==='boolean')s[key]=input[key];
  return s;
}
export function timelineAt(progress,state){
  const p=clamp(progress),loop=state.loop;
  let t,phase;
  if(loop){
    if(p<.06){t=0;phase='Seed';}else if(p<.43){t=(p-.06)/.37;phase='Grow';}else if(p<.57){t=1;phase='Hold';}else if(p<.94){t=1-(p-.57)/.37;phase='Return';}else{t=0;phase='Seed';}
  }else{
    t=clamp((p-.045)/.785);phase=p<.045?'Seed':p>.83?'Hold':'Grow';
  }
  const growth=state.motion==='unfurl'?smooth(t):state.motion==='pulse'?t:Math.pow(t,1.25);
  if(phase==='Grow')phase=growth<.3?'Propagate':growth<.85?'Multiply':'Settle';
  return{progress:p,growth,clock:growth*(state.generations+1.25),phase,
    pulse:p*Math.max(2,Math.round(state.duration/3))*Math.PI*2,
    turn:state.turntable?(loop?p*Math.PI*2:smooth(p)*Math.PI*.32):0,
    energy:state.energy/100,stagger:state.stagger/100,
    mode:state.motion==='unfurl'?1:state.motion==='pulse'?2:0};
}
export function pointTiming(g,variation,frame){
  if(g===0)return{age:1,amount:1,alpha:1,pop:0};
  const birth=g-1+variation*frame.stagger*.65;
  const age=clamp((frame.clock-birth)/1.2);
  const base=frame.mode===1?smooth(age):1-Math.pow(1-age,3);
  const pop=Math.sin(Math.PI*age)*Math.pow(1-age,2);
  return{age,amount:base+pop*frame.energy*.7,alpha:smooth(age/.16),pop};
}
export function movingPosition(pos,origin,g,variation,frame){
  const {amount}=pointTiming(g,variation,frame);
  return pos.map((v,k)=>origin[k]+(v-origin[k])*amount);
}
export function traceAlpha(g,variation,fraction,frame){
  if(g===0)return 1;
  const birth=g-1+variation*frame.stagger*.65;
  return smooth((frame.clock-birth-fraction*.72)/.14);
}
export function pulseAt(g,variation,fraction,frame){
  const traveling=.5+.5*Math.cos(fraction*Math.PI*2-frame.pulse+g*.7+variation*3);
  const front=Math.exp(-Math.pow(frame.clock-g-.2,2)*3);
  return frame.energy*(Math.pow(traveling,12)*.65+front*.7)*(frame.mode===2?1.5:1);
}
