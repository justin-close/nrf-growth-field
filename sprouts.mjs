// Sprouts: small filaments, each ending in a dot, that bud from marks already
// on screen at staggered moments across the animation. Births follow their own
// timing window and curve; the curve sets how fast new sprouts arrive.
import { cubicBezier, curvePresets, timingFractions } from './motion.mjs?v=20261111-motion-core';
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
// Seconds a sprout takes to reach full length.
export const SPROUT_GROW_SECONDS=.9;
function random(seed){let s=(seed*2654435761>>>0)||1;return()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
const unit=v=>{const l=Math.hypot(...v)||1;return v.map(x=>x/l);};
const sphere=r=>{const u=2*r()-1,a=r()*Math.PI*2,s=Math.sqrt(1-u*u);return[Math.cos(a)*s,Math.sin(a)*s,u];};
// Inverse of an eased 0–1 curve, so sprout k is born when the curve reaches k/N.
function inverse(ease,y){let lo=0,hi=1;for(let i=0;i<32;i++){const m=(lo+hi)/2;if(ease(m)<y)lo=m;else hi=m;}return(lo+hi)/2;}

export function sproutsActive(state){return!!state.sprouts&&state.sequence!=='orbit'&&state.sproutCount>0;}

// anchors: {count, rest(i)→[x,y,z], origin, slice(frame)→alpha(i)}; timeline(p)→frame.
export function planSprouts(state,anchors,timeline,radius){
  if(!sproutsActive(state)||!anchors.count)return null;
  const r=random(state.seed*7919+state.sproutCount*31+17),d=state.duration;
  const a=clamp(state.sproutStart/d),b=Math.max(a,clamp(state.sproutEnd/d));
  const ease=cubicBezier(curvePresets[state.sproutCurve]||state.sproutBezier);
  const n=Math.round(state.sproutCount),births=[],grow=Math.max(1e-6,Math.min(SPROUT_GROW_SECONDS/d,b-a)),birthEnd=Math.max(a,b-grow);
  for(let k=0;k<n;k++)births.push(a+(birthEnd-a)*inverse(ease,(k+r())/n));
  births.sort((x,y)=>x-y);
  // Visibility is sampled in slices; each sprout takes an anchor already showing.
  const slices=32,visible=[];
  for(let s=0;s<=slices;s++){
    const alpha=anchors.slice(timeline(a+(b-a)*s/slices)),list=[];
    for(let i=0;i<anchors.count;i++)if(alpha(i)>.6)list.push(i);
    visible.push(list);
  }
  const length=radius*.32*state.sproutLength/100,branch=state.sproutBranch/100,sprouts=[];
  const reach=i=>{const p=anchors.rest(i);return Math.hypot(p[0]-anchors.origin[0],p[1]-anchors.origin[1],p[2]-anchors.origin[2]);};
  let farthest=1e-6;for(let i=0;i<anchors.count;i++)farthest=Math.max(farthest,reach(i));
  for(const birth of births){
    // Round down so the anchor was already showing at the slice before birth.
    const list=visible[Math.floor(clamp(b>a?(birth-a)/(b-a):1)*slices)];
    let parent=-1,anchor=-1,from,scale=1;
    // Branching buds from a sprout that has already finished growing.
    if(branch>0&&r()<branch){
      const grown=[];for(let j=0;j<sprouts.length;j++)if(sprouts[j].birth+sprouts[j].grow<=birth)grown.push(j);
      if(grown.length){parent=grown[Math.floor(r()*grown.length)];from=sprouts[parent].dir;scale=.7*sprouts[parent].scale;}
    }
    if(parent<0){
      if(!list.length)continue;
      // Best of two by distance from the origin leans sprouts toward the growing edge;
      // buds near the seed stay short so early sprouts don't crowd it.
      const x=list[Math.floor(r()*list.length)],y=list[Math.floor(r()*list.length)];
      anchor=reach(x)>=reach(y)?x:y;scale=.3+.7*reach(anchor)/farthest;const p=anchors.rest(anchor);from=p.map((v,i)=>v-anchors.origin[i]);
    }
    const outward=Math.hypot(...from)>1e-6?unit(from):sphere(r),jitter=sphere(r);
    const dir=unit(outward.map((v,i)=>v*.75+jitter[i]*.65));
    sprouts.push({birth,grow,anchor,parent,dir,scale,length:length*(.45+.75*r())*scale,size:.75+.45*r(),
      // The same per-strand spread the field traces use, so sprouts sit in the crowd.
      alpha:.14+.24*r(),variation:r()});
  }
  return{sprouts,segmentCount:sprouts.length,markCount:sprouts.length,retractAfter:timingFractions(state).buildEnd};
}

// live(i)→{pos,alpha} for anchors at this frame; fills a field-style pose.
// lineAlpha(sprout,t) is the form's own strand opacity at t (0 base, 1 tip).
export function updateSproutPose(plan,frame,live,pose,{dotRadius=1,lineAlpha=()=>1}={}){
  const p=frame.progress,retract=p>plan.retractAfter?frame.growth:1,tips=[];
  let active=0;
  for(const [k,s] of plan.sprouts.entries()){
    const age=clamp((p-s.birth)/s.grow);
    let base,alpha;
    if(s.parent>=0){const t=tips[s.parent];base=t.pos;alpha=t.alpha;}
    else{const a=live(s.anchor);base=a.pos;alpha=a.alpha;}
    const e=1-Math.pow(1-age,3),l=s.length*e*retract;
    const tip=[base[0]+s.dir[0]*l,base[1]+s.dir[1]*l,base[2]+s.dir[2]*l];
    const shown=age>0?Math.min(1,alpha)*smooth(age/.15)*smooth(retract/.05):0;
    tips.push({pos:tip,alpha:shown});
    pose.linePositions.set(base,k*6);pose.linePositions.set(tip,k*6+3);
    pose.lineAlpha[k*2]=shown*lineAlpha(s,0);pose.lineAlpha[k*2+1]=shown*lineAlpha(s,e);
    pose.dotPositions.set(tip,k*3);pose.dotAlpha[k]=shown*smooth(age/.3);
    pose.dotRadius[k]=dotRadius*s.size*(.45+.55*e);
    if(shown>.05)active++;
  }
  pose.activeTraces=pose.activeMarks=active;pose.growth=frame.growth;
  return pose;
}
