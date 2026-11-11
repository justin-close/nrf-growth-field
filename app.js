import {frameForWorkspace,switchWorkspace,exportContext} from './workspace.mjs?v=20261111-motion-core';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { defaults, sanitize, buildModel, edgeSamples, clamp } from './model.mjs?v=20261111-motion-core';
import { timelineAt, extensionBase, driftScale, pointTiming, movingPosition, traceAlpha, pulseAt, restProgress, retimeDuration } from './motion.mjs?v=20261111-motion-core';
import { createDofUniforms, dofGLSL, dotFadeGLSL, dotShapeGLSL, dofCoc, dotFade, hairlineFade } from './dof.mjs?v=20261111-motion-core';
import { createTimingUI } from './timing-ui.mjs?v=20261111-motion-core';
import { checkVideoSupport, exportGrowthVideo } from './video-export.mjs?v=20261111-motion-core';
import { createCascadingArtwork } from './cascading-scene.mjs?v=20261111-motion-core';
import { createFieldArtwork } from './fields-scene.mjs?v=20261111-motion-core';
import { isField, FIELD_LINE_WIDTH, createFieldPose, updateFieldPose } from './fields.mjs?v=20261111-motion-core';
import { planSprouts, updateSproutPose, sproutsActive } from './sprouts.mjs?v=20261111-motion-core';
import { filamentFade, filamentFinishMode, filamentGLSL } from './finish.mjs?v=20261111-motion-core';
import { cropPrintLayout, printLayout, printStroke, printRadius, printAlpha, svgPhysicalFrame, rasterizePrint } from './print-export.mjs?v=20261111-motion-core';

import {buildPrintPDF} from './print-pdf.mjs?v=20261111-motion-core';
import {artworkInks} from './print-colors.mjs?v=20261111-motion-core';

const $=id=>document.getElementById(id), $$=s=>[...document.querySelectorAll(s)];
const STORAGE='nrf-growth-field-v1';
const palettes=[
  {name:'Fresh Green / Expanse',bg:'#121412',primary:'#5AEB41',secondary:'#F6F5EF',text:'#F6F5EF',muted:'#a4aaa1'},
  {name:'Vivid Blue / Reflex Blue',bg:'#000F82',primary:'#59FFFF',secondary:'#F6F5EF',text:'#F6F5EF',muted:'#b5c5e4'},
  {name:'Orange / Mahogany',bg:'#65131A',primary:'#FF5825',secondary:'#F6F5EF',text:'#F6F5EF',muted:'#e6bcb6'},
  {name:'Fresh Green / Fir',bg:'#173B2B',primary:'#5AEB41',secondary:'#F6F5EF',text:'#F6F5EF',muted:'#b0cbb7'},
  {name:'Chalk / Reflex Blue',bg:'#000F82',primary:'#F6F5EF',secondary:'#5AEB41',text:'#F6F5EF',muted:'#b5c5e4'},
  {name:'Expanse / Fresh Green',bg:'#5AEB41',primary:'#121412',secondary:'#173B2B',text:'#121412',muted:'#244f1c'},
  {name:'Reflex Blue / Chalk',bg:'#F6F5EF',primary:'#000F82',secondary:'#000F82',text:'#121412',muted:'#5c6257'}
];
const forms={ascent:{number:'01',label:'EXPONENTIAL GROWTH'},multiply:{number:'02',label:'MULTIPLICITY'},network:{number:'03',label:'NETWORK EFFECT'},cascading:{number:'04',label:'CASCADING FOLDS'},radial:{number:'05',label:'RADIAL PROLIFERATION'},shell:{number:'06',label:'DISSEMINATION SHELL'},bifurcation:{number:'07',label:'BIFURCATION FIELD'}};
const finishLabels={off:'Even strands, with the original clarity.',silk:'Softly tapered strands gather into a fine, luminous weave.',veil:'Staggered translucent bands create layered, airy texture.'};
const motionLabels={cascade:'Staggered arrivals gather into a growing field.',unfurl:'A slower opening, with soft landings and flowing connections.',pulse:'Waves of energy travel through an expanding network.'};
const dofUniforms=createDofUniforms(),focusBounds=new THREE.Sphere();
let spreadMorph=null,cameraZoom=1,cameraFocus=null,exporting=false,exportController=null,supportRevision=0,motionFrame,origins=[],pivot;
let state={...defaults},saved=[],initialView=null,dirty=true,playing=false,lastTime=0,rebuildTimer=0,toastTimer=0;
try{const stored=JSON.parse(localStorage.getItem(STORAGE)||'null');if(stored){state=sanitize(stored.state);saved=Array.isArray(stored.saved)?stored.saved.filter(x=>x&&typeof x==='object'&&x.state&&typeof x.state==='object').slice(0,12):[];initialView=stored.view;}}catch{}
try{if(location.hash.startsWith('#study=')){const shared=JSON.parse(atob(decodeURIComponent(location.hash.slice(7))));state=sanitize(shared.state);initialView=shared.view;}}catch{toast('This study link could not be read. Showing the default field.');}
if(matchMedia('(prefers-reduced-motion: reduce)').matches)state.autoOrbit=false;

let inspectorTab='animation',timingUI,renderer,scene,camera,controls,art,model,dotMaterial,lineMaterial,cascadingArtwork,fieldArtwork,paths=[];
let sproutArtwork=null,sproutKey='',modelRevision=0,compositionBounds=[];
try{initScene();initUI();rebuild();applyView(initialView);animate(0);$('loading').hidden=true;}catch(error){console.error(error);$('loading').hidden=true;$('webgl-error').hidden=false;for(const id of ['play','export-open','save','share','restart'])$(id).disabled=true;}

function initScene(){
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
  $('viewport').appendChild(renderer.domElement);
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(36,1,.1,200);
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.09;controls.minDistance=3;controls.maxDistance=65;controls.autoRotateSpeed=.45;controls.enablePan=true;
  controls.addEventListener('change',()=>{dirty=true;});controls.addEventListener('end',persist);
  art=new THREE.Group();scene.add(art);pivot=new THREE.Vector3();
  new ResizeObserver(resize).observe($('viewport'));resize();resetView();
  renderer.domElement.addEventListener('dblclick',()=>{resetView();persist();});
  renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();playing=false;$('webgl-error').hidden=false;$('webgl-error').querySelector('p').textContent='The graphics context was interrupted. Reload the page to restore your saved study.';});
}
function resize(){if(exporting)return;const {width,height}=$('viewport').getBoundingClientRect();renderer.setSize(width,height,false);camera.aspect=width/Math.max(1,height);camera.updateProjectionMatrix();dirty=true;}
// Any motion that turns the form widens the framing to its full sweep.
function spins(){return state.workspace==='motion'&&(state.turntable||state.sequence==='orbit'||state.rotMove);}
function viewSnapshot(){return{position:camera.position.toArray(),target:controls.target.toArray()};}
function validVector(v){return Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1000);}
function applyView(v){if(v&&validVector(v.position)&&validVector(v.target)&&new THREE.Vector3(...v.position).distanceTo(new THREE.Vector3(...v.target))>1){camera.position.fromArray(v.position);controls.target.fromArray(v.target);const distance=camera.position.distanceTo(controls.target);controls.maxDistance=Math.max(65,distance*1.5);camera.far=Math.max(200,distance*4);camera.updateProjectionMatrix();controls.update();dirty=true;}else resetView();}
function resetView(view='perspective'){
  const dir=view==='current'?camera.position.clone().sub(controls.target).normalize():view==='front'?new THREE.Vector3(0,0,1):view==='top'?new THREE.Vector3(0,1,.001):state.form==='cascading'?new THREE.Vector3(.72,.78,.8).normalize():model?.kind==='field'?new THREE.Vector3(.12,.4,1).normalize():new THREE.Vector3(.74,.28,.8).normalize();
  const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),dir).normalize();
  const up=new THREE.Vector3().crossVectors(dir,right).normalize();
  art.updateMatrixWorld();
  const fittingPoints=framingPoints();
  const viewPoints=fittingPoints.map(p=>art.localToWorld(new THREE.Vector3(...p)));
  const box=model?new THREE.Box3().setFromPoints(viewPoints):new THREE.Box3(new THREE.Vector3(-4,-3,-3),new THREE.Vector3(4,3,3));
  const center=spins()&&model?pivot.clone():box.getCenter(new THREE.Vector3()),tan=Math.tan(camera.fov*Math.PI/360);
  const compact=matchMedia('(max-width:620px)').matches,offsetX=0,offsetY=compact?.22:0,marginX=compact?.88:.82,marginTop=compact?.36:.72,marginBottom=.72;
  let d;
  const include=point=>{
    const v=point.clone().sub(center),x=v.dot(right)/(tan*camera.aspect),y=v.dot(up)/tan,z=v.dot(dir);
    // Fit the perspective projection. Desktop centres the form; phones push it below the overlay.
    d=Math.max(d,(x+marginX*z)/(marginX-offsetX),(-x+marginX*z)/(marginX+offsetX),(y+marginTop*z)/(marginTop+offsetY),(-y+marginBottom*z)/(marginBottom-offsetY));
  };
  const fit=()=>{
    d=14;for(const point of viewPoints)include(point);
    if(spins()&&model)for(let step=0;step<24;step++)for(const point of fittingPoints)include(new THREE.Vector3(...point).sub(pivot).applyAxisAngle(new THREE.Vector3(0,1,0),step*Math.PI/12).add(pivot));
  };
  fit();
  // A box centre is not the on-screen centre: perspective and lopsided forms push
  // the silhouette aside. Nudge the target until the projected marks are centred.
  // Spinning forms stay on their pivot so the turn never drifts.
  if(model&&!spins()){
    const shape=viewPoints;
    for(let pass=0;pass<4;pass++){
      let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
      for(const point of shape){
        const v=point.clone().sub(center),depth=Math.max(.1,d-v.dot(dir)),x=v.dot(right)/depth,y=v.dot(up)/depth;
        x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      }
      center.addScaledVector(right,(x0+x1)/2*d).addScaledVector(up,(y0+y1)/2*d);fit();
    }
  }
  controls.maxDistance=Math.max(65,d*1.5);camera.far=Math.max(200,d*4);camera.updateProjectionMatrix();
  controls.target.copy(center).addScaledVector(up,d*tan*offsetY).addScaledVector(right,-d*tan*camera.aspect*offsetX);
  camera.position.copy(controls.target).addScaledVector(dir,d);
  controls.update();if(view!=='current')$$('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-pressed',b.dataset.view===view);});dirty=true;
}
function framingPoints(){
  if(!model)return [];
  if(state.workspace!=='motion'||state.sequence==='orbit')return compositionBounds;
  const origin=model.kind==='field'?model.source:model.kind==='cascading'?[0,-.23,0]:model.points[0].pos;
  const grown=state.drift?1+state.driftAmount/100:1;
  const points=compositionBounds.map(p=>p.map((v,i)=>origin[i]+(v-origin[i])*grown));
  if(sproutArtwork){
    // Bound actual branch-chain lengths; every tip stays within this distance of an anchor.
    const lengths=[];let reach=0;
    for(const branch of sproutArtwork.plan.sprouts){const n=branch.length+(branch.parent>=0?lengths[branch.parent]:0);lengths.push(n);reach=Math.max(reach,n);}
    const box=new THREE.Box3().setFromPoints(points.map(p=>new THREE.Vector3(...p))).expandByScalar(reach);
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push([x,y,z]);
  }
  return points;
}
// Spins turn about the growth origin (the seed dot, or a field's source) or the
// form's bounding-box centre. The orbit loop always turns about the centre.
function spinOrigin(){
  if(!model||state.workspace!=='motion'||!state.rotMove||state.rotPivot!=='origin'||state.sequence==='orbit')return null;
  return model.kind==='field'?model.source:model.kind==='cascading'?null:model.points[0].pos;
}
function updatePivot(){
  const origin=spinOrigin();
  if(origin)pivot.fromArray(origin);
  else pivot.copy(new THREE.Box3().setFromPoints(model.points.map(p=>new THREE.Vector3(...p.pos))).getCenter(new THREE.Vector3()));
}
// Ambient growth for the SVG mirror of the generative shader.
function drifted(pos,variation,frame){
  const k=driftScale(variation,frame);if(k===1)return pos;
  const o=model.points[0].pos;return pos.map((v,i)=>o[i]+(v-o[i])*k);
}
// Sprouts bud from marks of the current form. Each form exposes its marks as
// anchors: where they rest, whether they show at a frame, and where they are now.
function sproutAnchors(){
  const timed=cascadingArtwork?{...state,motion:'pulse'}:state;
  if(model.kind==='field'){
    // Every trace adds four marks then a moving tip; anchors are the marks.
    const index=[0],markAlpha=[.95],rest=[model.source],pose=createFieldPose(model);
    model.traces.forEach((tr,t)=>tr.marks.forEach((mark,j)=>{index.push(1+t*5+j);markAlpha.push(Math.max(.05,mark.alpha));rest.push(mark.pos);}));
    return{count:index.length,origin:model.source,rest:i=>rest[i],timed,
      slice:frame=>{updateFieldPose(model,state,frame,pose);return i=>pose.dotAlpha[index[i]]/markAlpha[i];},
      live:()=>{const pose=fieldArtwork.snapshot();return i=>({pos:pose.dotPositions.subarray(index[i]*3,index[i]*3+3),alpha:pose.dotAlpha[index[i]]/markAlpha[i]});}};
  }
  if(model.kind==='cascading'){
    const index=model.dotIndices.slice(),smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
    return{count:index.length,origin:[0,-.23,0],rest:i=>model.points[index[i]].pos,timed,
      slice:frame=>()=>frame.growth>.05?1:0,
      live:frame=>{const positions=cascadingArtwork.snapshot().positions,alpha=smooth(frame.growth/.05);return i=>({pos:positions.subarray(index[i]*3,index[i]*3+3),alpha});}};
  }
  // Generative forms: a deterministic subset keeps planning quick at high counts.
  const total=model.points.length-1,step=Math.max(1,total/3000),index=[0];
  for(let k=1;k<=total;k+=step)index.push(Math.floor(k));
  return{count:index.length,origin:model.points[0].pos,rest:i=>model.points[index[i]].pos,timed,
    slice:frame=>i=>{const p=model.points[index[i]];return pointTiming(p.g,p.variation,frame).alpha;},
    live:frame=>i=>{const n=index[i],p=model.points[n];return{pos:drifted(movingPosition(p.pos,origins[n],p.g,p.variation,frame),p.variation,frame),alpha:pointTiming(p.g,p.variation,frame).alpha};}};
}
function sproutLook(){
  // Strands use the form's own opacity rule and Filament fade; tip dots sit a touch
  // under the form's dots. Fields: per-trace alpha. Cascading: its mesh opacity.
  const fade=(s,t)=>filamentFade(t,s.variation,state);
  if(model.kind==='field')return{dotRadius:.75,lineAlpha:(s,t)=>Math.min(1,s.alpha*.6*state.lineOpacity/35)*fade(s,t)};
  const base=model.kind==='cascading'?Math.min(1,state.lineOpacity/100*1.2):state.lineOpacity/100;
  return{dotRadius:1.15,lineAlpha:(s,t)=>base*fade(s,t)};
}
function refreshSprouts(){
  const SPROUT_KEYS=['sprouts','sproutCount','sproutLength','sproutBranch','sproutStart','sproutEnd','sproutCurve','sproutBezier','sequence','duration','buildStart','buildEnd','deconStart','deconEnd','deconstruct','loop','buildCurve','buildBezier','deconCurve','deconBezier','motion','stagger','burst','extMove','extFrom','extStart','extEnd','extCurve','extBezier','seed'];
  const key=state.workspace==='motion'&&sproutsActive(state)?modelRevision+JSON.stringify(SPROUT_KEYS.map(k=>state[k])):'';
  if(key===sproutKey)return;sproutKey=key;
  if(sproutArtwork){art.remove(sproutArtwork.group);disposeGroup(sproutArtwork.group);sproutArtwork=null;}
  if(!key||!model)return;
  const previousMix=spreadMorph?.mix??1;applySpread(1);
  const anchors=sproutAnchors(),plan=planSprouts(state,anchors,p=>timelineAt(p,anchors.timed),focusBounds.radius);
  applySpread(previousMix);
  if(!plan||!plan.sprouts.length)return;
  sproutArtwork=createFieldArtwork(THREE,plan,state,palettes[state.palette],renderer.getPixelRatio(),dofUniforms,{name:'sprouts',lineWidth:FIELD_LINE_WIDTH,deviceLines:model.kind!=='field',
    updatePose:(plan,settings,frame,pose)=>updateSproutPose(plan,frame,anchors.live(frame),pose,sproutLook())});
  sproutArtwork.plan=plan;art.add(sproutArtwork.group);
}
function disposeGroup(group){const geometries=new Set(),materials=new Set(),textures=new Set();group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of (Array.isArray(o.material)?o.material:o.material?[o.material]:[])){materials.add(m);if(m.map)textures.add(m.map);}});geometries.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());group.clear();}
function makeMaterial(points){
  const p=palettes[state.palette];
  return new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{uColor:{value:new THREE.Color(p.primary)},uAccent:{value:new THREE.Color(p.secondary)},uClock:{value:0},uExact:{value:0},uBurst:{value:0},uGrowth:{value:1},uExtBase:{value:99},uExtClock:{value:0},uDrift:{value:0},uDriftStagger:{value:0},uProgress:{value:0},uDriftOrigin:{value:new THREE.Vector3()},uPulse:{value:0},uEnergy:{value:state.energy/100},uStagger:{value:state.stagger/100},uMode:{value:0},uSize:{value:state.dotSize},uPixelRatio:{value:renderer.getPixelRatio()},uOpacity:{value:points?1:state.lineOpacity/100},uFinish:{value:filamentFinishMode(state.filamentFinish)},uFadeStrength:{value:state.fadeStrength/100},...dofUniforms},
    vertexShader:`${dofGLSL}
      ${points?'varying float vBlur;':''}
      attribute vec3 aOrigin; attribute float aGeneration; attribute float aVariation; attribute float aTone;
      ${points?'':'attribute float aFraction; attribute float aTraceGeneration; attribute float aTraceVariation; varying float vFraction; varying float vTraceVariation;'}
      varying float vAlpha; varying float vTone;
      uniform float uClock; uniform float uExact; uniform float uBurst; uniform float uGrowth; uniform float uExtBase; uniform float uExtClock; uniform float uDrift; uniform float uDriftStagger; uniform float uProgress; uniform vec3 uDriftOrigin; uniform float uPulse; uniform float uEnergy; uniform float uStagger; uniform float uMode; uniform float uSize; uniform float uPixelRatio;
      void main(){
        // Generations past uExtBase keep growing on their own clock, staggered as originally.
        float later=aGeneration>uExtBase?1.0:0.0,clock=mix(uClock,uExtClock,later),burst=uBurst*(1.0-later);
        float birth=aGeneration-1.0+aVariation*uStagger*.65;
        float age=aGeneration==0.0||burst==1.0?1.0:clamp((clock-birth)/1.2,0.0,1.0);
        float base=uExact*(1.0-later)==1.0?age:uMode==1.0?smoothstep(0.0,1.0,age):1.0-pow(1.0-age,3.0);
        float pop=sin(3.14159265*age)*pow(1.0-age,2.0);
        float amount=burst==1.0?uGrowth:base+pop*uEnergy*.7;
        vec3 displaced=mix(aOrigin,position,amount);
        float driftT=clamp((uProgress-aVariation*uDriftStagger)/max(1.0-uDriftStagger,.05),0.0,1.0);
        displaced=uDriftOrigin+(displaced-uDriftOrigin)*(1.0+uDrift*driftT*driftT*(3.0-2.0*driftT));
        float generation=${points?'aGeneration':'aTraceGeneration'};
        float variation=${points?'aVariation':'aTraceVariation'};
        float fraction=${points?'1.0':'aFraction'};
        float traveling=.5+.5*cos(fraction*6.2831853-uPulse+generation*.7+variation*3.0);
        float traceLater=generation>uExtBase?1.0:0.0,traceClock=mix(uClock,uExtClock,traceLater);
        float front=exp(-pow(traceClock-generation-.2,2.0)*3.0);
        float pulse=uEnergy*(pow(traveling,12.0)*.65+front*.7)*(uMode==2.0?1.5:1.0);
        vAlpha=uBurst*(1.0-traceLater)==1.0?1.0:${points?'smoothstep(0.0,.16,age)':'smoothstep(0.0,.14,traceClock-(generation-1.0+variation*uStagger*.65)-fraction*.72)'};
        vAlpha*=1.0+pulse*.5;
        vTone=clamp(aTone+pulse*.28,0.0,1.0);
        ${points?'':'vFraction=aFraction; vTraceVariation=aTraceVariation;'}
        vec4 mv=modelViewMatrix*vec4(displaced,1.0); gl_Position=projectionMatrix*mv;
        gl_PointSize=clamp(uSize*(18.0/max(2.0,-mv.z)),1.0,30.0)*uPixelRatio*(1.0+pop*.6*uEnergy+pulse*.16);
        ${points?`float baseSize=gl_PointSize;gl_PointSize+=dofCoc(-mv.z)*uPixelRatio;vBlur=1.0-baseSize/gl_PointSize;vAlpha*=${dotFadeGLSL};`:'vAlpha*=1.0/(1.0+dofCoc(-mv.z)*.35);'}
      }`,
    fragmentShader:`${points?dotShapeGLSL:filamentGLSL+'\nuniform float uFinish; uniform float uFadeStrength; varying float vFraction; varying float vTraceVariation;'} uniform vec3 uColor; uniform vec3 uAccent; uniform float uOpacity; varying float vAlpha; varying float vTone; ${points?'varying float vBlur;':''} void main(){ ${points?'float d=dotDistance(gl_PointCoord); if(d>.5)discard; float edge=1.0-smoothstep(.34*(1.0-vBlur),.5,d);':'float edge=filamentFade(vFraction,vTraceVariation,uFinish,uFadeStrength);'} if(vAlpha<.001)discard; gl_FragColor=vec4(mix(uColor,uAccent,vTone),min(1.0,uOpacity*vAlpha*edge));
#include <tonemapping_fragment>
#include <colorspace_fragment>
 }`});
}
// Dots and connections for the generative systems, from one model.
function generativeBuffers(m){
  const parents=m.points.map(p=>p.pos),parentSet=new Set(),paths=[];
  for(const e of m.edges){const a=m.points[e.a],b=m.points[e.b],child=a.g>b.g?e.a:e.b,parent=child===e.a?e.b:e.a;if(a.g!==b.g&&!parentSet.has(child)){parents[child]=m.points[parent].pos;parentSet.add(child);}}
  // Burst grows marks straight out of the seed; generations left to keep
  // growing afterwards still sprout from their parents.
  const base=extensionBase(state)??Infinity,seeded=g=>state.burst&&g<=base;
  const origins=m.points.map((p,i)=>seeded(p.g)?m.points[0].pos:parents[i]);
  const pos=[],gens=[],tones=[],variations=[],pointOrigins=[];
  for(const [i,p] of m.points.entries()){pos.push(...p.pos);gens.push(p.g);tones.push(p.variation>.91?.8:0);variations.push(p.variation);pointOrigins.push(...origins[i]);}
  const lp=[],lg=[],lt=[],lo=[],lv=[],lf=[],ltg=[],ltv=[];
  for(const raw of m.edges){
    const edge=m.points[raw.a].g>m.points[raw.b].g?{...raw,a:raw.b,b:raw.a}:raw;
    const steps=state.form==='multiply'?4:state.form==='network'?6:12;
    const samples=edgeSamples(m,edge,state.form,steps,state.curvature);
    const ends=seeded(edge.g)?[m.points[0].pos,m.points[0].pos]:[parents[edge.a],parents[edge.b]];paths.push({edge,samples,ends});
    const a=m.points[edge.a],b=m.points[edge.b];
    for(let j=1;j<samples.length;j++)for(const k of [j-1,j]){const t=k/steps;lp.push(...samples[k]);lg.push(a.g+(b.g-a.g)*t);lv.push(a.variation+(b.variation-a.variation)*t);lo.push(...ends[0].map((v,i)=>v+(ends[1][i]-v)*t));lt.push(0);lf.push(t);ltg.push(edge.g);ltv.push(b.variation);}
  }
  return{origins,paths,dots:{position:pos,aOrigin:pointOrigins,aGeneration:gens,aVariation:variations,aTone:tones},
    lines:{position:lp,aOrigin:lo,aGeneration:lg,aVariation:lv,aTone:lt,aFraction:lf,aTraceGeneration:ltg,aTraceVariation:ltv}};
}
// Every position is affine in spread, so a model built at the start spread and
// the live model interpolate exactly. Pair each position vector with its twin;
// applySpread blends them in place, and every renderer and export follows.
function collectMorph(live,from,morph={vectors:[],attributes:[],mix:1},seen=new Set()){
  if(!live||typeof live!=='object'||seen.has(live))return morph;seen.add(live);
  if(Array.isArray(live)&&typeof live[0]==='number'){
    if(from?.length===live.length&&live.some((v,i)=>v!==from[i]))morph.vectors.push({live,a:Float64Array.from(from),b:Float64Array.from(live)});
    return morph;
  }
  for(const key of Object.keys(live))collectMorph(live[key],from?.[key],morph,seen);
  return morph;
}
function applySpread(mix){
  if(!spreadMorph||spreadMorph.mix===mix)return;spreadMorph.mix=mix;
  for(const {live,a,b} of spreadMorph.vectors)for(let i=0;i<live.length;i++)live[i]=a[i]+(b[i]-a[i])*mix;
  for(const {attr,a,b} of spreadMorph.attributes){const out=attr.array;for(let i=0;i<out.length;i++)out[i]=a[i]+(b[i]-a[i])*mix;attr.needsUpdate=true;}
}
function rebuild(){
  clearTimeout(rebuildTimer);rebuildTimer=0;disposeGroup(art);cascadingArtwork=null;fieldArtwork=null;sproutArtwork=null;sproutKey='';modelRevision++;dotMaterial=null;lineMaterial=null;model=buildModel(state);paths=[];spreadMorph=null;
  const morphing=state.spreadMove&&state.sequence!=='orbit'&&model.kind!=='cascading'&&state.spreadFrom!==state.spread,spreadModel=morphing?buildModel({...state,spread:state.spreadFrom}):null;
  compositionBounds=(model.framingPoints||model.points.map(p=>p.pos)).map(p=>[...p]);
  if(spreadModel)compositionBounds.push(...(spreadModel.framingPoints||spreadModel.points.map(p=>p.pos)).map(p=>[...p]));
  new THREE.Box3().setFromPoints((model.framingPoints&&model.kind!=='cascading'?model.framingPoints:model.points.map(p=>p.pos)).map(p=>new THREE.Vector3(...p))).getBoundingSphere(focusBounds);
  if(model.kind==='field'){
    updatePivot();
    if(morphing)spreadMorph=collectMorph(model,spreadModel);
    fieldArtwork=createFieldArtwork(THREE,model,state,palettes[state.palette],renderer.getPixelRatio(),dofUniforms);art.add(fieldArtwork.group);
    origins=[];updatePalette();updateProgress();dirty=true;return;
  }
  if(model.kind==='cascading'){
    updatePivot();
    cascadingArtwork=createCascadingArtwork(THREE,model,state,palettes[state.palette],renderer.getPixelRatio(),dofUniforms);art.add(cascadingArtwork.group);
    origins=[];updatePalette();updateProgress();dirty=true;return;
  }
  const built=generativeBuffers(model);origins=built.origins;paths=built.paths;
  updatePivot();
  const geometry=new THREE.BufferGeometry();
  for(const [key,values] of Object.entries(built.dots))geometry.setAttribute(key,new THREE.Float32BufferAttribute(values,key==='position'||key==='aOrigin'?3:1));
  dotMaterial=makeMaterial(true);const dots=new THREE.Points(geometry,dotMaterial);dots.name='dots';dots.frustumCulled=false;dots.visible=state.style!=='filaments';art.add(dots);
  const linesGeometry=new THREE.BufferGeometry();
  for(const [key,values] of Object.entries(built.lines))linesGeometry.setAttribute(key,new THREE.Float32BufferAttribute(values,key==='position'||key==='aOrigin'?3:1));
  lineMaterial=makeMaterial(false);const lines=new THREE.LineSegments(linesGeometry,lineMaterial);lines.name='lines';lines.frustumCulled=false;lines.visible=state.style!=='dots';art.add(lines);
  if(morphing){
    const from=generativeBuffers(spreadModel);
    spreadMorph=collectMorph({model,paths},{model:spreadModel,paths:from.paths});
    for(const [geo,key,values] of [[geometry,'position',from.dots.position],[geometry,'aOrigin',from.dots.aOrigin],[linesGeometry,'position',from.lines.position],[linesGeometry,'aOrigin',from.lines.aOrigin]]){
      const attr=geo.getAttribute(key);spreadMorph.attributes.push({attr,a:Float32Array.from(values),b:attr.array.slice()});
    }
  }
  updatePalette();updateProgress();dirty=true;
}
function updatePalette(){
  const p=palettes[state.palette],root=document.documentElement;
  root.style.setProperty('--stage-bg',p.bg);root.style.setProperty('--stage-text',p.text);root.style.setProperty('--stage-muted',p.muted);root.style.setProperty('--stage-line',p.text+'26');renderer.setClearColor(p.bg,1);
  for(const m of [dotMaterial,lineMaterial])if(m){m.uniforms.uColor.value.set(p.primary);m.uniforms.uAccent.value.set(p.secondary);}
  if(cascadingArtwork)cascadingArtwork.setPalette(p);
  if(fieldArtwork)fieldArtwork.setPalette(p);
  sproutArtwork?.setPalette(p);
  $('palette-name').textContent=p.name;$('palette-hex').textContent=p.primary;
  $$('[data-palette]').forEach(b=>{const active=+b.dataset.palette===state.palette;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});dirty=true;
}
function updateReadouts(){
  updateModelReadouts();timingUI?.update(motionFrame||timelineAt(state.progress,state));
  $('motion-phase').textContent=$('motion-phase').textContent.replace('Deconstruct','Return').replace('Cleared','Seed');
  if(state.sequence==='orbit'){
    $('motion-phase').textContent='Orbit loop';$('progress-label').textContent=`${(state.progress*state.duration).toFixed(1)} / ${state.duration} S · FULLY GROWN`;
    $('growth-readout').textContent=Math.round(state.progress*360)+'°';$('growth-readout').title='Turntable rotation';
  }
}
function updateModelReadouts(){
  const frame=motionFrame||timelineAt(state.progress,state),ext=frame.ext,g=ext?frame.growth*ext.base+ext.amount*(state.generations-ext.base):frame.growth*state.generations;
  if(fieldArtwork){
    const pose=fieldArtwork.snapshot();
    $('node-count').textContent=(state.style==='filaments'?0:pose.activeMarks).toLocaleString();$('edge-count').textContent=(state.style==='dots'?0:pose.activeTraces).toLocaleString();$('seed-readout').textContent=String(state.seed).padStart(4,'0');
    $('progress-label').textContent=`${(state.progress*state.duration).toFixed(1)} / ${state.duration} S · ${Math.round(frame.growth*100)}%`;
    $('motion-phase').textContent=playing?frame.phase:'Paused · '+frame.phase;
    $('growth-readout').textContent=Math.round(frame.growth*100)+'%';$('growth-readout').title='Growth sequence completion';
    $('model-note').textContent=`${model.traces.length.toLocaleString()} trajectories from a shared origin. Procedural geometry in arbitrary units.`;
    $('progress').value=Math.round(state.progress*1000);rangeFill($('progress'));return;
  }
  if(cascadingArtwork){
    const ratio=cascadingArtwork.snapshot().rimRatio;
    $('node-count').textContent=model.dotIndices.length.toLocaleString();$('edge-count').textContent=(state.style==='dots'?0:model.edges.length).toLocaleString();
    $('progress-label').textContent=`${(state.progress*state.duration).toFixed(1)} / ${state.duration} S · ${Math.round(frame.growth*100)}%`;
    $('motion-phase').textContent=['Deconstruct','Cleared'].includes(frame.phase)?frame.phase:frame.growth<.1?'Seed':frame.growth<.45?'Expand':frame.growth<.95?'Cascading folds':'Settle';
    $('growth-readout').textContent=ratio.toFixed(2)+'×';$('growth-readout').title='Rim length relative to its flat reference circle';
    $('model-note').textContent=`Parametric surface · ${state.folds} primary folds · rim ${ratio.toFixed(2)}× its flat reference circle. Chart coordinates use arbitrary units.`;
    $('progress').value=Math.round(state.progress*1000);rangeFill($('progress'));return;
  }
  const active=model.points.filter(p=>pointTiming(p.g,p.variation,frame).alpha>.05).length;
  const edges=paths.filter(({edge:e})=>traceAlpha(e.g,model.points[e.b].variation,.5,frame)>.05).length;
  $('node-count').textContent=active.toLocaleString();$('edge-count').textContent=(state.style==='dots'?0:edges).toLocaleString();$('seed-readout').textContent=String(state.seed).padStart(4,'0');
  $('progress-label').textContent=`${(state.progress*state.duration).toFixed(1)} / ${state.duration} S · GEN ${Math.min(state.generations,g).toFixed(1)}`;
  $('motion-phase').textContent=playing?frame.phase:'Paused · '+frame.phase;
  $('growth-readout').textContent=`${Math.round(state.rate**g).toLocaleString()}×`;
  $('growth-readout').title='Synthetic generation multiplier';
  $('model-note').textContent=`Synthetic growth · 1 → ${model.finalCount.toLocaleString()} in ${state.generations} generations.${model.sampled?' Dots sampled at high counts.':''}`;
  $('progress').value=Math.round(state.progress*1000);rangeFill($('progress'));
}
function applyFrame(progress){
  motionFrame=frameForWorkspace(progress,cascadingArtwork?{...state,motion:'pulse'}:state);
  applySpread(motionFrame.spreadMix);
  if(fieldArtwork)fieldArtwork.update(motionFrame);
  else if(cascadingArtwork)cascadingArtwork.update(motionFrame.growth,!!motionFrame.exact,!!motionFrame.burst,motionFrame.drift);
  else for(const m of [dotMaterial,lineMaterial]){const u=m.uniforms;u.uClock.value=motionFrame.clock;u.uExact.value=motionFrame.exact;u.uBurst.value=motionFrame.burst;u.uGrowth.value=motionFrame.growth;u.uExtBase.value=motionFrame.ext?motionFrame.ext.base:99;const drift=motionFrame.drift;u.uDrift.value=drift?drift.amount:0;u.uDriftStagger.value=drift?drift.stagger:0;u.uProgress.value=motionFrame.progress;u.uDriftOrigin.value.fromArray(model.points[0].pos);u.uExtClock.value=motionFrame.ext?motionFrame.ext.frame.clock:0;u.uPulse.value=motionFrame.pulse;u.uEnergy.value=motionFrame.energy;u.uStagger.value=motionFrame.stagger;u.uMode.value=motionFrame.mode;}
  refreshSprouts();sproutArtwork?.update(motionFrame);
  updatePivot();
  cameraZoom=motionFrame.zoom;art.rotation.y=motionFrame.turn;art.position.copy(pivot).sub(pivot.clone().applyAxisAngle(new THREE.Vector3(0,1,0),motionFrame.turn));art.updateMatrixWorld();dirty=true;
}
// The camera move dollies toward a focus point for each render, then restores
// the orbit camera, so viewport controls keep owning the framing. Scaling the
// camera position about the focus keeps that point fixed on screen.
function withCameraMove(draw){
  if(cameraZoom===1){updateDepthOfField();return draw();}
  const saved=camera.position.clone();
  const focus=state.zoomFocus==='origin'&&model?.points?.length?art.localToWorld(new THREE.Vector3(...model.points[0].pos)):(cameraFocus||controls.target).clone();
  camera.position.sub(focus).divideScalar(cameraZoom).add(focus);camera.updateMatrixWorld();updateDepthOfField();
  try{return draw();}finally{camera.position.copy(saved);camera.updateMatrixWorld();}
}
// Focus 0–100 sweeps the plane from the nearest to the farthest part of the
// form, measured from the current camera, so it holds through zooms and orbits.
function updateDepthOfField(){
  const blur=motionFrame?.dofBlur??state.dofBlur;
  dofUniforms.uDofOn.value=(state.dof||(state.workspace==='motion'&&state.sequence!=='orbit'&&state.dofMove))&&blur>0?1:0;if(!dofUniforms.uDofOn.value)return;
  const center=art.localToWorld(focusBounds.center.clone()),dir=camera.getWorldDirection(new THREE.Vector3());
  const depth=center.sub(camera.position).dot(dir),radius=focusBounds.radius*.8;
  dofUniforms.uFocus.value=Math.max(.2,depth+radius*(state.dofFocus/50-1));
  dofUniforms.uAperture.value=blur*.45;
}
function renderScene(){withCameraMove(()=>renderer.render(scene,camera));}
function updateProgress(){applyFrame(state.progress);updateReadouts();}
function rangeFill(el){el.style.setProperty('--fill',`${(el.value-el.min)/(el.max-el.min)*100}%`);}
function syncUI(){
  for(const key of ['rate','generations','spread','depth','twist','curvature','folds','foldAmplitude','density','dotSize','lineOpacity','fadeStrength','dofFocus','dofBlur','duration','energy','stagger']){const el=$(key);el.value=state[key];rangeFill(el);$(`${key}-value`).textContent=key==='rate'?state[key].toFixed(1)+'×':key==='foldAmplitude'?state[key].toFixed(2):key==='twist'?state[key]+'°':key==='curvature'?(state[key]===0?'Straight':state[key]+'%'):['lineOpacity','fadeStrength','energy','stagger','density','dofBlur'].includes(key)?state[key]+'%':key==='dofFocus'?(state[key]<=2?'Nearest':state[key]>=98?'Farthest':state[key]===50?'Center':state[key]):key==='duration'?state[key]+' s':key==='dotSize'?state[key].toFixed(1):state[key];}
  for(const key of ['loop','turntable','dof','burst','drift'])$(key).checked=state[key];
  for(const key of ['driftAmount','driftStagger']){const el=$(key);el.value=state[key];rangeFill(el);$(key+'-value').textContent=(key==='driftAmount'?'+':'')+state[key]+'%';}
  for(const key of ['sproutCount','sproutLength','sproutBranch']){const el=$(key);el.value=state[key];rangeFill(el);$(key+'-value').textContent=state[key]+(key==='sproutCount'?'':'%');}$('dof-options').hidden=!state.dof&&!(state.workspace==='motion'&&state.dofMove);
  $('dof-blur-control').hidden=state.workspace==='motion'&&state.dofMove;$('dof-move-note').hidden=state.workspace!=='motion'||!state.dofMove;$('dof-match-rotation').hidden=!state.rotMove;$('rot-pivot-control').hidden=state.form==='cascading';$$('[data-rot-pivot]').forEach(b=>{const active=b.dataset.rotPivot===state.rotPivot;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});$('ext-after-rotation').hidden=!state.rotMove;$('stagger').disabled=state.burst;
  $$('[data-form]').forEach(b=>{const active=b.dataset.form===state.form;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});
  $$('[data-style]').forEach(b=>{const active=b.dataset.style===state.style;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});
  $$('[data-motion]').forEach(b=>{const active=b.dataset.motion===state.motion;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});
  $$('[data-finish]').forEach(b=>{const active=b.dataset.finish===state.filamentFinish;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});
  $('filament-controls').hidden=state.style==='dots';$('fade-strength-control').hidden=state.filamentFinish==='off';$('finish-description').textContent=finishLabels[state.filamentFinish];
  $('motion-description').textContent=motionLabels[state.motion];
  const surface=state.form==='cascading',field=isField(state.form);$('surface-controls').hidden=!surface;
  $('population-controls').hidden=field;$('curvature-control').hidden=state.form==='multiply';$('field-controls').hidden=!field;
  for(const id of ['generative-controls','motion-style-controls','motion-description','motion-detail-controls','generative-variation','seed-label'])$(id).hidden=surface;
  $('node-unit').textContent=surface?'MESH DOTS':'DOTS';$('edge-unit').textContent=surface?'SEGMENTS':field?'TRAJECTORIES':'CONNECTIONS';$('axis-key').hidden=surface||field;
  syncSequenceUI();timingUI?.sync();syncWorkspaceUI();
  const f=forms[state.form];$('study-number').textContent=f.number;$('study-label').textContent=f.label;updatePlayButton();
}
function syncSequenceUI(){
  const orbit=state.sequence==='orbit',surface=state.form==='cascading';
  $('sequence').value=state.sequence;
  $('sequence-description').hidden=!orbit;
  for(const id of ['growth-character','growth-effects'])$(id).hidden=orbit;
  $('loop-note').hidden=orbit||!state.loop;
  for(const id of ['motion-style-controls','motion-description','motion-detail-controls'])$(id).hidden=orbit||surface;
  for(const id of ['growth-loop-control','growth-turntable-control','timing-controls','rotation-controls','dof-move-controls','burst-control','drift-control','sprout-controls'])$(id).hidden=orbit;
  $('drift-options').hidden=orbit||!state.drift;
  $('burst-note').hidden=orbit||!state.burst;
  $('spread-controls').hidden=orbit||state.form==='cascading';
  $('ext-controls').hidden=orbit||!['ascent','multiply','network'].includes(state.form);
  $('duration-label').textContent=orbit?'Revolution duration':'Duration';
  $('preview-motion').innerHTML=orbit?'Play orbit loop':'Play from start';
  $('progress-accessible-label').textContent=orbit?'Orbit progress':'Growth progress';
  $('restart').setAttribute('aria-label',orbit?'Restart orbit loop':'Restart growth animation');
  $('restart').title=orbit?'Restart orbit loop':'Restart growth';$('play').title=orbit?'Play / pause orbit (Space)':'Play / pause growth (Space)';
  $('video-description').textContent=orbit?'A fully grown visualization in a seamless 360° turntable loop. Artwork only.':'The complete growth sequence, with your colors and camera. Artwork only.';
}
function setSequence(sequence){
  state.sequence=sequence;state.progress=sequence==='orbit'?0:restProgress(state);playing=false;
  rebuild();syncUI();updateProgress();persist();
  if($('export-dialog').open)updateVideoOptions();
}
function syncWorkspaceUI(){
  const motion=state.workspace==='motion',context=exportContext(state);
  document.body.dataset.workspace=state.workspace;
  $$('[data-workspace]').forEach(b=>{if(b.tagName!=='BUTTON')return;const on=b.dataset.workspace===state.workspace;b.classList.toggle('active',on);b.setAttribute('aria-pressed',on);});
  document.querySelector('.transport').hidden=!motion;
  document.querySelector('.inspector-tabs').hidden=!motion;
  $('composition-panel').hidden=motion&&inspectorTab==='animation';
  $('motion-panel').hidden=!motion||inspectorTab!=='animation';
  $('composition-panel').setAttribute('role',motion?'tabpanel':'region');
  $('composition-panel').setAttribute('aria-labelledby','composition-tab');
  for(const [id,tab] of [['composition-tab','composition'],['animation-tab','animation']]){const on=inspectorTab===tab;$(id).setAttribute('aria-selected',on);$(id).tabIndex=on?0:-1;}
  $('inspector-title').textContent=motion?'DEVELOP YOUR ANIMATION':'COMPOSE YOUR STILL';
  $('export-action-label').textContent=context.label;
  $('workspace-status').textContent=motion?`MOTION · ${playing?'PLAYING':'PAUSED'} · ${state.sequence==='orbit'?'ORBIT LOOP':'GROWTH'}`:'STILL · FULLY GROWN';
  const effects=$$('[data-effect-status]');let count=0;
  effects.forEach(el=>{const on=state[el.dataset.effectStatus];el.textContent=on?'On':'Off';el.classList.toggle('enabled',on);if(on&&!el.closest('.effect-card').hidden)count++;});
  $('effects-count').textContent=count+' on';
  $('turntable').disabled=state.rotMove;
}
function setWorkspace(workspace){
  if(state.workspace===workspace)return;
  playing=false;state=switchWorkspace(state,workspace);inspectorTab='animation';
  rebuild();syncUI();resize();persist();
}
function setExportTab(tab){
  for(const name of ['video','still','print'])$(name+'-options').hidden=tab!==name;
  $$('[data-export-tab]').forEach(b=>{const on=b.dataset.exportTab===tab;b.classList.toggle('active',on);b.setAttribute('aria-pressed',on);});
  if(tab==='video')updateVideoOptions();if(tab==='print')updatePrintOptions();
}
function openExport(){
  if(rebuildTimer)rebuild();playing=false;updatePlayButton();
  const context=exportContext(state),motion=state.workspace==='motion';
  $('export-title').textContent=motion?'Export your animation.':'Export your still.';
  $$('[data-export-tab]').find(b=>b.dataset.exportTab==='video').hidden=!motion;
  $$('[data-export-tab]').find(b=>b.dataset.exportTab==='still').textContent=context.imageLabel+' / PNG + SVG';
  $('image-export-description').textContent=context.description;
  $('export-dialog').showModal();setExportTab(context.tab);
}
function scheduleRebuild(){clearTimeout(rebuildTimer);rebuildTimer=setTimeout(()=>{rebuild();persist();},70);}
function initUI(){
  timingUI=createTimingUI({getState:()=>state,onChange:()=>{syncUI();updateProgress();},onCommit:persist});
  $$('button[data-workspace]').forEach(b=>b.onclick=()=>setWorkspace(b.dataset.workspace));
  for(const [id,tab] of [['composition-tab','composition'],['animation-tab','animation']]){
    $(id).onclick=()=>{inspectorTab=tab;syncWorkspaceUI();};
    $(id).onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?'composition-tab':e.key==='End'?'animation-tab':id==='composition-tab'?'animation-tab':'composition-tab';$(next).click();$(next).focus();};
  }
  $('spreadMove').addEventListener('change',()=>rebuild());
  // Animating the blur needs depth of field on; start it alongside the rotation when there is one.
  const matchRotation=()=>{state.dofStart=state.rotStart;state.dofEnd=state.rotEnd;};
  $('dofMove').addEventListener('change',()=>{if(state.dofMove&&state.rotMove)matchRotation();syncUI();updateProgress();persist();});
  $('dof-match-rotation').onclick=()=>{matchRotation();syncUI();updateProgress();persist();};
  // Keep growing: place the second growth after the rotation, or after the build.
  const placeExtension=()=>{const d=state.duration,start=Math.min(d,state.rotMove?state.rotEnd:state.buildEnd),end=Math.max(start,Math.min(d,start+(d-start)*.9));state.extStart=Math.round(start*100)/100;state.extEnd=Math.round(end*100)/100;if(state.extFrom>=state.generations)state.extFrom=Math.max(1,state.generations-1);};
  $('extMove').addEventListener('change',()=>{if(state.extMove)placeExtension();syncUI();rebuild();persist();});
  $('ext-after-rotation').onclick=()=>{placeExtension();syncUI();updateProgress();persist();};
  for(const [id,key] of [['extFrom','extFrom'],['extTo','generations']])$(id).addEventListener('input',()=>{state[key]=+$(id).value;if(key==='generations'&&state.extFrom>=state.generations)state.extFrom=state.generations-1;if(key==='extFrom'&&state.extFrom>=state.generations)state.generations=Math.min(10,state.extFrom+1);syncUI();scheduleRebuild();});
  $$('[data-rot-pivot]').forEach(b=>b.onclick=()=>{state.rotPivot=b.dataset.rotPivot;updatePivot();syncUI();updateProgress();resetView('current');persist();});
  // Planning is cheap but not free; sliders re-plan once per input event.
  for(const key of ['sproutCount','sproutLength','sproutBranch']){$(key).addEventListener('input',()=>{state[key]=+$(key).value;syncUI();updateProgress();});$(key).addEventListener('change',()=>{if(key==='sproutLength')resetView('current');persist();});}
  $('drift').onchange=()=>{state.drift=$('drift').checked;syncUI();updateProgress();resetView('current');persist();};
  for(const key of ['driftAmount','driftStagger']){$(key).addEventListener('input',()=>{state[key]=+$(key).value;syncUI();updateProgress();});$(key).addEventListener('change',()=>{if(key==='driftAmount')resetView('current');persist();});}
  $('burst').onchange=()=>{state.burst=$('burst').checked;syncUI();rebuild();persist();};
  for(const [id,key] of [['spreadFrom','spreadFrom'],['spreadTo','spread']]){$(id).addEventListener('input',()=>{state[key]=+$(id).value;syncUI();scheduleRebuild();});}
  $('sequence').onchange=()=>setSequence($('sequence').value);
  palettes.forEach((p,i)=>{const b=document.createElement('button');b.className='palette-swatch';b.dataset.palette=i;b.style.background=p.bg;b.title=p.name;b.setAttribute('aria-label',p.name);b.innerHTML=`<svg viewBox="0 0 28 26" aria-hidden="true"><g fill="${p.primary}"><circle cx="7" cy="7" r="3"/><circle cx="21" cy="7" r="3"/><circle cx="7" cy="21" r="3"/><circle cx="21" cy="21" r="3"/></g></svg>`;b.onclick=()=>{state.palette=i;updatePalette();persist();};$('palettes').append(b);});
  $$('[data-form]').forEach(b=>b.onclick=()=>{state.form=b.dataset.form;playing=false;state.progress=state.sequence==='orbit'?0:restProgress(state);syncUI();rebuild();resetView();persist();});
  $$('[data-style]').forEach(b=>b.onclick=()=>{state.style=b.dataset.style;sproutArtwork?.setStyle(state);if(fieldArtwork)fieldArtwork.setStyle(state);else if(cascadingArtwork)cascadingArtwork.setStyle(state);else{art.getObjectByName('dots').visible=state.style!=='filaments';art.getObjectByName('lines').visible=state.style!=='dots';}syncUI();updateReadouts();dirty=true;persist();});
  for(const key of ['rate','generations','spread','depth','twist','curvature','folds','foldAmplitude','density'])$(key).addEventListener('input',()=>{state[key]=+$(key).value;syncUI();scheduleRebuild();});
  const updateFinish=()=>{sproutArtwork?.setStyle(state);if(fieldArtwork)fieldArtwork.setStyle(state);else if(cascadingArtwork)cascadingArtwork.setStyle(state);else{dotMaterial.uniforms.uSize.value=state.dotSize;lineMaterial.uniforms.uOpacity.value=state.lineOpacity/100;lineMaterial.uniforms.uFinish.value=filamentFinishMode(state.filamentFinish);lineMaterial.uniforms.uFadeStrength.value=state.fadeStrength/100;}syncUI();dirty=true;persist();};
  for(const key of ['dotSize','lineOpacity','fadeStrength'])$(key).addEventListener('input',()=>{state[key]=+$(key).value;updateFinish();});
  $$('[data-finish]').forEach(b=>b.onclick=()=>{state.filamentFinish=b.dataset.finish;updateFinish();});
  $$('[data-motion]').forEach(b=>b.onclick=()=>{state.motion=b.dataset.motion;playing=false;syncUI();updateProgress();persist();});
  for(const key of ['duration','energy','stagger'])$(key).addEventListener('input',()=>{if(key==='duration')retimeDuration(state,+$(key).value);else state[key]=+$(key).value;syncUI();updateProgress();persist();});
  for(const key of ['loop','turntable'])$(key).onchange=()=>{state[key]=$(key).checked;syncUI();updateProgress();if(key==='turntable')resetView();persist();};
  $('preview-motion').onclick=()=>{state.progress=0;playing=true;updatePlayButton();updateProgress();};
  $('dof').onchange=()=>{state.dof=$('dof').checked;syncUI();dirty=true;persist();};
  for(const key of ['dofFocus','dofBlur']){$(key).addEventListener('input',()=>{state[key]=+$(key).value;syncUI();dirty=true;});$(key).addEventListener('change',persist);}
  $('reseed').onclick=()=>{state.seed=state.seed%999999+1;rebuild();persist();toast(`Variation ${String(state.seed).padStart(4,'0')}`);};
  $('reset').onclick=()=>{state=sanitize({workspace:state.workspace});playing=false;syncUI();rebuild();resetView();persist();toast('Field reset. Saved studies are still here.');};
  $$('[data-view]').forEach(b=>b.onclick=()=>{resetView(b.dataset.view);persist();});$('fit').onclick=()=>{resetView();persist();};
  $('play').onclick=togglePlay;$('restart').onclick=()=>{state.progress=0;playing=true;updatePlayButton();updateProgress();};
  $('progress').oninput=()=>{state.progress=+$('progress').value/1000;playing=false;updatePlayButton();updateProgress();};$('progress').onchange=persist;
  $('save').onclick=saveStudy;$('share').onclick=share;
  $('panel-toggle').onclick=()=>{const hidden=document.body.classList.toggle('panel-hidden');$('panel-toggle').setAttribute('aria-expanded',!hidden);};
  $('focus').onclick=toggleFocus;$('exit-focus').onclick=toggleFocus;
  $('export-open').onclick=openExport;$('export-png').onclick=()=>exportPNG();$('export-svg').onclick=()=>exportSVG();
  $('export-video').onclick=exportVideo;$('cancel-export').onclick=()=>exportController?.abort();
  for(const key of ['video-size','video-ratio'])$(key).onchange=updateVideoOptions;
  $$('[data-export-tab]').forEach(b=>b.onclick=()=>setExportTab(b.dataset.exportTab));
  let printUnit='in',printTimer;
  $('print-unit').onchange=()=>{const next=$('print-unit').value,factor=next===printUnit?1:next==='mm'?25.4:1/25.4;for(const key of ['width','height']){const input=$('print-'+key);if(input.value!=='')input.value=Number((Number(input.value)*factor).toFixed(6));}printUnit=next;updatePrintOptions();};
  for(const key of ['width','height','line','dot','opacity','reinforce','transparent'])$('print-'+key).addEventListener('input',()=>{clearTimeout(printTimer);printTimer=setTimeout(updatePrintOptions,350);});
  $('print-color-mode').onchange=updatePrintOptions;
  $('export-print-pdf').onclick=()=>exportPrint('pdf');
  $('export-print-svg').onclick=()=>exportPrint('svg');$('export-print-png').onclick=()=>exportPrint('png');
  $('export-dialog').addEventListener('cancel',e=>{if(exporting){e.preventDefault();exportController?.abort();}});
  $('export-dialog').addEventListener('submit',e=>{if(exporting)e.preventDefault();});
  $('export-dialog').addEventListener('click',e=>{if(!exporting&&e.target===$('export-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
  document.addEventListener('keydown',e=>{if($('export-dialog').open||['INPUT','SELECT','TEXTAREA','BUTTON','SUMMARY','A'].includes(e.target.tagName)||e.ctrlKey||e.metaKey||e.altKey)return;const key=e.key.toLowerCase();if(key===' '){e.preventDefault();togglePlay();}else if(key==='f'){resetView();persist();}else if(key==='h'||(key==='escape'&&document.body.classList.contains('focus-mode'))){toggleFocus();}else if(['arrowleft','arrowright','arrowup','arrowdown','+','=','-'].includes(key)){e.preventDefault();const offset=camera.position.clone().sub(controls.target),spherical=new THREE.Spherical().setFromVector3(offset);if(key==='arrowleft')spherical.theta-=.12;if(key==='arrowright')spherical.theta+=.12;if(key==='arrowup')spherical.phi-=.12;if(key==='arrowdown')spherical.phi+=.12;if(key==='+'||key==='=')spherical.radius*=.9;if(key==='-')spherical.radius*=1.1;spherical.radius=clamp(spherical.radius,controls.minDistance,controls.maxDistance);spherical.makeSafe();camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));controls.update();persist();}});
  document.addEventListener('visibilitychange',()=>{lastTime=0;});window.addEventListener('pagehide',persist);syncUI();renderSaved();
}
function toggleFocus(){const on=document.body.classList.toggle('focus-mode');$('exit-focus').hidden=!on;if(on)$('viewport').focus();else $('focus').focus();}
function togglePlay(){if(state.workspace!=='motion')return;playing=!playing;if(playing&&state.progress>=.999)state.progress=0;updatePlayButton();updateProgress();if(!playing)persist();}
function updatePlayButton(){syncWorkspaceUI();$('play').setAttribute('aria-label',playing?(state.sequence==='orbit'?'Pause orbit loop':'Pause growth animation'):(state.sequence==='orbit'?'Play orbit loop':'Play growth animation'));$('play').innerHTML=playing?'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3H8V17H5ZM12 3H15V17H12Z"/></svg>':'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3L17 10L6 17Z"/></svg>';}
function animate(now){
  requestAnimationFrame(animate);if(document.hidden||exporting){lastTime=0;return;}
  const dt=lastTime?Math.min((now-lastTime)/1000,.1):0;lastTime=now;controls.autoRotate=false;controls.update(dt);
  if(playing&&state.workspace==='motion'){state.progress+=dt/state.duration;if(state.progress>=1){if(state.loop||state.sequence==='orbit')state.progress%=1;else{state.progress=1;playing=false;updatePlayButton();persist();}}updateProgress();}
  if(dirty||playing){renderScene();dirty=false;}
}
function persist(){if(!camera)return;try{localStorage.setItem(STORAGE,JSON.stringify({state,view:viewSnapshot(),saved}));}catch{}}
function saveStudy(){if(rebuildTimer)rebuild();const item={id:Date.now(),name:`${forms[state.form].label.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase())} ${String(saved.length+1).padStart(2,'0')}`,state:structuredClone(state),view:viewSnapshot()};saved.unshift(item);saved=saved.slice(0,12);try{localStorage.setItem(STORAGE,JSON.stringify({state,view:viewSnapshot(),saved}));renderSaved();toast('Study saved in this browser.');}catch{saved.shift();toast('Browser storage is unavailable. Use Share to keep this study.');}}
function renderSaved(){const list=$('saved-list');list.replaceChildren();$('saved-count').textContent=saved.length;if(!saved.length){list.innerHTML='<p class="empty-state">Save a composition to return to it here.</p>';return;}saved.forEach(item=>{const row=document.createElement('div');row.className='saved-row';const restore=document.createElement('button'),label=document.createElement('span'),detail=document.createElement('small'),remove=document.createElement('button');label.textContent=String(item.name||'Saved study');const s=sanitize(item.state);detail.textContent=`${palettes[s.palette].name} · ${s.form==='cascading'?s.folds+' folds':isField(s.form)?s.density+'% density':s.rate.toFixed(1)+'×'}`;restore.append(label,detail);restore.onclick=()=>{state=sanitize(item.state);playing=false;syncUI();rebuild();applyView(item.view);persist();toast('Study restored.');};remove.textContent='×';remove.setAttribute('aria-label',`Remove ${item.name||'saved study'}`);remove.onclick=()=>{saved=saved.filter(x=>x.id!==item.id);renderSaved();persist();};row.append(restore,remove);list.append(row);});}
async function share(){if(rebuildTimer)rebuild();const hash='#study='+encodeURIComponent(btoa(JSON.stringify({state,view:viewSnapshot()})));const url=location.origin+location.pathname+hash;try{await navigator.clipboard.writeText(url);history.replaceState(null,'',hash);toast('Study link copied, including your camera view.');}catch{history.replaceState(null,'',hash);toast('Study added to the address bar. Copy the URL to share it.');}}
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.add('visible');toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3600);}
function download(blob,extension){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`nrf-growth-field-${state.form}-${String(state.seed).padStart(4,'0')}.${extension}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function captureView(width,height,transparent=false,fitArtwork=false){
  const snapshot={size:renderer.getSize(new THREE.Vector2()),ratio:renderer.getPixelRatio(),aspect:camera.aspect,fov:camera.fov,controlsEnabled:controls.enabled,position:camera.position.clone(),quaternion:camera.quaternion.clone(),cameraFocus:cameraFocus?.clone()};
  controls.enabled=false;renderer.setPixelRatio(1);renderer.setSize(width,height,false);
  const aspect=width/height;
  if(!fitArtwork&&aspect<snapshot.aspect)camera.fov=2*Math.atan(Math.tan(snapshot.fov*Math.PI/360)*snapshot.aspect/aspect)*180/Math.PI;
  camera.aspect=aspect;camera.updateProjectionMatrix();
  if(fitArtwork){
    const dir=camera.position.clone().sub(controls.target).normalize(),right=new THREE.Vector3().crossVectors(camera.up,dir).normalize(),up=new THREE.Vector3().crossVectors(dir,right).normalize(),tan=Math.tan(camera.fov*Math.PI/360);
    let distance=4;
    const turns=spins()?24:1;
    for(let step=0;step<turns;step++)for(const point of framingPoints()){
      const angle=turns>1?step*Math.PI/12:0,v=new THREE.Vector3(...point).sub(pivot).applyAxisAngle(new THREE.Vector3(0,1,0),angle),z=v.dot(dir);
      distance=Math.max(distance,Math.abs(v.dot(right))/(tan*aspect*.84)+z,Math.abs(v.dot(up))/(tan*.84)+z);
    }
    camera.position.copy(pivot).addScaledVector(dir,distance);camera.lookAt(pivot);camera.updateMatrixWorld();cameraFocus=pivot.clone();
  }
  const projectionScale=height/snapshot.size.y*Math.tan(snapshot.fov*Math.PI/360)/Math.tan(camera.fov*Math.PI/360);
  sproutArtwork?.setPixelRatio(projectionScale);if(fieldArtwork)fieldArtwork.setPixelRatio(projectionScale);else if(cascadingArtwork)cascadingArtwork.setPixelRatio(projectionScale);else dotMaterial.uniforms.uPixelRatio.value=projectionScale;
  renderer.setClearColor(palettes[state.palette].bg,transparent?0:1);
  return()=>{cameraFocus=snapshot.cameraFocus;renderer.setPixelRatio(snapshot.ratio);camera.aspect=snapshot.aspect;camera.fov=snapshot.fov;camera.position.copy(snapshot.position);camera.quaternion.copy(snapshot.quaternion);camera.updateProjectionMatrix();sproutArtwork?.setPixelRatio(snapshot.ratio);if(fieldArtwork)fieldArtwork.setPixelRatio(snapshot.ratio);else if(cascadingArtwork)cascadingArtwork.setPixelRatio(snapshot.ratio);else dotMaterial.uniforms.uPixelRatio.value=snapshot.ratio;renderer.setClearColor(palettes[state.palette].bg,1);controls.enabled=snapshot.controlsEnabled;applyFrame(state.progress);exporting=false;resize();lastTime=0;dirty=true;};
}
async function exportPNG(){
  if(exporting)return;const button=$('export-png');button.disabled=true;button.textContent='Rendering…';if(rebuildTimer)rebuild();exporting=true;
  const width=+$('export-size').value,height=Math.round(width/camera.aspect),transparent=$('transparent').checked;let restore;
  try{
    restore=captureView(width,height,transparent);applyFrame(state.progress);renderScene();
    const blob=await new Promise(resolve=>renderer.domElement.toBlob(resolve,'image/png'));if(!blob)throw new Error('Canvas export failed');download(blob,'png');toast(`PNG exported · ${width} × ${height}`);
  }catch(e){console.error(e);toast('Could not export this PNG. Try the smaller size.');}
  finally{restore?.();exporting=false;button.disabled=false;button.textContent='Download PNG ↗';}
}
function videoDimensions(){
  const size=+$('video-size').value,format=$('video-ratio').value;
  const ratio=format==='landscape'?16/9:format==='square'?1:format==='portrait'?9/16:camera.aspect;
  let width=ratio>=1?size:size*ratio,height=ratio>=1?size/ratio:size,fitted=false;
  // H.264 level 5.2 caps a frame at 36,864 macroblocks (about 9.4 MP). Square
  // or tall-canvas 4K exceeds it, so shrink to the largest frame that encodes.
  const blocks=(w,h)=>Math.ceil(w/16)*Math.ceil(h/16);
  while(blocks(width,height)>36864){const scale=Math.sqrt(36864/blocks(width,height))*.999;width*=scale;height*=scale;fitted=true;}
  const even=v=>Math.max(2,Math.floor(v/2)*2);
  return{width:even(width),height:even(height),fitted};
}
async function updateVideoOptions(){
  const revision=++supportRevision,{width,height,fitted}=videoDimensions();
  $('video-summary').textContent=`${width} × ${height}${fitted?' (largest H.264 frame at this ratio)':''} · ${state.duration} seconds · 30 fps · ${state.sequence==='orbit'?'Seamless 360° orbit loop':(state.deconstruct?'Build, hold & return':'Growth + final hold')+(state.loop?' · repeat preview':'')}${state.turntable&&state.sequence!=='orbit'?' · Turntable':''}${state.camMove&&state.sequence!=='orbit'?` · Zoom ${state.zoomFrom}% → ${state.zoomTo}%`:''}${state.rotMove&&state.sequence!=='orbit'?` · Rotate ${state.rotFrom}° → ${state.rotTo}°`:''}${state.spreadMove&&state.sequence!=='orbit'&&state.form!=='cascading'?` · Spread ${state.spreadFrom} → ${state.spread}`:''}${state.dofMove&&state.sequence!=='orbit'?` · Blur ${state.dofFrom}% → ${state.dofTo}%`:''}${state.burst&&state.sequence!=='orbit'?' · From one dot':''}${state.drift&&state.sequence!=='orbit'?` · Ambient growth +${state.driftAmount}%`:''}${sproutsActive(state)?` · ${state.sproutCount} sprouts`:''}${extensionBase(state)!==null?` · Keeps growing gen ${extensionBase(state)} → ${state.generations}`:''}`;
  $('export-video').disabled=true;$('video-support').textContent='Checking MP4 support…';
  const support=await checkVideoSupport({width,height});if(revision!==supportRevision||exporting)return;
  $('export-video').disabled=!support.supported;$('video-support').textContent=support.supported?'H.264 MP4 · Solid background · Silent video':support.reason;
}
async function exportVideo(){
  if(exporting)return;if(rebuildTimer)rebuild();const {width,height}=videoDimensions();
  exporting=true;exportController=new AbortController();$('export-dialog').classList.add('exporting');$('export-progress').hidden=false;
  $('video-progress').value=0;$('export-percent').textContent='0%';$('export-status').textContent='Preparing video…';let restore;
  try{
    restore=captureView(width,height,false,$('video-ratio').value!=='current');
    const result=await exportGrowthVideo({width,height,duration:state.duration,fps:30,seamlessLoop:state.sequence==='orbit',signal:exportController.signal,
      renderFrame:progress=>{applyFrame(progress);renderScene();return renderer.domElement;},
      onProgress:({phase,progress,frame,frames})=>{$('video-progress').value=progress;$('export-percent').textContent=Math.round(progress*100)+'%';$('export-status').textContent=phase==='rendering'?`Rendering frame ${frame} / ${frames}`:phase==='finalizing'?'Finishing your MP4…':phase==='complete'?'Video ready':'Preparing video…';}
    });
    download(result.blob,result.extension);toast(`MP4 exported · ${state.duration} seconds · ${width} × ${height}`);
  }catch(error){if(error.name==='AbortError')toast('Video export canceled. Your study is unchanged.');else{console.error(error);$('video-support').textContent=error.message;toast('Video export could not finish. See the export panel for details.');}}
  finally{restore?.();exporting=false;exportController=null;$('export-dialog').classList.remove('exporting');$('export-progress').hidden=true;updateReadouts();}
}
function exportSVG(){
  if(exporting)return;if(rebuildTimer)rebuild();applyFrame(state.progress);
  const width=+$('export-size').value,height=Math.round(width/camera.aspect);
  download(new Blob([withCameraMove(()=>buildSVG({width,height,transparent:$('transparent').checked}))],{type:'image/svg+xml'}),'svg');toast('Editable SVG exported.');
}
function buildSVG({width,height,transparent=false,print=null,crop=null,bounds=null,capture=null,sharp=false}){
  const p=palettes[state.palette],scale=width/renderer.getSize(new THREE.Vector2()).x,frame=motionFrame,unitsPerInch=print?(crop?.width||width)/print.width:0;
  camera.updateMatrixWorld();art.updateMatrixWorld();const v=new THREE.Vector3(),view=new THREE.Vector3();
  const project=(pos,inArt=true)=>{v.fromArray(pos);if(inArt)v.applyMatrix4(art.matrixWorld);view.copy(v).applyMatrix4(camera.matrixWorldInverse);v.project(camera);return{x:(v.x*.5+.5)*width,y:(-.5*v.y+.5)*height,z:v.z,d:-view.z};};
  const colorMixes=new Map();
  const color=tone=>{tone=clamp(tone,0,1);const hex='#'+new THREE.Color(p.primary).lerp(new THREE.Color(p.secondary),tone).getHexString();colorMixes.set(hex,{primary:p.primary,secondary:p.secondary,tone});return hex;};
  const ink=hex=>colorMixes.get(hex)||{primary:hex,tone:0};
  const description=fieldArtwork?`Procedural filament field. ${model.traces.length} trajectories, seed ${state.seed}. ${state.motion} motion at ${(state.progress*state.duration).toFixed(2)} seconds. Arbitrary units.`:cascadingArtwork?`Parametric surface. ${state.folds} primary folds, amplitude ${state.foldAmplitude}. Continuous growth at ${(state.progress*state.duration).toFixed(2)} seconds. Chart coordinates use arbitrary units.`:`Synthetic creative study. Growth factor ${state.rate}, ${state.generations} generations, seed ${state.seed}. ${state.motion} motion at ${(state.progress*state.duration).toFixed(2)} seconds.`;
  const number=n=>Number(n.toFixed(print?5:2)),opacity=n=>Number(printAlpha(n,print).toFixed(4)),dotRadius=n=>number(printRadius(n,print,unitsPerInch)),physical=svgPhysicalFrame(width,height,print,crop);
  const include=(q,r=0)=>{if(!bounds)return;bounds.minX=Math.min(bounds.minX,q.x-r);bounds.minY=Math.min(bounds.minY,q.y-r);bounds.maxX=Math.max(bounds.maxX,q.x+r);bounds.maxY=Math.max(bounds.maxY,q.y+r);};
  const blur=d=>print||sharp?0:dofCoc(d,dofUniforms)*scale;
  const circle=(q,r,fill,alpha)=>{const c=blur(q.d);if(c>0){const wide=r+c/2;alpha*=dotFade(r,wide);r=wide;}if(alpha<.001)return;r=dotRadius(r);include(q,r);if(capture)capture.shapes.push({type:'circle',x:number(q.x),y:number(q.y),radius:r,alpha:opacity(alpha),ink:ink(fill)});
    pieces.push(`<circle cx="${number(q.x)}" cy="${number(q.y)}" r="${r}" fill="${fill}" opacity="${opacity(alpha)}"/>`);};
  const printDescription=print?` Print artwork: ${print.width} × ${print.height} in; close artwork crop with 3% margin per side; RGB/sRGB colors. ${print.reinforce?`Minimum line ${print.line} pt; minimum dot diameter ${print.dot} pt; opacity floor ${print.opacity*100}%.`:'Original detail weights.'} Raster target 300 PPI.`:'';
  const pieces=[`<svg xmlns="http://www.w3.org/2000/svg" ${physical.attributes}><title>NRF Growth Field — ${forms[state.form].label}</title><desc>${description}${printDescription}</desc><defs><clipPath id="frame"><rect x="${physical.x}" y="${physical.y}" width="${physical.width}" height="${physical.height}"/></clipPath></defs>`];
  if(!transparent)pieces.push(`<rect x="${physical.x}" y="${physical.y}" width="${physical.width}" height="${physical.height}" fill="${p.bg}"/>`);pieces.push(`<g stroke-linecap="round"><g clip-path="url(#frame)">`);
  let gradientIndex=0;
  const fadedSegment=(a,b,stroke,width,alphaAt,widen=false)=>{
    if(a.z<=-1||a.z>=1||b.z<=-1||b.z>=1)return;
    const c=blur((a.d+b.d)/2);if(c>0){const k=widen?width/(width+c):hairlineFade(c/scale),fade=alphaAt;if(widen)width+=c;alphaAt=t=>fade(t)*k;}
    const stops=[0,.25,.5,.75,1].map(t=>[t,clamp(alphaAt(t),0,1)]);
    width=printStroke(width,print,unitsPerInch);
    if(stops.every(([,alpha])=>alpha<.001))return;
    include(a,width/2);include(b,width/2);
    if(capture)capture.shapes.push({type:'line',a:{x:number(a.x),y:number(a.y)},b:{x:number(b.x),y:number(b.y)},width:number(width),stops:stops.map(([t,alpha])=>[t,opacity(alpha)]),ink:ink(stroke)});
    const path=`M${number(a.x)} ${number(a.y)}L${number(b.x)} ${number(b.y)}`;
    if(stops.every(([,alpha])=>Math.abs(alpha-stops[0][1])<.0001)){
      pieces.push(`<path d="${path}" fill="none" stroke="${stroke}" stroke-width="${number(width)}" opacity="${opacity(stops[0][1])}"/>`);return;
    }
    const id=`strand-${gradientIndex++}`;
    pieces.push(`<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${number(a.x)}" y1="${number(a.y)}" x2="${number(b.x)}" y2="${number(b.y)}">${stops.map(([t,alpha])=>`<stop offset="${t}" stop-color="${stroke}" stop-opacity="${opacity(alpha)}"/>`).join('')}</linearGradient></defs><path d="${path}" fill="none" stroke="url(#${id})" stroke-width="${number(width)}"/>`);
  };
  // Field-style poses (filament fields and sprouts): quads of fixed width plus sized dots.
  // hairline: draw strands as the generative forms do, one pixel wide.
  const drawPose=(pose,segments,marks,kind,hairline=false)=>{
    const width=hairline?scale:scale*FIELD_LINE_WIDTH;
    const visible=q=>q.z>-1&&q.z<1;
    if(state.style!=='dots'){
      pieces.push(`<g fill="none" stroke="${p.primary}" stroke-width="${number(width)}"${kind?` data-kind="${kind}"`:''}>`);
      for(let i=0;i<segments;i++){
        const alpha=pose.lineAlpha[i*2],endAlpha=pose.lineAlpha[i*2+1];if(Math.max(alpha,endAlpha)<.001)continue;
        const a=project(pose.linePositions.subarray(i*6,i*6+3)),b=project(pose.linePositions.subarray(i*6+3,i*6+6));
        fadedSegment(a,b,p.primary,width,t=>alpha+(endAlpha-alpha)*t,!hairline);
      }pieces.push('</g>');
    }
    if(state.style!=='filaments')for(let i=0;i<marks;i++){
      const alpha=pose.dotAlpha[i];if(alpha<.001)continue;const q=project(pose.dotPositions.subarray(i*3,i*3+3));if(!visible(q))continue;
      const radius=clamp(pose.dotRadius[i]*2*(state.dotSize/3)*18/Math.max(2,q.d),.65,30)*scale*.5;
      circle(q,radius,p.primary,alpha);
    }
  };
  const closeSVG=()=>{
    if(sproutArtwork)drawPose(sproutArtwork.snapshot(),sproutArtwork.plan.segmentCount,sproutArtwork.plan.markCount,'sprouts',!fieldArtwork);
    pieces.push('</g></g></svg>');return pieces.join('');
  };
  if(fieldArtwork){
    drawPose(fieldArtwork.snapshot(),model.segmentCount,model.markCount);
    return closeSVG();
  }
  if(cascadingArtwork){
    const surface=cascadingArtwork.snapshot(),visible=q=>q.z>-1&&q.z<1;
    pieces.push('<g fill="none" stroke-width="1" stroke-linecap="round">');
    const projected=Array.from({length:surface.positions.length/3},(_,i)=>project(surface.positions.subarray(i*3,i*3+3)));
    if(state.style!=='dots')for(const rim of [false,true])for(const edge of model.edges)if(Boolean(edge.rim)===rim){
      const base=rim?surface.rimOpacity:surface.meshOpacity,a=surface.lineFade[edge.a],b=surface.lineFade[edge.b];
      fadedSegment(projected[edge.a],projected[edge.b],p.primary,scale,t=>base*(a+(b-a)*t));
    }
    pieces.push('</g>');
    if(state.style!=='filaments')for(const index of model.dotIndices){const q=projected[index];if(!visible(q))continue;const radius=clamp(state.dotSize*18/Math.max(2,q.d),1,30)*scale*.5;circle(q,radius,p.primary,surface.dotOpacity);}
    return closeSVG();
  }
  if(state.style!=='dots'){
    pieces.push(`<g fill="none" stroke-width="${number(scale)}" stroke-linecap="round">`);
    for(const {edge,samples,ends} of paths){
      const a=model.points[edge.a],b=model.points[edge.b];
      const projected=samples.map((pos,j)=>{const t=j/(samples.length-1),origin=ends[0].map((v,i)=>v+(ends[1][i]-v)*t);const variation=a.variation+(b.variation-a.variation)*t;return project(drifted(movingPosition(pos,origin,a.g+(b.g-a.g)*t,variation,frame),variation,frame));});
      for(let j=1;j<projected.length;j++){
        const fraction=(j-.5)/(samples.length-1),pulse=pulseAt(edge.g,b.variation,fraction,frame);
        fadedSegment(projected[j-1],projected[j],color(pulse*.28),scale,t=>{
          const f=(j-1+t)/(samples.length-1);
          return traceAlpha(edge.g,b.variation,f,frame)*state.lineOpacity/100*(1+pulseAt(edge.g,b.variation,f,frame)*.5)*filamentFade(f,b.variation,state);
        });
      }
    }pieces.push('</g>');
  }
  if(state.style!=='filaments'){
    const dots=model.points.map((point,i)=>{const timing=pointTiming(point.g,point.variation,frame),pulse=pulseAt(point.g,point.variation,1,frame);return{...project(drifted(movingPosition(point.pos,origins[i],point.g,point.variation,frame),point.variation,frame)),tone:(point.variation>.91?.8:0)+pulse*.28,alpha:timing.alpha*(1+pulse*.5),size:1+timing.pop*.6*frame.energy+pulse*.16};}).filter(q=>q.alpha>.001&&q.z>-1&&q.z<1).sort((a,b)=>b.z-a.z);
    for(const q of dots){const radius=clamp(state.dotSize*18/Math.max(2,q.d),1,30)*scale*.5*q.size;circle(q,radius,color(q.tone),Math.min(1,q.alpha));}
  }
  return closeSVG();
}

let printProofURL=null;
function currentPrintLayout(){
  const options={unit:$('print-unit').value,reinforce:$('print-reinforce').checked};
  for(const key of ['width','height','line','dot','opacity']){const value=$('print-'+key).value;if(value.trim()==='')throw new Error('Complete every print size and detail field.');options[key]=Number(value);}
  return printLayout(options);
}
function makePrintArtwork(request){
  if(rebuildTimer)rebuild();let restore;
  try{
    exporting=true;const width=1200,height=1200,transparent=$('print-transparent').checked;
    restore=captureView(width,height,transparent,true);applyFrame(state.progress);
    const measure=()=>({minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity});
    let bounds=measure();withCameraMove(()=>buildSVG({width,height,transparent,bounds,sharp:true}));
    let result=cropPrintLayout(request,bounds);
    // Measure reinforced marks at the final physical scale before setting the crop.
    for(let i=0;i<6;i++){
      bounds=measure();withCameraMove(()=>buildSVG({width,height,transparent,print:result.layout,crop:result.crop,bounds}));
      result=cropPrintLayout(request,bounds);
    }
    const artwork={layout:result.layout,crop:result.crop,background:transparent?null:palettes[state.palette].bg,shapes:[]};
    const svg=withCameraMove(()=>buildSVG({width,height,transparent,print:result.layout,crop:result.crop,capture:artwork}));
    return {layout:result.layout,svg,artwork};
  }finally{restore?.();exporting=false;}
}
function updatePrintOptions(){
  if(exporting)return;
  for(const key of ['line','dot','opacity'])$('print-'+key).disabled=!$('print-reinforce').checked;
  try{
    const {layout,svg,artwork}=makePrintArtwork(currentPrintLayout());
    $('print-summary').textContent=`Artwork: ${layout.width.toFixed(3)} × ${layout.height.toFixed(3)} in · 3% margin per side\n300 PPI: ${layout.pixelWidth.toLocaleString()} × ${layout.pixelHeight.toLocaleString()} px. ${layout.rasterOK?'Vector PDF + RGB copies available.':'Use PDF or SVG at this size. PNG exceeds the 64 megapixel / 16,384 px edge limit.'}`;
    if(Math.min(layout.width,layout.height)<4)$('print-summary').textContent+='\nDense forms can merge at small sizes. Reduce density or generations and proof at actual size.';
    if(!layout.reinforce)$('print-summary').textContent+='\nOriginal weights may be too fine for print. Check a full-size proof.';
    if($('print-transparent').checked)$('print-summary').textContent+='\nTransparency: check contrast against your final stock or background.';
    const mode=$('print-color-mode').value;
    $('print-color-note').textContent=mode==='cmyk'?'PDF uses the approved CMYK ink percentages. Accent colors mix those recipes; fades retain live transparency.':'PDF preserves named PANTONE ink plates and accent ink mixtures. Fades retain live transparency. Confirm coated/uncoated ink names with your printer; the palette does not specify a suffix.';
    $('print-ink-summary').textContent=artworkInks(artwork).map(c=>c.paper?`${c.name} · paper, no ink`:mode==='pms'?`${c.name} · PMS ${c.pms}`:`${c.name} · C${c.cmyk[0]} M${c.cmyk[1]} Y${c.cmyk[2]} K${c.cmyk[3]}`).join('\n');
    $('export-print-pdf').textContent=mode==='cmyk'?'Download CMYK PDF ↗':'Download PMS PDF ↗';
    const next=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
    $('print-proof-image').src=next;if(printProofURL)URL.revokeObjectURL(printProofURL);printProofURL=next;
    $('print-proof-image').hidden=false;$('export-print-pdf').disabled=$('export-print-svg').disabled=false;$('export-print-png').disabled=!layout.rasterOK;
  }catch(error){$('print-summary').textContent=error.message;$('print-proof-image').hidden=true;$('export-print-pdf').disabled=$('export-print-svg').disabled=$('export-print-png').disabled=true;}
}
async function exportPrint(format){
  if(exporting)return;let layout,svg,artwork;
  try{({layout,svg,artwork}=makePrintArtwork(currentPrintLayout()));}catch(error){$('print-summary').textContent=error.message;return;}
  exporting=true;$('print-options').classList.add('print-busy');$('print-summary').textContent='Preparing print artwork…';
  try{
    // Let the progress message paint before rasterizing the vector master.
    await new Promise(resolve=>setTimeout(resolve,0));
    const mode=$('print-color-mode').value,label=format==='pdf'?(mode==='cmyk'?'CMYK PDF':'PMS PDF'):`RGB ${format.toUpperCase()}`;
    const blob=format==='pdf'?buildPrintPDF(artwork,mode):format==='svg'?new Blob([svg],{type:'image/svg+xml'}):await rasterizePrint(svg,layout,message=>{$('print-summary').textContent=message;});
    download(blob,`print-${layout.totalWidth.toFixed(3)}x${layout.totalHeight.toFixed(3)}in-${format==='pdf'?mode:'rgb'}${format==='png'?'-300ppi':''}.${format}`);$('print-summary').textContent=`${label} exported · ${layout.totalWidth.toFixed(3)} × ${layout.totalHeight.toFixed(3)} in${format==='png'?' · 300 PPI':''}.`;toast(`${label} exported · ${layout.totalWidth.toFixed(3)} × ${layout.totalHeight.toFixed(3)} in`);
  }catch(error){console.error(error);$('print-summary').textContent=error.message;toast('Print export could not finish. See the export panel.');}
  finally{exporting=false;$('print-options').classList.remove('print-busy');lastTime=0;dirty=true;}
}
