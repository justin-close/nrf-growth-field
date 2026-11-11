// One deterministic clock drives preview, scrubbing, stills, and encoded video.
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
export const DURATION_BOUNDS=[3,60];
export const TIMING_KEYS=['buildStart','buildEnd','deconStart','deconEnd'];
// Easing presets, as CSS cubic-bezier(x1, y1, x2, y2) control points.
export const curvePresets={linear:[0,0,1,1],easeIn:[.42,0,1,1],easeOut:[0,0,.58,1],easeInOut:[.42,0,.58,1],expoIn:[.7,0,.84,0],expoOut:[.16,1,.3,1],expoInOut:[.87,0,.13,1]};
export const buildCurves=['style',...Object.keys(curvePresets),'custom'];
export const deconCurves=['mirror',...Object.keys(curvePresets),'custom'];
export const zoomCurves=[...Object.keys(curvePresets),'custom'];
export const ZOOM_BOUNDS=[25,400];
export const ROTATION_BOUNDS=[-720,720];
export const SPREAD_BOUNDS=[10,100];
export const DOF_BLUR_BOUNDS=[0,100];
export const EXT_BOUNDS=[1,9];
// Version 2 proportions: a single sequence, or grow, hold, return and reseed.
export function defaultTiming(duration,loop=false){
  const f=loop?[.06,.43,.57,.94]:[.045,.83,.9,1];
  return Object.fromEntries(TIMING_KEYS.map((k,i)=>[k,Math.round(f[i]*duration*100)/100]));
}
export const motionDefaults={sequence:'growth',motion:'cascade',duration:12,energy:55,stagger:50,loop:false,turntable:false,
  // Burst: every mark leaves the seed together and travels straight to its place.
  burst:false,
  // Ambient growth: every mark eases outward from the origin by driftAmount% over
  // the whole timeline, each at its own staggered moment.
  drift:false,driftAmount:10,driftStagger:60,
  // Sprouts: new filaments with tip dots bud from visible marks across sproutStart–sproutEnd.
  sprouts:false,sproutCount:150,sproutLength:50,sproutBranch:25,
  ...defaultTiming(12),deconstruct:false,buildCurve:'style',buildBezier:[...curvePresets.easeInOut],deconCurve:'mirror',deconBezier:[...curvePresets.easeInOut],
  // Camera move: a dolly relative to the framing set in the viewport (100%).
  camMove:false,zoomFocus:'origin',zoomFrom:220,zoomTo:100,zoomSync:true,zoomStart:.54,zoomEnd:9.96,zoomCurve:'easeInOut',zoomBezier:[...curvePresets.easeInOut],
  // Rotation about the vertical axis, in degrees from the orbited view (0°).
  rotMove:false,rotPivot:'origin',rotFrom:-90,rotTo:0,rotStart:.54,rotEnd:9.96,rotCurve:'easeInOut',rotBezier:[...curvePresets.easeInOut],
  // Spread grows from spreadFrom to the Spread set in Shape the growth.
  spreadMove:false,spreadFrom:20,spreadStart:.54,spreadEnd:9.96,spreadCurve:'easeInOut',spreadBezier:[...curvePresets.easeInOut],
  // Depth-of-field blur moves from dofFrom to dofTo; 0 is sharp.
  dofMove:false,dofFrom:40,dofTo:0,dofStart:.54,dofEnd:9.96,dofCurve:'easeInOut',dofBezier:[...curvePresets.easeInOut],
  // Keep growing: the build stops at generation extFrom; the rest multiply later.
  extMove:false,extFrom:4,extStart:.54,extEnd:9.96,extCurve:'linear',extBezier:[...curvePresets.linear],
  sproutStart:.54,sproutEnd:11.4,sproutCurve:'linear',sproutBezier:[...curvePresets.linear]};
const validBezier=b=>Array.isArray(b)&&b.length===4&&b.every(n=>typeof n==='number'&&Number.isFinite(n));
export const sanitizeBezier=b=>[clamp(b[0]),clamp(b[1]),clamp(b[2]),clamp(b[3])];
export function sanitizeMotion(input={}){
  const s=structuredClone(motionDefaults);
  if(['growth','orbit'].includes(input.sequence))s.sequence=input.sequence;
  if(['cascade','unfurl','pulse'].includes(input.motion))s.motion=input.motion;
  for(const [key,min,max] of [['duration',...DURATION_BOUNDS],['energy',0,100],['stagger',0,100]])if(typeof input[key]==='number'&&Number.isFinite(input[key]))s[key]=clamp(input[key],min,max);
  for(const key of ['loop','turntable','burst','drift','sprouts'])if(typeof input[key]==='boolean')s[key]=input[key];
  // Studies saved before custom timing keep their proportional phases.
  Object.assign(s,defaultTiming(s.duration,s.loop));s.deconstruct=s.loop;
  for(const key of TIMING_KEYS)if(typeof input[key]==='number'&&Number.isFinite(input[key]))s[key]=clamp(input[key],0,DURATION_BOUNDS[1]);
  if(typeof input.deconstruct==='boolean')s.deconstruct=input.deconstruct;
  s.zoomStart=s.rotStart=s.spreadStart=s.dofStart=s.extStart=s.buildStart;s.zoomEnd=s.rotEnd=s.spreadEnd=s.dofEnd=s.extEnd=s.buildEnd;
  // Sprouts default to the whole animation: build start until just before it ends or returns.
  s.sproutStart=s.buildStart;s.sproutEnd=Math.round((s.deconstruct?s.deconStart:s.duration*.95)*100)/100;
  for(const key of ['zoomStart','zoomEnd','rotStart','rotEnd','spreadStart','spreadEnd','dofStart','dofEnd','extStart','extEnd','sproutStart','sproutEnd'])if(typeof input[key]==='number'&&Number.isFinite(input[key]))s[key]=clamp(input[key],0,DURATION_BOUNDS[1]);
  for(const key of ['zoomFrom','zoomTo'])if(typeof input[key]==='number'&&Number.isFinite(input[key]))s[key]=clamp(input[key],...ZOOM_BOUNDS);
  for(const key of ['rotFrom','rotTo'])if(typeof input[key]==='number'&&Number.isFinite(input[key]))s[key]=clamp(input[key],...ROTATION_BOUNDS);
  if(typeof input.spreadFrom==='number'&&Number.isFinite(input.spreadFrom))s.spreadFrom=clamp(input.spreadFrom,...SPREAD_BOUNDS);
  if(typeof input.extFrom==='number'&&Number.isFinite(input.extFrom))s.extFrom=Math.round(clamp(input.extFrom,...EXT_BOUNDS));
  if(typeof input.driftAmount==='number'&&Number.isFinite(input.driftAmount))s.driftAmount=clamp(input.driftAmount,0,40);
  for(const [key,min,max,step] of [['sproutCount',0,600,1],['sproutLength',5,100,1],['sproutBranch',0,90,1]])if(typeof input[key]==='number'&&Number.isFinite(input[key]))s[key]=Math.round(clamp(input[key],min,max)/step)*step;
  if(typeof input.driftStagger==='number'&&Number.isFinite(input.driftStagger))s.driftStagger=clamp(input.driftStagger,0,90);
  for(const key of ['dofFrom','dofTo'])if(typeof input[key]==='number'&&Number.isFinite(input[key]))s[key]=clamp(input[key],...DOF_BLUR_BOUNDS);
  for(const key of ['camMove','zoomSync','rotMove','spreadMove','dofMove','extMove'])if(typeof input[key]==='boolean')s[key]=input[key];
  if(['origin','center'].includes(input.zoomFocus))s.zoomFocus=input.zoomFocus;
  if(['origin','center'].includes(input.rotPivot))s.rotPivot=input.rotPivot;
  if(zoomCurves.includes(input.zoomCurve))s.zoomCurve=input.zoomCurve;
  for(const key of ['rotCurve','spreadCurve','dofCurve','extCurve','sproutCurve'])if(zoomCurves.includes(input[key]))s[key]=input[key];
  if(buildCurves.includes(input.buildCurve))s.buildCurve=input.buildCurve;
  if(deconCurves.includes(input.deconCurve))s.deconCurve=input.deconCurve;
  for(const key of ['buildBezier','deconBezier','zoomBezier','rotBezier','spreadBezier','dofBezier','extBezier','sproutBezier'])if(validBezier(input[key]))s[key]=sanitizeBezier(input[key]);
  // Persist the same ordered, bounded values that controls and rendering use.
  let previous=0;
  for(const key of TIMING_KEYS){s[key]=Math.max(previous,Math.round(clamp(s[key],0,s.duration)*100)/100);previous=s[key];}
  for(const kind of ['zoom','rot','spread','dof','ext','sprout']){
    s[kind+'Start']=clamp(s[kind+'Start'],0,s.duration);
    s[kind+'End']=clamp(s[kind+'End'],s[kind+'Start'],s.duration);
  }
  return s;
}
// Solve x(t) = x for a cubic bezier anchored at (0,0) and (1,1), then return y.
export function cubicBezier([x1,y1,x2,y2]){
  const cx=3*x1,bx=3*(x2-x1)-cx,ax=1-cx-bx,cy=3*y1,by=3*(y2-y1)-cy,ay=1-cy-by;
  const sx=t=>((ax*t+bx)*t+cx)*t,sy=t=>((ay*t+by)*t+cy)*t,dx=t=>(3*ax*t+2*bx)*t+cx;
  return x=>{
    if(x<=0)return 0;if(x>=1)return 1;
    let t=x;
    for(let i=0;i<8;i++){const e=sx(t)-x,d=dx(t);if(Math.abs(e)<1e-6)return sy(t);if(Math.abs(d)<1e-6)break;t-=e/d;}
    let lo=0,hi=1;t=x;
    for(let i=0;i<40;i++){const v=sx(t);if(Math.abs(v-x)<1e-6)break;if(v<x)lo=t;else hi=t;t=(lo+hi)/2;}
    return sy(t);
  };
}
const styleEase=motion=>motion==='unfurl'?smooth:motion==='pulse'?t=>clamp(t):t=>Math.pow(clamp(t),1.25);
const bezierFor=(curve,bezier)=>cubicBezier(curvePresets[curve]||bezier);
// Build: time → growth. Deconstruct: time → growth, falling from 1 to 0.
export function buildEase(state){return state.buildCurve==='style'?styleEase(state.motion):bezierFor(state.buildCurve,state.buildBezier);}
export function deconEase(state){
  if(state.deconCurve==='mirror'){const build=buildEase(state);return u=>build(1-u);}
  const ease=bezierFor(state.deconCurve,state.deconBezier);return u=>1-ease(u);
}
// Phase boundaries as ordered fractions of the duration. Times past the end
// are clamped here, so a shorter duration never discards the stored seconds.
export function timingFractions(state){
  const d=state.duration;let previous=0;
  const f={};for(const key of TIMING_KEYS){f[key]=clamp(Math.max(previous,(state[key]||0)/d));previous=f[key];}
  if(!state.deconstruct){f.deconStart=f.deconEnd=1;}
  return f;
}
export function zoomEase(state){return bezierFor(state.zoomCurve,state.zoomBezier);}
// Camera move span as fractions; synced moves follow the build exactly.
export function zoomFractions(state){
  if(state.zoomSync){const f=timingFractions(state);return{zoomStart:f.buildStart,zoomEnd:f.buildEnd};}
  const a=clamp(state.zoomStart/state.duration);return{zoomStart:a,zoomEnd:Math.max(a,clamp(state.zoomEnd/state.duration))};
}
// Zoom multiplies the viewport framing. Interpolating in log space keeps a
// 4× push-in and the matching pull-back feeling equally paced.
export function zoomAt(progress,state){
  if(!state.camMove||state.sequence==='orbit')return 1;
  const f=zoomFractions(state),from=state.zoomFrom/100,to=state.zoomTo/100;
  return from*Math.pow(to/from,zoomEase(state)(span(clamp(progress),f.zoomStart,f.zoomEnd)));
}
// Rotation and spread are independent moves, each with its own span and curve.
export const moveEase=(state,kind)=>bezierFor(state[kind+'Curve'],state[kind+'Bezier']);
export function moveFractions(state,kind){const a=clamp(state[kind+'Start']/state.duration);return{start:a,end:Math.max(a,clamp(state[kind+'End']/state.duration))};}
const moveAt=(progress,state,kind)=>{const f=moveFractions(state,kind);return moveEase(state,kind)(span(clamp(progress),f.start,f.end));};
// Radians added to the turntable; the orbit camera itself never moves.
export function rotationAt(progress,state){
  if(!state.rotMove||state.sequence==='orbit')return 0;
  return(state.rotFrom+(state.rotTo-state.rotFrom)*moveAt(progress,state,'rot'))*Math.PI/180;
}
// Weight of the target spread: 0 is spreadFrom, 1 is the Spread slider.
export function spreadAt(progress,state){return!state.spreadMove||state.sequence==='orbit'?1:moveAt(progress,state,'spread');}
// Blur strength for depth of field; null leaves the Finish slider in charge.
export function dofBlurAt(progress,state){
  if(!state.dofMove||state.sequence==='orbit')return null;
  return state.dofFrom+(state.dofTo-state.dofFrom)*moveAt(progress,state,'dof');
}
// The clock value at which the last dot lands: a dot born at g-1+.65*stagger
// takes 1.2 to arrive, so growth=1 is exactly the moment motion stops.
export const settleClock=(state,generations=state.generations)=>generations+.2+.65*state.stagger/100+1e-9;
// Keep growing applies to the generative forms; the build then ends at this generation.
export function extensionBase(state){
  if(!state.extMove||state.sequence==='orbit'||!['ascent','multiply','network'].includes(state.form))return null;
  return Math.min(state.extFrom,state.generations-1);
}
const span=(p,a,b)=>b-a>1e-6?clamp((p-a)/(b-a)):p>=a?1:0;
export function timelineAt(progress,state){
  const p=clamp(progress),loop=state.loop;
  if(state.sequence==='orbit')return{progress:p,growth:1,clock:state.generations+1.25,phase:'Orbit loop',zoom:1,spreadMix:1,dofBlur:null,burst:0,exact:0,ext:null,drift:null,pulse:0,turn:p*Math.PI*2,energy:0,stagger:0,mode:0};
  const f=timingFractions(state);
  let growth,phase,local=0;
  if(p<f.buildStart){growth=0;phase='Seed';}
  else if(p<=f.buildEnd&&f.buildEnd>f.buildStart){local=span(p,f.buildStart,f.buildEnd);growth=buildEase(state)(local);phase='Grow';}
  else if(!state.deconstruct||p<f.deconStart){growth=1;local=1;phase='Hold';}
  else if(p<f.deconEnd){local=span(p,f.deconStart,f.deconEnd);growth=deconEase(state)(local);phase='Deconstruct';}
  else{growth=0;local=1;phase=loop?'Seed':'Cleared';}
  growth=clamp(growth);
  if(phase==='Grow')phase=growth<.3?'Propagate':growth<.85?'Multiply':'Settle';
  const base=extensionBase(state),stagger=state.stagger/100,energy=state.energy/100,mode=state.motion==='unfurl'?1:state.motion==='pulse'?2:0;
  const pulse=p*Math.max(2,Math.round(state.duration/3))*Math.PI*2;
  // Later generations run on their own clock: at 0 they wait at generation base,
  // at 1 the last of them has landed. Deconstruct takes them back with the build.
  let ext=null;
  if(base!==null){
    const amount=Math.min(moveAt(p,state,'ext'),growth);
    ext={base,amount,frame:{growth,clock:base+amount*(settleClock(state)-base),exact:0,burst:0,energy,stagger,mode,pulse}};
    if(amount>0&&amount<1&&phase==='Hold')phase='Keep growing';
  }
  return{progress:p,growth,local,zoom:zoomAt(p,state),clock:growth*settleClock(state,base??state.generations),phase,ext,
    // An explicit curve owns the whole ease; 'Motion style' keeps per-dot landings.
    exact:state.buildCurve!=='style'?1:0,burst:state.burst?1:0,dofBlur:dofBlurAt(p,state),
    pulse,
    turn:(state.turntable&&!state.rotMove?(loop?p*Math.PI*2:smooth(p)*Math.PI*.32):0)+rotationAt(p,state),
    drift:state.drift&&state.driftAmount>0?{amount:state.driftAmount/100,stagger:state.driftStagger/100,progress:p}:null,
    spreadMix:spreadAt(p,state),energy,stagger,mode};
}
// The progress at which the completed composition is on screen.
export function restProgress(state){
  if(state.sequence==='orbit')return 0;
  if(!state.deconstruct)return 1;
  const f=timingFractions(state);return(f.buildEnd+f.deconStart)/2;
}
// Marks past the extension base follow the later clock, in the original style.
const phaseFrame=(g,frame)=>frame.ext&&g>frame.ext.base?frame.ext.frame:frame;
// Ambient growth scale for a mark: each one eases from 1 to 1+amount inside its
// own window of the timeline, offset by its variation (0–1).
export function driftScale(variation,frame){
  const d=frame.drift;if(!d)return 1;
  return 1+d.amount*smooth((d.progress-variation*d.stagger)/Math.max(1-d.stagger,.05));
}
export function pointTiming(g,variation,frame){
  frame=phaseFrame(g,frame);
  if(g===0)return{age:1,amount:1,alpha:1,pop:0};
  // Burst origins are all the seed, so growth alone carries every mark.
  if(frame.burst)return{age:1,amount:frame.growth,alpha:1,pop:0};
  const birth=g-1+variation*frame.stagger*.65;
  const age=clamp((frame.clock-birth)/1.2);
  const base=frame.exact?age:frame.mode===1?smooth(age):1-Math.pow(1-age,3);
  const pop=Math.sin(Math.PI*age)*Math.pow(1-age,2);
  return{age,amount:base+pop*frame.energy*.7,alpha:smooth(age/.16),pop};
}
export function movingPosition(pos,origin,g,variation,frame){
  const {amount}=pointTiming(g,variation,frame);
  return pos.map((v,k)=>origin[k]+(v-origin[k])*amount);
}
export function traceAlpha(g,variation,fraction,frame){
  frame=phaseFrame(g,frame);
  if(g===0||frame.burst)return 1;
  const birth=g-1+variation*frame.stagger*.65;
  return smooth((frame.clock-birth-fraction*.72)/.14);
}
export function pulseAt(g,variation,fraction,frame){
  frame=phaseFrame(g,frame);
  const traveling=.5+.5*Math.cos(fraction*Math.PI*2-frame.pulse+g*.7+variation*3);
  const front=Math.exp(-Math.pow(frame.clock-g-.2,2)*3);
  return frame.energy*(Math.pow(traveling,12)*.65+front*.7)*(frame.mode===2?1.5:1);
}

// Changing total duration retimes every phase and effect proportionally.
export function retimeDuration(state,duration){
  const next=clamp(duration,...DURATION_BOUNDS),ratio=next/state.duration;
  for(const key of [...TIMING_KEYS,...['zoom','rot','spread','dof','ext','sprout'].flatMap(k=>[k+'Start',k+'End'])])state[key]=Math.round(state[key]*ratio*100)/100;
  state.duration=next;
  return state;
}
