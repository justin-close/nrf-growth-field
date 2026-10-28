// Deterministic synthetic growth. No merchant data or financial forecasts.
import { motionDefaults, sanitizeMotion } from './motion.mjs';
import { buildCascadingModel } from './cascading.mjs';
import { buildFieldModel, isField } from './fields.mjs';
export const MAX_PER_GENERATION = 1500;
export const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const defaults = { form:'ascent', rate:2.2, generations:8, spread:65, depth:70, twist:25, folds:11, foldAmplitude:1,density:100, palette:0, style:'connected', dotSize:3, lineOpacity:35, filamentFinish:'off', fadeStrength:65, autoOrbit:false, progress:1, seed:1, ...motionDefaults };
export const bounds = {rate:[1.3,3],generations:[3,10],spread:[10,100],depth:[0,100],twist:[-180,180],folds:[4,20],foldAmplitude:[0,1.8],density:[35,180],palette:[0,6],dotSize:[1,7],lineOpacity:[5,90],fadeStrength:[0,100],progress:[0,1],seed:[1,999999]};
export function sanitize(input={}) {
  const s={...defaults,...sanitizeMotion(input)};
  for(const [k,[lo,hi]] of Object.entries(bounds)) if(typeof input[k]==='number'&&Number.isFinite(input[k])) s[k]=clamp(input[k],lo,hi);
  for(const k of ['generations','palette','seed','folds','density']) s[k]=Math.round(s[k]);
  for(const k of ['autoOrbit']) if(typeof input[k]==='boolean') s[k]=input[k];
  if(['ascent','multiply','network','cascading','radial','shell','bifurcation'].includes(input.form)) s.form=input.form;
  if(['connected','dots','filaments'].includes(input.style)) s.style=input.style;
  if(['off','silk','veil'].includes(input.filamentFinish)) s.filamentFinish=input.filamentFinish;
  return s;
}
export function random(seed){let a=seed|0;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
export function buildModel(settings){
  const s=sanitize(settings);
  if(s.form==='cascading')return buildCascadingModel(s);
  if(isField(s.form))return buildFieldModel(s);
  const rand=random(s.seed), points=[],edges=[],levels=[];
  const factor=s.spread/65,depth=s.depth/70,twist=s.twist*Math.PI/180;
  let theoreticalTotal=0;
  for(let g=0;g<=s.generations;g++){
    const target=Math.round(s.rate**g);theoreticalTotal+=target;
    const count=Math.min(MAX_PER_GENERATION,target),level=[],prev=levels[g-1],t=g/s.generations;
    for(let i=0;i<count;i++){
      const pi=g?Math.min(prev.length-1,Math.floor(i/count*prev.length)):0;
      const parent=g?points[prev[pi]]:null;
      let pos;
      if(s.form==='ascent'){
        const a=TAU*i/count+twist*t+(rand()-.5)*.1;
        const envelope=(Math.pow(s.rate,g*.42)-1)/(Math.pow(s.rate,s.generations*.42)-1);
        const radius=(.035+3.5*envelope)*factor*(.8+.2*rand());
        pos=[-4.4+8.4*t+Math.cos(a)*radius*.15,-1.8+3.2*t*t+Math.sin(a)*radius,Math.cos(a)*radius*depth];
      }else if(s.form==='multiply'){
        if(!g)pos=[0,0,0];
        else{
          const start=Math.ceil(pi/prev.length*count),end=Math.ceil((pi+1)/prev.length*count);
          const siblings=Math.max(1,end-start),j=i-start;
          const step=2.8*Math.pow(.49,Math.floor((g-1)/3))*factor;
          const offset=siblings===1?(rand()-.5)*.2:((j/(siblings-1))*2-1)*step;
          const axis=(g-1)%3, delta=[0,0,0];delta[axis]=offset;
          // Each generation splits in another spatial dimension.
          const a=twist*t+(s.seed-1)*.13,dx=delta[0]*Math.cos(a)-delta[2]*Math.sin(a),dz=delta[0]*Math.sin(a)+delta[2]*Math.cos(a);
          pos=[parent.pos[0]+dx,parent.pos[1]+delta[1],parent.pos[2]+dz*depth];
        }
      }else{
        if(!g)pos=[0,0,0];
        else{
          const y=1-2*(i+.5)/count,r=Math.sqrt(Math.max(0,1-y*y)),a=i*Math.PI*(3-Math.sqrt(5))+twist*t+s.seed*.17;
          const radius=(.5+3.8*Math.pow(t,.85))*factor;
          pos=[Math.cos(a)*r*radius,y*radius,Math.sin(a)*r*radius*depth];
        }
      }
      const id=points.length;
      points.push({pos,g,index:i,variation:rand()});level.push(id);
      if(g&&s.form!=='network')edges.push({a:prev[pi],b:id,g});
    }
    levels.push(level);
  }
  if(s.form==='network'){
    const used=new Set();
    const edge=(a,b)=>{if(a===b)return;const key=a<b?`${a}:${b}`:`${b}:${a}`;if(!used.has(key)){used.add(key);edges.push({a,b,g:Math.max(points[a].g,points[b].g)});}};
    for(let g=1;g<levels.length;g++){
      const level=levels[g],prev=levels[g-1],k=3;
      for(const a of level){
        const p=points[a].pos;let closest=prev[0],min=Infinity;const nearest=[];
        for(const b of prev){const q=points[b].pos;const d=(p[0]-q[0])**2+(p[1]-q[1])**2+(p[2]-q[2])**2;if(d<min){min=d;closest=b;}}
        edge(a,closest);
        for(const b of level){if(a===b)continue;const q=points[b].pos;const d=(p[0]-q[0])**2+(p[1]-q[1])**2+(p[2]-q[2])**2;if(nearest.length<k||d<nearest[nearest.length-1].d){nearest.push({b,d});nearest.sort((x,y)=>x.d-y.d);if(nearest.length>k)nearest.pop();}}
        for(const {b} of nearest)edge(a,b);
      }
    }
  }
  return {points,edges,levels,theoreticalTotal,finalCount:Math.round(s.rate**s.generations),sampled:theoreticalTotal>points.length};
}
export function edgeSamples(model,edge,form,steps=12){
  const a=model.points[edge.a].pos,b=model.points[edge.b].pos,result=[];
  for(let j=0;j<=steps;j++){
    const t=j/steps,u=1-t;
    if(form==='ascent'){
      const dx=b[0]-a[0];
      result.push([u*u*u*a[0]+3*u*u*t*(a[0]+dx*.55)+3*u*t*t*(b[0]-dx*.35)+t*t*t*b[0],u*u*u*a[1]+3*u*u*t*a[1]+3*u*t*t*b[1]+t*t*t*b[1],u*u*u*a[2]+3*u*u*t*a[2]+3*u*t*t*b[2]+t*t*t*b[2]]);
    }else{
      const lift=form==='network'?1+Math.sin(Math.PI*t)*.03:1;
      result.push(a.map((v,k)=>(v*u+b[k]*t)*lift));
    }
  }
  return result;
}
