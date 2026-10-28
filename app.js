import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { defaults, sanitize, buildModel, edgeSamples, clamp } from './model.mjs';
import { timelineAt, pointTiming, movingPosition, traceAlpha, pulseAt } from './motion.mjs';
import { checkVideoSupport, exportGrowthVideo } from './video-export.mjs';
import { createCascadingArtwork } from './cascading-scene.mjs';
import { createFieldArtwork } from './fields-scene.mjs';
import { isField, FIELD_LINE_WIDTH } from './fields.mjs';

const $=id=>document.getElementById(id), $$=s=>[...document.querySelectorAll(s)];
const STORAGE='nrf-growth-field-v1';
const palettes=[
  {name:'Fresh Green / Expanse',bg:'#121412',primary:'#5AEB41',secondary:'#F6F5EF',text:'#F6F5EF',muted:'#a4aaa1'},
  {name:'Vivid Blue / Chalk',bg:'#F6F5EF',primary:'#1F41FF',secondary:'#062059',text:'#121412',muted:'#5c6257'},
  {name:'Orange / Mahogany',bg:'#65131A',primary:'#FF5825',secondary:'#F6F5EF',text:'#F6F5EF',muted:'#e6bcb6'},
  {name:'Fresh Green / Fir',bg:'#173B2B',primary:'#5AEB41',secondary:'#F6F5EF',text:'#F6F5EF',muted:'#b0cbb7'},
  {name:'Chalk / Oxford Blue',bg:'#062059',primary:'#F6F5EF',secondary:'#5AEB41',text:'#F6F5EF',muted:'#b5c5e4'},
  {name:'Expanse / Fresh Green',bg:'#5AEB41',primary:'#121412',secondary:'#173B2B',text:'#121412',muted:'#244f1c'},
  {name:'Chalk / Vivid Blue',bg:'#1F41FF',primary:'#F6F5EF',secondary:'#5AEB41',text:'#F6F5EF',muted:'#c4ceff'}
];
const forms={ascent:{number:'01',label:'EXPONENTIAL GROWTH',description:'One idea becomes a field of possibility.'},multiply:{number:'02',label:'MULTIPLICITY',description:'Every beginning holds the potential for many.'},network:{number:'03',label:'NETWORK EFFECT',description:'More connections. More collective possibility.'},cascading:{number:'04',label:'CASCADING FOLDS',description:'A continuous surface. An increasingly complex edge.'},radial:{number:'05',label:'RADIAL PROLIFERATION',description:'One origin. Hundreds of possible directions.'},shell:{number:'06',label:'DISSEMINATION SHELL',description:'Many trajectories accumulate into a shared form.'},bifurcation:{number:'07',label:'BIFURCATION FIELD',description:'A common beginning opens into parallel futures.'}};
const motionLabels={cascade:'Staggered arrivals gather into a growing field.',unfurl:'A slower opening, with soft landings and flowing connections.',pulse:'Waves of energy travel through an expanding network.'};
let exporting=false,exportController=null,supportRevision=0,motionFrame,origins=[],pivot;
let state={...defaults},saved=[],initialView=null,dirty=true,playing=false,lastTime=0,rebuildTimer=0,toastTimer=0;
try{const stored=JSON.parse(localStorage.getItem(STORAGE)||'null');if(stored){state=sanitize(stored.state);saved=Array.isArray(stored.saved)?stored.saved.filter(x=>x&&typeof x==='object'&&x.state&&typeof x.state==='object').slice(0,12):[];initialView=stored.view;}}catch{}
try{if(location.hash.startsWith('#study=')){const shared=JSON.parse(atob(decodeURIComponent(location.hash.slice(7))));state=sanitize(shared.state);initialView=shared.view;}}catch{toast('This study link could not be read. Showing the default field.');}
if(matchMedia('(prefers-reduced-motion: reduce)').matches)state.autoOrbit=false;

let renderer,scene,camera,controls,art,model,dotMaterial,lineMaterial,cascadingArtwork,fieldArtwork,paths=[];
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
function viewSnapshot(){return{position:camera.position.toArray(),target:controls.target.toArray()};}
function validVector(v){return Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1000);}
function applyView(v){if(v&&validVector(v.position)&&validVector(v.target)&&new THREE.Vector3(...v.position).distanceTo(new THREE.Vector3(...v.target))>1){camera.position.fromArray(v.position);controls.target.fromArray(v.target);const distance=camera.position.distanceTo(controls.target);controls.maxDistance=Math.max(65,distance*1.5);camera.far=Math.max(200,distance*4);camera.updateProjectionMatrix();controls.update();dirty=true;}else resetView();}
function resetView(view='perspective'){
  const dir=view==='front'?new THREE.Vector3(0,0,1):view==='top'?new THREE.Vector3(0,1,.001):state.form==='cascading'?new THREE.Vector3(.72,.78,.8).normalize():model?.kind==='field'?new THREE.Vector3(.12,.4,1).normalize():new THREE.Vector3(.74,.28,.8).normalize();
  const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),dir).normalize();
  const up=new THREE.Vector3().crossVectors(dir,right).normalize();
  art.updateMatrixWorld();
  const fittingPoints=model?(model.framingPoints||model.points.map(p=>p.pos)):[];
  const viewPoints=fittingPoints.map(p=>art.localToWorld(new THREE.Vector3(...p)));
  const box=model?new THREE.Box3().setFromPoints(viewPoints):new THREE.Box3(new THREE.Vector3(-4,-3,-3),new THREE.Vector3(4,3,3));
  const center=state.turntable&&model?pivot.clone():box.getCenter(new THREE.Vector3()),tan=Math.tan(camera.fov*Math.PI/360);
  const compact=matchMedia('(max-width:620px)').matches,offsetX=compact?0:.1,offsetY=compact?.22:.1,marginX=compact?.88:.82,marginTop=compact?.36:.72,marginBottom=.72;
  let d=14;
  const include=point=>{
    const v=point.clone().sub(center),x=v.dot(right)/(tan*camera.aspect),y=v.dot(up)/tan,z=v.dot(dir);
    // Fit the perspective projection, including the deliberate right/down offset.
    d=Math.max(d,(x+marginX*z)/(marginX-offsetX),(-x+marginX*z)/(marginX+offsetX),(y+marginTop*z)/(marginTop+offsetY),(-y+marginBottom*z)/(marginBottom-offsetY));
  };
  for(const point of viewPoints)include(point);
  if(state.turntable&&model)for(let step=0;step<24;step++)for(const point of fittingPoints)include(new THREE.Vector3(...point).sub(pivot).applyAxisAngle(new THREE.Vector3(0,1,0),step*Math.PI/12).add(pivot));
  controls.maxDistance=Math.max(65,d*1.5);camera.far=Math.max(200,d*4);camera.updateProjectionMatrix();
  controls.target.copy(center).addScaledVector(up,d*tan*offsetY).addScaledVector(right,-d*tan*camera.aspect*offsetX);
  camera.position.copy(controls.target).addScaledVector(dir,d);
  controls.update();$$('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-pressed',b.dataset.view===view);});dirty=true;
}
function disposeGroup(group){const geometries=new Set(),materials=new Set(),textures=new Set();group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of (Array.isArray(o.material)?o.material:o.material?[o.material]:[])){materials.add(m);if(m.map)textures.add(m.map);}});geometries.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());group.clear();}
function makeMaterial(points){
  const p=palettes[state.palette];
  return new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{uColor:{value:new THREE.Color(p.primary)},uAccent:{value:new THREE.Color(p.secondary)},uClock:{value:0},uPulse:{value:0},uEnergy:{value:state.energy/100},uStagger:{value:state.stagger/100},uMode:{value:0},uSize:{value:state.dotSize},uPixelRatio:{value:renderer.getPixelRatio()},uOpacity:{value:points?1:state.lineOpacity/100}},
    vertexShader:`
      attribute vec3 aOrigin; attribute float aGeneration; attribute float aVariation; attribute float aTone;
      ${points?'':'attribute float aFraction; attribute float aTraceGeneration; attribute float aTraceVariation;'}
      varying float vAlpha; varying float vTone;
      uniform float uClock; uniform float uPulse; uniform float uEnergy; uniform float uStagger; uniform float uMode; uniform float uSize; uniform float uPixelRatio;
      void main(){
        float birth=aGeneration-1.0+aVariation*uStagger*.65;
        float age=aGeneration==0.0?1.0:clamp((uClock-birth)/1.2,0.0,1.0);
        float base=uMode==1.0?smoothstep(0.0,1.0,age):1.0-pow(1.0-age,3.0);
        float pop=sin(3.14159265*age)*pow(1.0-age,2.0);
        float amount=base+pop*uEnergy*.7;
        vec3 displaced=mix(aOrigin,position,amount);
        float generation=${points?'aGeneration':'aTraceGeneration'};
        float variation=${points?'aVariation':'aTraceVariation'};
        float fraction=${points?'1.0':'aFraction'};
        float traveling=.5+.5*cos(fraction*6.2831853-uPulse+generation*.7+variation*3.0);
        float front=exp(-pow(uClock-generation-.2,2.0)*3.0);
        float pulse=uEnergy*(pow(traveling,12.0)*.65+front*.7)*(uMode==2.0?1.5:1.0);
        vAlpha=${points?'smoothstep(0.0,.16,age)':'smoothstep(0.0,.14,uClock-(generation-1.0+variation*uStagger*.65)-fraction*.72)'};
        vAlpha*=1.0+pulse*.5;
        vTone=clamp(aTone+pulse*.28,0.0,1.0);
        vec4 mv=modelViewMatrix*vec4(displaced,1.0); gl_Position=projectionMatrix*mv;
        gl_PointSize=clamp(uSize*(18.0/max(2.0,-mv.z)),1.0,30.0)*uPixelRatio*(1.0+pop*.6*uEnergy+pulse*.16);
      }`,
    fragmentShader:`uniform vec3 uColor; uniform vec3 uAccent; uniform float uOpacity; varying float vAlpha; varying float vTone; void main(){ ${points?'float d=length(gl_PointCoord-0.5); if(d>.5)discard; float edge=1.0-smoothstep(.34,.5,d);':'float edge=1.0;'} if(vAlpha<.001)discard; gl_FragColor=vec4(mix(uColor,uAccent,vTone),min(1.0,uOpacity*vAlpha*edge));
#include <tonemapping_fragment>
#include <colorspace_fragment>
 }`});
}
function rebuild(){
  clearTimeout(rebuildTimer);rebuildTimer=0;disposeGroup(art);cascadingArtwork=null;fieldArtwork=null;dotMaterial=null;lineMaterial=null;model=buildModel(state);paths=[];
  if(model.kind==='field'){
    pivot.copy(new THREE.Box3().setFromPoints(model.points.map(p=>new THREE.Vector3(...p.pos))).getCenter(new THREE.Vector3()));
    fieldArtwork=createFieldArtwork(THREE,model,state,palettes[state.palette],renderer.getPixelRatio());art.add(fieldArtwork.group);
    origins=[];updatePalette();updateProgress();dirty=true;return;
  }
  if(model.kind==='cascading'){
    pivot.copy(new THREE.Box3().setFromPoints(model.points.map(p=>new THREE.Vector3(...p.pos))).getCenter(new THREE.Vector3()));
    cascadingArtwork=createCascadingArtwork(THREE,model,state,palettes[state.palette],renderer.getPixelRatio());art.add(cascadingArtwork.group);
    origins=[];updatePalette();updateProgress();dirty=true;return;
  }
  origins=model.points.map(p=>p.pos);const parentSet=new Set();
  for(const e of model.edges){const a=model.points[e.a],b=model.points[e.b],child=a.g>b.g?e.a:e.b,parent=child===e.a?e.b:e.a;if(a.g!==b.g&&!parentSet.has(child)){origins[child]=model.points[parent].pos;parentSet.add(child);}}
  pivot.copy(new THREE.Box3().setFromPoints(model.points.map(p=>new THREE.Vector3(...p.pos))).getCenter(new THREE.Vector3()));
  const pos=[],gens=[],tones=[],variations=[],pointOrigins=[];
  for(const [i,p] of model.points.entries()){pos.push(...p.pos);gens.push(p.g);tones.push(p.variation>.91?.8:0);variations.push(p.variation);pointOrigins.push(...origins[i]);}
  const geometry=new THREE.BufferGeometry();
  for(const [key,values,size] of [['position',pos,3],['aOrigin',pointOrigins,3],['aGeneration',gens,1],['aVariation',variations,1],['aTone',tones,1]])geometry.setAttribute(key,new THREE.Float32BufferAttribute(values,size));
  dotMaterial=makeMaterial(true);const dots=new THREE.Points(geometry,dotMaterial);dots.name='dots';dots.frustumCulled=false;dots.visible=state.style!=='filaments';art.add(dots);
  const lp=[],lg=[],lt=[],lo=[],lv=[],lf=[],ltg=[],ltv=[];
  for(const raw of model.edges){
    const edge=model.points[raw.a].g>model.points[raw.b].g?{...raw,a:raw.b,b:raw.a}:raw;
    const steps=state.form==='multiply'?4:state.form==='network'?6:12;
    const samples=edgeSamples(model,edge,state.form,steps);paths.push({edge,samples});
    const a=model.points[edge.a],b=model.points[edge.b];
    for(let j=1;j<samples.length;j++)for(const k of [j-1,j]){const t=k/steps;lp.push(...samples[k]);lg.push(a.g+(b.g-a.g)*t);lv.push(a.variation+(b.variation-a.variation)*t);lo.push(...origins[edge.a].map((v,i)=>v+(origins[edge.b][i]-v)*t));lt.push(0);lf.push(t);ltg.push(edge.g);ltv.push(b.variation);}
  }
  const linesGeometry=new THREE.BufferGeometry();
  for(const [key,values,size] of [['position',lp,3],['aOrigin',lo,3],['aGeneration',lg,1],['aVariation',lv,1],['aTone',lt,1],['aFraction',lf,1],['aTraceGeneration',ltg,1],['aTraceVariation',ltv,1]])linesGeometry.setAttribute(key,new THREE.Float32BufferAttribute(values,size));
  lineMaterial=makeMaterial(false);const lines=new THREE.LineSegments(linesGeometry,lineMaterial);lines.name='lines';lines.frustumCulled=false;lines.visible=state.style!=='dots';art.add(lines);
  updatePalette();updateProgress();dirty=true;
}
function updatePalette(){
  const p=palettes[state.palette],root=document.documentElement;
  root.style.setProperty('--stage-bg',p.bg);root.style.setProperty('--stage-text',p.text);root.style.setProperty('--stage-muted',p.muted);root.style.setProperty('--stage-line',p.text+'26');renderer.setClearColor(p.bg,1);
  for(const m of [dotMaterial,lineMaterial])if(m){m.uniforms.uColor.value.set(p.primary);m.uniforms.uAccent.value.set(p.secondary);}
  if(cascadingArtwork)cascadingArtwork.setPalette(p);
  if(fieldArtwork)fieldArtwork.setPalette(p);
  $('palette-name').textContent=p.name;$('palette-hex').textContent=p.primary;
  $$('[data-palette]').forEach(b=>{const active=+b.dataset.palette===state.palette;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});dirty=true;
}
function updateReadouts(){
  const frame=motionFrame||timelineAt(state.progress,state),g=frame.growth*state.generations;
  if(fieldArtwork){
    const pose=fieldArtwork.snapshot();
    $('node-count').textContent=(state.style==='filaments'?0:pose.activeMarks).toLocaleString();$('edge-count').textContent=(state.style==='dots'?0:pose.activeTraces).toLocaleString();$('seed-readout').textContent=String(state.seed).padStart(4,'0');
    $('progress-label').textContent=`${(state.progress*state.duration).toFixed(1)} / ${state.duration} S · ${Math.round(frame.growth*100)}%`;
    $('motion-phase').textContent=state.progress===1&&!state.loop?'Watch it grow':frame.phase;
    $('growth-readout').textContent=Math.round(frame.growth*100)+'%';$('growth-readout').title='Growth sequence completion';
    $('model-note').textContent=`${model.traces.length.toLocaleString()} trajectories from a shared origin. Procedural geometry in arbitrary units.`;
    $('progress').value=Math.round(state.progress*1000);rangeFill($('progress'));return;
  }
  if(cascadingArtwork){
    const ratio=cascadingArtwork.snapshot().rimRatio;
    $('node-count').textContent=model.dotIndices.length.toLocaleString();$('edge-count').textContent=(state.style==='dots'?0:model.edges.length).toLocaleString();
    $('progress-label').textContent=`${(state.progress*state.duration).toFixed(1)} / ${state.duration} S · ${Math.round(frame.growth*100)}%`;
    $('motion-phase').textContent=state.progress===1&&!state.loop?'Watch it fold':frame.phase==='Return'?'Return':frame.growth<.1?'Seed':frame.growth<.45?'Expand':frame.growth<.95?'Cascading folds':'Settle';
    $('growth-readout').textContent=ratio.toFixed(2)+'×';$('growth-readout').title='Rim length relative to its flat reference circle';
    $('model-note').textContent=`Parametric surface · ${state.folds} primary folds · rim ${ratio.toFixed(2)}× its flat reference circle. Chart coordinates use arbitrary units.`;
    $('progress').value=Math.round(state.progress*1000);rangeFill($('progress'));return;
  }
  const active=model.points.filter(p=>pointTiming(p.g,p.variation,frame).alpha>.05).length;
  const edges=paths.filter(({edge:e})=>traceAlpha(e.g,model.points[e.b].variation,.5,frame)>.05).length;
  $('node-count').textContent=active.toLocaleString();$('edge-count').textContent=(state.style==='dots'?0:edges).toLocaleString();$('seed-readout').textContent=String(state.seed).padStart(4,'0');
  $('progress-label').textContent=`${(state.progress*state.duration).toFixed(1)} / ${state.duration} S · GEN ${Math.min(state.generations,g).toFixed(1)}`;
  $('motion-phase').textContent=state.progress===1&&!state.loop?'Watch it grow':frame.phase;
  $('growth-readout').textContent=`${Math.round(state.rate**g).toLocaleString()}×`;
  $('growth-readout').title='Synthetic generation multiplier';
  $('model-note').textContent=`Synthetic growth · 1 → ${model.finalCount.toLocaleString()} in ${state.generations} generations.${model.sampled?' Dots sampled at high counts.':''}`;
  $('progress').value=Math.round(state.progress*1000);rangeFill($('progress'));
}
function applyFrame(progress){
  motionFrame=timelineAt(progress,cascadingArtwork?{...state,motion:'pulse'}:state);
  if(fieldArtwork)fieldArtwork.update(motionFrame);
  else if(cascadingArtwork)cascadingArtwork.update(motionFrame.growth);
  else for(const m of [dotMaterial,lineMaterial]){const u=m.uniforms;u.uClock.value=motionFrame.clock;u.uPulse.value=motionFrame.pulse;u.uEnergy.value=motionFrame.energy;u.uStagger.value=motionFrame.stagger;u.uMode.value=motionFrame.mode;}
  art.rotation.y=motionFrame.turn;art.position.copy(pivot).sub(pivot.clone().applyAxisAngle(new THREE.Vector3(0,1,0),motionFrame.turn));art.updateMatrixWorld();dirty=true;
}
function updateProgress(){applyFrame(state.progress);updateReadouts();}
function rangeFill(el){el.style.setProperty('--fill',`${(el.value-el.min)/(el.max-el.min)*100}%`);}
function syncUI(){
  for(const key of ['rate','generations','spread','depth','twist','folds','foldAmplitude','density','dotSize','lineOpacity','duration','energy','stagger']){const el=$(key);el.value=state[key];rangeFill(el);$(`${key}-value`).textContent=key==='rate'?state[key].toFixed(1)+'×':key==='foldAmplitude'?state[key].toFixed(2):key==='twist'?state[key]+'°':['lineOpacity','energy','stagger','density'].includes(key)?state[key]+'%':key==='duration'?state[key]+' s':key==='dotSize'?state[key].toFixed(1):state[key];}
  for(const key of ['autoOrbit','loop','turntable'])$(key).checked=state[key];
  $$('[data-form]').forEach(b=>{const active=b.dataset.form===state.form;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});
  $$('[data-style]').forEach(b=>{const active=b.dataset.style===state.style;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});
  $$('[data-motion]').forEach(b=>{const active=b.dataset.motion===state.motion;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});
  $('motion-description').textContent=motionLabels[state.motion];
  const surface=state.form==='cascading',field=isField(state.form);$('surface-controls').hidden=!surface;
  $('population-controls').hidden=field;$('field-controls').hidden=!field;
  for(const id of ['generative-controls','motion-style-controls','motion-description','motion-detail-controls','generative-variation','seed-label'])$(id).hidden=surface;
  $('node-unit').textContent=surface?'MESH DOTS':'DOTS';$('edge-unit').textContent=surface?'SEGMENTS':field?'TRAJECTORIES':'CONNECTIONS';$('axis-key').hidden=surface||field;
  const f=forms[state.form];$('study-number').textContent=f.number;$('study-label').textContent=f.label;$('stage-description').textContent=f.description;updatePlayButton();
}
function scheduleRebuild(){clearTimeout(rebuildTimer);rebuildTimer=setTimeout(()=>{rebuild();persist();},70);}
function initUI(){
  palettes.forEach((p,i)=>{const b=document.createElement('button');b.className='palette-swatch';b.dataset.palette=i;b.style.background=p.bg;b.title=p.name;b.setAttribute('aria-label',p.name);b.innerHTML=`<svg viewBox="0 0 28 26" aria-hidden="true"><g fill="${p.primary}"><circle cx="7" cy="7" r="3"/><circle cx="21" cy="7" r="3"/><circle cx="7" cy="21" r="3"/><circle cx="21" cy="21" r="3"/></g></svg>`;b.onclick=()=>{state.palette=i;updatePalette();persist();};$('palettes').append(b);});
  $$('[data-form]').forEach(b=>b.onclick=()=>{state.form=b.dataset.form;playing=false;state.progress=state.loop?.5:1;syncUI();rebuild();resetView();persist();});
  $$('[data-style]').forEach(b=>b.onclick=()=>{state.style=b.dataset.style;if(fieldArtwork)fieldArtwork.setStyle(state);else if(cascadingArtwork)cascadingArtwork.setStyle(state);else{art.getObjectByName('dots').visible=state.style!=='filaments';art.getObjectByName('lines').visible=state.style!=='dots';}syncUI();updateReadouts();dirty=true;persist();});
  for(const key of ['rate','generations','spread','depth','twist','folds','foldAmplitude','density'])$(key).addEventListener('input',()=>{state[key]=+$(key).value;syncUI();scheduleRebuild();});
  for(const key of ['dotSize','lineOpacity'])$(key).addEventListener('input',()=>{state[key]=+$(key).value;if(fieldArtwork)fieldArtwork.setStyle(state);else if(cascadingArtwork)cascadingArtwork.setStyle(state);else{dotMaterial.uniforms.uSize.value=state.dotSize;lineMaterial.uniforms.uOpacity.value=state.lineOpacity/100;}syncUI();dirty=true;persist();});
  $$('[data-motion]').forEach(b=>b.onclick=()=>{state.motion=b.dataset.motion;state.progress=0;playing=true;syncUI();updateProgress();persist();});
  for(const key of ['duration','energy','stagger'])$(key).addEventListener('input',()=>{state[key]=+$(key).value;syncUI();updateProgress();persist();});
  for(const key of ['loop','turntable'])$(key).onchange=()=>{state[key]=$(key).checked;if(key==='loop'&&state.loop&&state.progress>.9)state.progress=.5;updateProgress();if(key==='turntable')resetView();persist();};
  $('preview-motion').onclick=()=>{state.progress=0;playing=true;updatePlayButton();updateProgress();};
  $('autoOrbit').onchange=()=>{state.autoOrbit=$('autoOrbit').checked;persist();};
  $('reseed').onclick=()=>{state.seed=state.seed%999999+1;rebuild();persist();toast(`Variation ${String(state.seed).padStart(4,'0')}`);};
  $('reset').onclick=()=>{state={...defaults};playing=false;syncUI();rebuild();resetView();persist();toast('Field reset. Saved studies are still here.');};
  $$('[data-view]').forEach(b=>b.onclick=()=>{resetView(b.dataset.view);persist();});$('fit').onclick=()=>{resetView();persist();};
  $('play').onclick=togglePlay;$('restart').onclick=()=>{state.progress=0;playing=true;updatePlayButton();updateProgress();};
  $('progress').oninput=()=>{state.progress=+$('progress').value/1000;playing=false;updatePlayButton();updateProgress();};$('progress').onchange=persist;
  $('save').onclick=saveStudy;$('share').onclick=share;
  $('panel-toggle').onclick=()=>{const hidden=document.body.classList.toggle('panel-hidden');$('panel-toggle').setAttribute('aria-expanded',!hidden);};
  $('focus').onclick=toggleFocus;$('exit-focus').onclick=toggleFocus;
  $('export-open').onclick=()=>{if(rebuildTimer)rebuild();playing=false;updatePlayButton();$('export-dialog').showModal();updateVideoOptions();};$('export-png').onclick=()=>exportPNG();$('export-svg').onclick=()=>exportSVG();
  $('export-video').onclick=exportVideo;$('cancel-export').onclick=()=>exportController?.abort();
  for(const key of ['video-size','video-ratio'])$(key).onchange=updateVideoOptions;
  $$('[data-export-tab]').forEach(b=>b.onclick=()=>{const video=b.dataset.exportTab==='video';$('video-options').hidden=!video;$('still-options').hidden=video;$$('[data-export-tab]').forEach(tab=>{const active=tab===b;tab.classList.toggle('active',active);tab.setAttribute('aria-pressed',active);});});
  $('export-dialog').addEventListener('cancel',e=>{if(exporting){e.preventDefault();exportController?.abort();}});
  $('export-dialog').addEventListener('submit',e=>{if(exporting)e.preventDefault();});
  $('export-dialog').addEventListener('click',e=>{if(!exporting&&e.target===$('export-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
  document.addEventListener('keydown',e=>{if($('export-dialog').open||['INPUT','SELECT','TEXTAREA','BUTTON','SUMMARY','A'].includes(e.target.tagName)||e.ctrlKey||e.metaKey||e.altKey)return;const key=e.key.toLowerCase();if(key===' '){e.preventDefault();togglePlay();}else if(key==='f'){resetView();persist();}else if(key==='h'||(key==='escape'&&document.body.classList.contains('focus-mode'))){toggleFocus();}else if(['arrowleft','arrowright','arrowup','arrowdown','+','=','-'].includes(key)){e.preventDefault();const offset=camera.position.clone().sub(controls.target),spherical=new THREE.Spherical().setFromVector3(offset);if(key==='arrowleft')spherical.theta-=.12;if(key==='arrowright')spherical.theta+=.12;if(key==='arrowup')spherical.phi-=.12;if(key==='arrowdown')spherical.phi+=.12;if(key==='+'||key==='=')spherical.radius*=.9;if(key==='-')spherical.radius*=1.1;spherical.radius=clamp(spherical.radius,controls.minDistance,controls.maxDistance);spherical.makeSafe();camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));controls.update();persist();}});
  document.addEventListener('visibilitychange',()=>{lastTime=0;});window.addEventListener('pagehide',persist);syncUI();renderSaved();
}
function toggleFocus(){const on=document.body.classList.toggle('focus-mode');$('exit-focus').hidden=!on;if(on)$('viewport').focus();else $('focus').focus();}
function togglePlay(){playing=!playing;if(playing&&state.progress>=.999)state.progress=0;updatePlayButton();updateProgress();if(!playing)persist();}
function updatePlayButton(){$('play').setAttribute('aria-label',playing?'Pause growth animation':'Play growth animation');$('play').innerHTML=playing?'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3H8V17H5ZM12 3H15V17H12Z"/></svg>':'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3L17 10L6 17Z"/></svg>';}
function animate(now){
  requestAnimationFrame(animate);if(document.hidden||exporting){lastTime=0;return;}
  const dt=lastTime?Math.min((now-lastTime)/1000,.1):0;lastTime=now;controls.autoRotate=state.autoOrbit;controls.update(dt);
  if(playing){state.progress+=dt/state.duration;if(state.progress>=1){if(state.loop)state.progress%=1;else{state.progress=1;playing=false;updatePlayButton();persist();}}updateProgress();}
  if(dirty||state.autoOrbit||playing){renderer.render(scene,camera);dirty=false;}
}
function persist(){if(!camera)return;try{localStorage.setItem(STORAGE,JSON.stringify({state,view:viewSnapshot(),saved}));}catch{}}
function saveStudy(){if(rebuildTimer)rebuild();const item={id:Date.now(),name:`${forms[state.form].label.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase())} ${String(saved.length+1).padStart(2,'0')}`,state:{...state},view:viewSnapshot()};saved.unshift(item);saved=saved.slice(0,12);try{localStorage.setItem(STORAGE,JSON.stringify({state,view:viewSnapshot(),saved}));renderSaved();toast('Study saved in this browser.');}catch{saved.shift();toast('Browser storage is unavailable. Use Share to keep this study.');}}
function renderSaved(){const list=$('saved-list');list.replaceChildren();$('saved-count').textContent=saved.length;if(!saved.length){list.innerHTML='<p class="empty-state">Save a composition to return to it here.</p>';return;}saved.forEach(item=>{const row=document.createElement('div');row.className='saved-row';const restore=document.createElement('button'),label=document.createElement('span'),detail=document.createElement('small'),remove=document.createElement('button');label.textContent=String(item.name||'Saved study');const s=sanitize(item.state);detail.textContent=`${palettes[s.palette].name} · ${s.form==='cascading'?s.folds+' folds':isField(s.form)?s.density+'% density':s.rate.toFixed(1)+'×'}`;restore.append(label,detail);restore.onclick=()=>{state=sanitize(item.state);playing=false;syncUI();rebuild();applyView(item.view);persist();toast('Study restored.');};remove.textContent='×';remove.setAttribute('aria-label',`Remove ${item.name||'saved study'}`);remove.onclick=()=>{saved=saved.filter(x=>x.id!==item.id);renderSaved();persist();};row.append(restore,remove);list.append(row);});}
async function share(){if(rebuildTimer)rebuild();const hash='#study='+encodeURIComponent(btoa(JSON.stringify({state,view:viewSnapshot()})));const url=location.origin+location.pathname+hash;try{await navigator.clipboard.writeText(url);history.replaceState(null,'',hash);toast('Study link copied, including your camera view.');}catch{history.replaceState(null,'',hash);toast('Study added to the address bar. Copy the URL to share it.');}}
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.add('visible');toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3600);}
function download(blob,extension){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`nrf-growth-field-${state.form}-${String(state.seed).padStart(4,'0')}.${extension}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function captureView(width,height,transparent=false,fitArtwork=false){
  const snapshot={size:renderer.getSize(new THREE.Vector2()),ratio:renderer.getPixelRatio(),aspect:camera.aspect,fov:camera.fov,controlsEnabled:controls.enabled,position:camera.position.clone(),quaternion:camera.quaternion.clone()};
  controls.enabled=false;renderer.setPixelRatio(1);renderer.setSize(width,height,false);
  const aspect=width/height;
  if(!fitArtwork&&aspect<snapshot.aspect)camera.fov=2*Math.atan(Math.tan(snapshot.fov*Math.PI/360)*snapshot.aspect/aspect)*180/Math.PI;
  camera.aspect=aspect;camera.updateProjectionMatrix();
  if(fitArtwork){
    const dir=camera.position.clone().sub(controls.target).normalize(),right=new THREE.Vector3().crossVectors(camera.up,dir).normalize(),up=new THREE.Vector3().crossVectors(dir,right).normalize(),tan=Math.tan(camera.fov*Math.PI/360);
    let distance=4;
    const turns=state.turntable?24:1;
    for(let step=0;step<turns;step++)for(const point of (model.framingPoints||model.points.map(p=>p.pos))){
      const angle=state.turntable?step*Math.PI/12:0,v=new THREE.Vector3(...point).sub(pivot).applyAxisAngle(new THREE.Vector3(0,1,0),angle),z=v.dot(dir);
      distance=Math.max(distance,Math.abs(v.dot(right))/(tan*aspect*.84)+z,Math.abs(v.dot(up))/(tan*.84)+z);
    }
    camera.position.copy(pivot).addScaledVector(dir,distance);camera.lookAt(pivot);camera.updateMatrixWorld();
  }
  const projectionScale=height/snapshot.size.y*Math.tan(snapshot.fov*Math.PI/360)/Math.tan(camera.fov*Math.PI/360);
  if(fieldArtwork)fieldArtwork.setPixelRatio(projectionScale);else if(cascadingArtwork)cascadingArtwork.setPixelRatio(projectionScale);else dotMaterial.uniforms.uPixelRatio.value=projectionScale;
  renderer.setClearColor(palettes[state.palette].bg,transparent?0:1);
  return()=>{renderer.setPixelRatio(snapshot.ratio);camera.aspect=snapshot.aspect;camera.fov=snapshot.fov;camera.position.copy(snapshot.position);camera.quaternion.copy(snapshot.quaternion);camera.updateProjectionMatrix();if(fieldArtwork)fieldArtwork.setPixelRatio(snapshot.ratio);else if(cascadingArtwork)cascadingArtwork.setPixelRatio(snapshot.ratio);else dotMaterial.uniforms.uPixelRatio.value=snapshot.ratio;renderer.setClearColor(palettes[state.palette].bg,1);controls.enabled=snapshot.controlsEnabled;applyFrame(state.progress);exporting=false;resize();lastTime=0;dirty=true;};
}
async function exportPNG(){
  if(exporting)return;const button=$('export-png');button.disabled=true;button.textContent='Rendering…';if(rebuildTimer)rebuild();exporting=true;
  const width=+$('export-size').value,height=Math.round(width/camera.aspect),transparent=$('transparent').checked;let restore;
  try{
    restore=captureView(width,height,transparent);applyFrame(state.progress);renderer.render(scene,camera);
    const blob=await new Promise(resolve=>renderer.domElement.toBlob(resolve,'image/png'));if(!blob)throw new Error('Canvas export failed');download(blob,'png');toast(`PNG exported · ${width} × ${height}`);
  }catch(e){console.error(e);toast('Could not export this PNG. Try the smaller size.');}
  finally{restore?.();exporting=false;button.disabled=false;button.textContent='Download PNG ↗';}
}
function videoDimensions(){
  const size=+$('video-size').value,format=$('video-ratio').value;
  const ratio=format==='landscape'?16/9:format==='square'?1:format==='portrait'?9/16:camera.aspect;
  return ratio>=1?{width:size,height:Math.max(2,Math.round(size/ratio/2)*2)}:{width:Math.max(2,Math.round(size*ratio/2)*2),height:size};
}
async function updateVideoOptions(){
  const revision=++supportRevision,{width,height}=videoDimensions();
  $('video-summary').textContent=`${width} × ${height} · ${state.duration} seconds · 30 fps · ${state.loop?'Grow & return loop':'Growth + final hold'}${state.turntable?' · Turntable':''}`;
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
    const result=await exportGrowthVideo({width,height,duration:state.duration,fps:30,signal:exportController.signal,
      renderFrame:progress=>{applyFrame(progress);renderer.render(scene,camera);return renderer.domElement;},
      onProgress:({phase,progress,frame,frames})=>{$('video-progress').value=progress;$('export-percent').textContent=Math.round(progress*100)+'%';$('export-status').textContent=phase==='rendering'?`Rendering frame ${frame} / ${frames}`:phase==='finalizing'?'Finishing your MP4…':phase==='complete'?'Video ready':'Preparing video…';}
    });
    download(result.blob,result.extension);toast(`MP4 exported · ${state.duration} seconds · ${width} × ${height}`);
  }catch(error){if(error.name==='AbortError')toast('Video export canceled. Your study is unchanged.');else{console.error(error);$('video-support').textContent=error.message;toast('Video export could not finish. See the export panel for details.');}}
  finally{restore?.();exporting=false;exportController=null;$('export-dialog').classList.remove('exporting');$('export-progress').hidden=true;updateReadouts();}
}
function exportSVG(){
  if(exporting)return;if(rebuildTimer)rebuild();applyFrame(state.progress);
  const width=+$('export-size').value,height=Math.round(width/camera.aspect),p=palettes[state.palette],transparent=$('transparent').checked,scale=width/renderer.getSize(new THREE.Vector2()).x,frame=motionFrame;
  camera.updateMatrixWorld();art.updateMatrixWorld();const v=new THREE.Vector3(),view=new THREE.Vector3();
  const project=(pos,inArt=true)=>{v.fromArray(pos);if(inArt)v.applyMatrix4(art.matrixWorld);view.copy(v).applyMatrix4(camera.matrixWorldInverse);v.project(camera);return{x:(v.x*.5+.5)*width,y:(-.5*v.y+.5)*height,z:v.z,d:-view.z};};
  const color=tone=>'#'+new THREE.Color(p.primary).lerp(new THREE.Color(p.secondary),clamp(tone,0,1)).getHexString();
  const description=fieldArtwork?`Procedural filament field. ${model.traces.length} trajectories, seed ${state.seed}. ${state.motion} motion at ${(state.progress*state.duration).toFixed(2)} seconds. Arbitrary units.`:cascadingArtwork?`Parametric surface. ${state.folds} primary folds, amplitude ${state.foldAmplitude}. Continuous growth at ${(state.progress*state.duration).toFixed(2)} seconds. Chart coordinates use arbitrary units.`:`Synthetic creative study. Growth factor ${state.rate}, ${state.generations} generations, seed ${state.seed}. ${state.motion} motion at ${(state.progress*state.duration).toFixed(2)} seconds.`;
  const number=n=>Number(n.toFixed(2));const pieces=[`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>NRF Growth Field — ${forms[state.form].label}</title><desc>${description}</desc><defs><clipPath id="frame"><rect width="${width}" height="${height}"/></clipPath></defs>`];
  if(!transparent)pieces.push(`<rect width="${width}" height="${height}" fill="${p.bg}"/>`);pieces.push('<g clip-path="url(#frame)">');
  if(fieldArtwork){
    const pose=fieldArtwork.snapshot(),visible=q=>q.z>-1&&q.z<1;
    if(state.style!=='dots'){
      pieces.push(`<g fill="none" stroke="${p.primary}" stroke-width="${number(scale*FIELD_LINE_WIDTH)}">`);
      for(let i=0;i<model.segmentCount;i++){
        const alpha=pose.lineAlpha[i*2];if(alpha<.001)continue;
        const a=project(pose.linePositions.subarray(i*6,i*6+3)),b=project(pose.linePositions.subarray(i*6+3,i*6+6));
        if(visible(a)&&visible(b))pieces.push(`<path d="M${number(a.x)} ${number(a.y)}L${number(b.x)} ${number(b.y)}" opacity="${number(alpha)}"/>`);
      }pieces.push('</g>');
    }
    if(state.style!=='filaments')for(let i=0;i<model.markCount;i++){
      const alpha=pose.dotAlpha[i];if(alpha<.001)continue;const q=project(pose.dotPositions.subarray(i*3,i*3+3));if(!visible(q))continue;
      const radius=clamp(pose.dotRadius[i]*2*(state.dotSize/3)*18/Math.max(2,q.d),.65,30)*scale*.5;
      pieces.push(pose.dotSquare[i]?`<rect x="${number(q.x-radius)}" y="${number(q.y-radius)}" width="${number(radius*2)}" height="${number(radius*2)}" fill="${p.primary}" opacity="${number(alpha)}"/>`:`<circle cx="${number(q.x)}" cy="${number(q.y)}" r="${number(radius)}" fill="${p.primary}" opacity="${number(alpha)}"/>`);
    }
    pieces.push('</g></svg>');download(new Blob(pieces,{type:'image/svg+xml'}),'svg');toast('Editable SVG exported.');return;
  }
  if(cascadingArtwork){
    const surface=cascadingArtwork.snapshot(),visible=q=>q.z>-1&&q.z<1;
    const segment=(a,b,stroke,opacity)=>{if(visible(a)&&visible(b))pieces.push(`<path d="M${number(a.x)} ${number(a.y)}L${number(b.x)} ${number(b.y)}" stroke="${stroke}" opacity="${number(opacity)}"/>`);};
    pieces.push('<g fill="none" stroke-width="1" stroke-linecap="round">');
    const projected=Array.from({length:surface.positions.length/3},(_,i)=>project(surface.positions.subarray(i*3,i*3+3)));
    if(state.style!=='dots')for(const rim of [false,true])for(const edge of model.edges)if(Boolean(edge.rim)===rim)segment(projected[edge.a],projected[edge.b],p.primary,rim?surface.rimOpacity:surface.meshOpacity);
    pieces.push('</g>');
    if(state.style!=='filaments')for(const index of model.dotIndices){const q=projected[index];if(!visible(q))continue;const radius=clamp(state.dotSize*18/Math.max(2,q.d),1,30)*scale*.5;pieces.push(`<circle cx="${number(q.x)}" cy="${number(q.y)}" r="${number(radius)}" fill="${p.primary}" opacity="${number(surface.dotOpacity)}"/>`);}
    pieces.push('</g></svg>');download(new Blob(pieces,{type:'image/svg+xml'}),'svg');toast('Editable SVG exported.');return;
  }
  if(state.style!=='dots'){
    pieces.push(`<g fill="none" stroke-width="${number(scale)}" stroke-linecap="round">`);
    for(const {edge,samples} of paths){
      const a=model.points[edge.a],b=model.points[edge.b];
      const projected=samples.map((pos,j)=>{const t=j/(samples.length-1),origin=origins[edge.a].map((v,i)=>v+(origins[edge.b][i]-v)*t);return project(movingPosition(pos,origin,a.g+(b.g-a.g)*t,a.variation+(b.variation-a.variation)*t,frame));});
      for(let j=1;j<projected.length;j++){const fraction=(j-.5)/(samples.length-1),pulse=pulseAt(edge.g,b.variation,fraction,frame),alpha=traceAlpha(edge.g,b.variation,fraction,frame)*state.lineOpacity/100*(1+pulse*.5);if(alpha<.001)continue;const q=projected[j-1],r=projected[j];if(q.z<-1||q.z>1||r.z<-1||r.z>1)continue;pieces.push(`<path d="M${number(q.x)} ${number(q.y)}L${number(r.x)} ${number(r.y)}" stroke="${color(pulse*.28)}" opacity="${number(Math.min(1,alpha))}"/>`);}
    }pieces.push('</g>');
  }
  if(state.style!=='filaments'){
    const dots=model.points.map((point,i)=>{const timing=pointTiming(point.g,point.variation,frame),pulse=pulseAt(point.g,point.variation,1,frame);return{...project(movingPosition(point.pos,origins[i],point.g,point.variation,frame)),tone:(point.variation>.91?.8:0)+pulse*.28,alpha:timing.alpha*(1+pulse*.5),size:1+timing.pop*.6*frame.energy+pulse*.16};}).filter(q=>q.alpha>.001&&q.z>-1&&q.z<1).sort((a,b)=>b.z-a.z);
    for(const q of dots){const radius=clamp(state.dotSize*18/Math.max(2,q.d),1,30)*scale*.5*q.size;pieces.push(`<circle cx="${number(q.x)}" cy="${number(q.y)}" r="${number(radius)}" fill="${color(q.tone)}" opacity="${number(Math.min(1,q.alpha))}"/>`);}
  }
  pieces.push('</g></svg>');download(new Blob(pieces,{type:'image/svg+xml'}),'svg');toast('Editable SVG exported.');
}
