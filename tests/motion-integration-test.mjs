import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitize,defaults,buildModel} from '../model.mjs';
import {sanitizeMotion,timelineAt,retimeDuration,cubicBezier,pointTiming,movingPosition,driftScale} from '../motion.mjs';
import {frameForWorkspace,switchWorkspace,exportContext} from '../workspace.mjs';
import {planSprouts,updateSproutPose} from '../sprouts.mjs';
import {createFieldPose,updateFieldPose} from '../fields.mjs';
import {updateCascadingModel} from '../cascading.mjs';
import {createDofUniforms,dofCoc,dotFade,dotShapeGLSL} from '../dof.mjs';
const near=(a,b,tol=1e-6)=>assert(Math.abs(a-b)<tol,`${a} != ${b}`);
const effects={burst:true,drift:true,driftAmount:35,sprouts:true,camMove:true,zoomFrom:220,zoomTo:85,rotMove:true,rotFrom:-90,rotTo:360,spreadMove:true,dofMove:true,dofFrom:60,dofTo:0,extMove:true,extFrom:4};

test('fresh studies open Still; legacy motion studies restore in Motion without losing phases',()=>{
  assert.equal(defaults.workspace,'still');
  for(const state of [{sequence:'orbit'},{progress:.4},{loop:true},{turntable:true}])assert.equal(sanitize(state).workspace,'motion');
  const legacy=sanitize({loop:true,duration:18});assert.equal(legacy.deconstruct,true);
  near(legacy.buildStart/18,.06);near(legacy.deconEnd/18,.94);
  const explicit=sanitize({...effects,workspace:'still',progress:.4,sequence:'growth'});
  assert.equal(explicit.workspace,'still');assert.deepEqual(sanitize(JSON.parse(JSON.stringify(explicit))),explicit);
});

test('Still freezes fully grown geometry and switching preserves composition and motion playhead',()=>{
  const motion=sanitize({...effects,workspace:'motion',form:'network',progress:.37,rate:2.6,palette:6});
  const still=switchWorkspace(motion,'still'),a=frameForWorkspace(0,still),b=frameForWorkspace(.9,still);
  assert.deepEqual(a,b);assert.equal(a.growth,1);assert.equal(a.turn,0);assert.equal(a.zoom,1);assert.equal(a.energy,0);assert.equal(a.drift,null);assert.equal(a.spreadMix,1);
  assert.deepEqual(switchWorkspace(still,'motion'),motion);
  assert.equal(still.progress,.37);assert.equal(exportContext(still).tab,'still');assert.equal(exportContext(motion).tab,'video');
  assert.match(exportContext(motion).description,/4.44 s/);
});

test('invalid and inverted effect times resolve to finite ordered spans',()=>{
  const s=sanitize({duration:3,buildStart:40,buildEnd:-1,deconStart:NaN,deconEnd:999,rotStart:9,rotEnd:1,zoomStart:Infinity,sproutStart:2,sproutEnd:1});
  for(const pair of [['buildStart','buildEnd'],['deconStart','deconEnd'],['rotStart','rotEnd'],['sproutStart','sproutEnd']])assert(s[pair[0]]>=0&&s[pair[1]]<=3&&s[pair[0]]<=s[pair[1]]);
  for(const p of [0,.5,1])assert(Number.isFinite(timelineAt(p,s).clock));
  const first=sanitizeMotion();first.buildBezier[0]=.99;assert.equal(sanitizeMotion().buildBezier[0],.42);
});

test('duration edits retime independent effects without changing evaluated poses',()=>{
  const a=sanitize({...effects,workspace:'motion',duration:12,rotStart:2,rotEnd:10,zoomSync:false,zoomStart:3,zoomEnd:9,extStart:8,extEnd:11}),b=retimeDuration(structuredClone(a),30);
  for(const p of [0,.1,.3,.7,1]){const x=timelineAt(p,a),y=timelineAt(p,b);for(const k of ['growth','turn','zoom','spreadMix','dofBlur'])near(x[k],y[k]);}
  assert.equal(b.rotStart,5);assert.equal(b.rotEnd,25);assert.equal(b.extEnd,27.5);
});

test('custom easing is stable, bounded and reversible under scrubbing',()=>{
  const s=sanitize({buildCurve:'custom',buildBezier:[-.5,2,3,-1],deconCurve:'custom',deconBezier:[.8,.1,.2,.9],deconstruct:true,buildStart:1,buildEnd:5,deconStart:8,deconEnd:11});
  const ease=cubicBezier(s.buildBezier);assert.equal(ease(0),0);assert.equal(ease(1),1);
  let previous=-1;for(let i=0;i<=100;i++){const v=ease(i/100);assert(v>=0&&v<=1&&v>=previous-1e-8);previous=v;}
  for(const p of [.8,.4,1,0,.4])assert.deepEqual(timelineAt(p,s),timelineAt(p,JSON.parse(JSON.stringify(s))));
  near(timelineAt(1/12,s).growth,0);near(timelineAt(5/12,s).growth,1);near(timelineAt(11/12,s).growth,0);
});

test('seamless orbit overrides every growth effect and completes exactly one revolution',()=>{
  const s=sanitize({...effects,workspace:'motion',sequence:'orbit',dof:true,loop:true});
  const first=timelineAt(0,s),last=timelineAt(1,s);
  for(const p of [0,.3,.9,1]){const f=timelineAt(p,s);assert.equal(f.growth,1);assert.equal(f.drift,null);assert.equal(f.ext,null);assert.equal(f.zoom,1);assert.equal(f.spreadMix,1);assert.equal(f.dofBlur,null);assert.equal(f.energy,0);}
  near(Math.cos(first.turn),Math.cos(last.turn));near(last.turn,2*Math.PI);
});

test('burst, drift and continued generations use deterministic finite geometry',()=>{
  const s=sanitize({...effects,form:'multiply',energy:100,stagger:100,extStart:8,extEnd:11}),model=buildModel(s);
  for(const progress of [.5,0,.8,1,.5])for(const point of model.points){const f=timelineAt(progress,s),pos=movingPosition(point.pos,[0,0,0],point.g,point.variation,f);assert(pos.every(Number.isFinite));assert(driftScale(point.variation,f)>=1);}
  const frame=timelineAt(1,s);for(const point of model.points)near(pointTiming(point.g,point.variation,frame).amount,1);
  const mid=timelineAt(.6,s);assert(mid.ext.amount===0);assert(pointTiming(8,.5,mid).alpha===0);
});

test('new field effects keep CPU scene and export pose deterministic at arbitrary scrub positions',()=>{
  for(const form of ['radial','shell','bifurcation']){
    const s=sanitize({...effects,form,density:35}),model=buildModel(s),reused=createFieldPose(model);
    for(const p of [.9,.1,1,0,.3]){
      const f=timelineAt(p,s),a=updateFieldPose(model,s,f,reused),b=updateFieldPose(model,s,f);
      for(const key of ['linePositions','dotPositions','lineAlpha','dotAlpha'])assert.deepEqual(a[key],b[key]);
    }
  }
  const s=sanitize({...effects,form:'cascading'}),model=buildModel(s);
  for(const p of [.8,.1,1,0,.8]){const f=timelineAt(p,s),a=Float32Array.from(updateCascadingModel(model,s,f.growth,!!f.exact,!!f.burst,f.drift).positions);assert.deepEqual(a,updateCascadingModel(model,s,f.growth,!!f.exact,!!f.burst,f.drift).positions);}
});

test('branching filaments finish inside their window, scrub deterministically and clear cleanly',()=>{
  const s=sanitize({sprouts:true,sproutCount:200,sproutBranch:90,sproutStart:1,sproutEnd:4,buildStart:0,buildEnd:2,deconstruct:true,deconStart:8,deconEnd:11});
  const anchors={count:3,origin:[0,0,0],rest:i=>[i+1,0,0],slice:()=>()=>1};
  const plan=planSprouts(s,anchors,p=>timelineAt(p,s),5);
  assert.equal(plan.sprouts.length,200);assert(plan.sprouts.some(s=>s.parent>=0));
  for(const branch of plan.sprouts)assert(branch.birth+branch.grow<=4/12+1e-8);
  assert.deepEqual(plan,planSprouts(s,anchors,p=>timelineAt(p,s),5));
  const live=i=>({pos:anchors.rest(i),alpha:1}),reused=createFieldPose(plan);
  for(const p of [1,.3,.8,0,.3]){
    const f=timelineAt(p,s),a=updateSproutPose(plan,f,live,reused),b=updateSproutPose(plan,f,live,createFieldPose(plan));
    assert.deepEqual(a,b);
    if(p===1)assert(a.dotAlpha.every(a=>a===0));
  }
});

test('depth softness retains circular marks and finite opacity at every depth',()=>{
  assert.doesNotMatch(dotShapeGLSL,/uSquare|max\(c.x/);assert.match(dotShapeGLSL,/length/);
  const u=createDofUniforms();assert.equal(dofCoc(0,u),0);u.uDofOn.value=1;u.uAperture.value=45;
  for(const depth of [.001,1,10,100]){const coc=dofCoc(depth,u);assert(Number.isFinite(coc)&&coc>=0&&coc<=48);const alpha=dotFade(1,1+coc);assert(alpha>=.1&&alpha<=1);}
});
