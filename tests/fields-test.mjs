// Pure model, animation and scene-adapter invariants for the approved filament fields.
// Run: node --test tests/fields-test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as THREE from '../vendor/three.module.min.js';
import { defaults, sanitize, buildModel } from '../model.mjs';
import { FIELD_FORMS, isField, buildFieldModel, pointOnTrace, createFieldPose, updateFieldPose } from '../fields.mjs';
import { createFieldArtwork } from '../fields-scene.mjs';
import { filamentFade } from '../finish.mjs';
import { timelineAt } from '../motion.mjs';

const forms = ['radial', 'shell', 'bifurcation'];
const modes = ['cascade', 'unfurl', 'pulse'];
const counts = {radial:560, shell:620, bifurcation:720};
const arrayFields = ['linePositions', 'lineAlpha', 'dotPositions', 'dotAlpha', 'dotRadius'];
const settings = overrides => sanitize({...defaults, ...overrides});
const close = (a, b, label, tolerance=1e-6) => assert(Math.abs(a-b) <= tolerance, `${label}: ${a} != ${b}`);
const positionClose = (actual, expected, label, tolerance=1e-6) => expected.forEach((n, k) => close(actual[k], n, `${label}[${k}]`, tolerance));
const boundsOf = points => {
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const p of points)for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
  return {min,max};
};
const inBounds = (position, bounds, label) => position.forEach((coordinate,k) => {
  assert(Number.isFinite(coordinate), `${label}: nonfinite coordinate`);
  assert(coordinate >= bounds.min[k]-1e-6 && coordinate <= bounds.max[k]+1e-6, `${label}: coordinate ${coordinate} outside axis ${k}`);
});
const assertPoseEqual = (actual, expected, label) => {
  for(const key of arrayFields)assert.deepEqual(actual[key], expected[key], `${label}: ${key}`);
  assert.equal(actual.activeTraces, expected.activeTraces, `${label}: active traces`);
  assert.equal(actual.activeMarks, expected.activeMarks, `${label}: active marks`);
  assert.equal(actual.growth, expected.growth, `${label}: growth`);
};

test('field forms and density survive the production sanitizer and model dispatcher', () => {
  assert.deepEqual(FIELD_FORMS, forms);
  for(const form of forms){
    assert.equal(isField(form), true);
    const s=settings({form});
    assert.equal(s.form, form);assert.equal(s.density, 100);
    assert.deepEqual(buildModel(s), buildFieldModel(s));
  }
  assert.equal(isField('cascading'), false);
  assert.equal(sanitize({density:NaN}).density,100);
  assert.equal(sanitize({density:Infinity}).density,100);
  assert.equal(sanitize({density:-5}).density,35);
  assert.equal(sanitize({density:500}).density,180);
  assert.equal(sanitize({form:'unknown'}).form, defaults.form);
});

test('a seed reproduces every path and mark; a different seed varies the field', () => {
  for(const form of forms){
    const s=settings({form, seed:147, density:35}),a=buildModel(s),b=buildModel({...s});
    assert.deepEqual(a,b,`${form}: deterministic construction`);
    const other=buildModel({...s,seed:148});
    assert.notDeepEqual(a.traces[0].points, other.traces[0].points, `${form}: seed changes geometry`);
    assert.notEqual(a.traces[0].variation,other.traces[0].variation,`${form}: seed changes pulse variation`);
    assert.deepEqual(a.source,other.source,`${form}: source remains shared`);
  }
});

test('density controls population without changing established paths or source', () => {
  for(const form of forms){
    const low=buildModel(settings({form,density:35})),high=buildModel(settings({form,density:180}));
    assert.equal(low.traces.length,Math.round(counts[form]*.35));
    assert.equal(high.traces.length,Math.round(counts[form]*1.8));
    assert.deepEqual(low.source,high.source);
    for(const i of [0,1,low.traces.length-1]){
      assert.deepEqual(low.traces[i].points,high.traces[i].points,`${form}: path ${i} remains stable`);
      assert.deepEqual(low.traces[i].marks,high.traces[i].marks,`${form}: marks ${i} remain stable`);
    }
    for(const model of [low,high]){
      assert.equal(model.markCount,model.traces.length*5+1);
      assert.equal(model.segmentCount,model.traces.reduce((n,t)=>n+t.points.length-1,0));
    }
  }
});

test('trace interpolation clamps its ends and follows individual segments', () => {
  const points=[[0,1,2],[2,3,6],[6,7,10]];
  assert.deepEqual(pointOnTrace(points,-2),points[0]);
  assert.deepEqual(pointOnTrace(points,0),points[0]);
  assert.deepEqual(pointOnTrace(points,.25),[1,2,4]);
  assert.deepEqual(pointOnTrace(points,.5),points[1]);
  assert.deepEqual(pointOnTrace(points,.75),[4,5,8]);
  assert.deepEqual(pointOnTrace(points,1),points[2]);
  assert.deepEqual(pointOnTrace(points,3),points[2]);
});

test('radial subdivision preserves the approved bend and exact marker positions under twist', () => {
  const model=buildModel(settings({form:'radial',seed:147,density:35,twist:143,depth:89,spread:83}));
  const tr=model.traces[7];
  // Captured from the original two-segment study before subdivision.
  const original=[[0,0,0],[-.8163048980021593,1.5030566280723234,.15016281504792423],[-1.6326097960043187,1.9347968679220822,-2.49070907692413]];
  const marks=[[-1.6326097960043187,1.9347968679220822,-2.49070907692413],[-1.352531908553785,1.7866648469083026,-1.584614035302721],[-.6930938942664406,1.2761890492183179,.12749761824325323],[-1.1112637938464207,1.6590591520670828,-.8040745774124625]];
  assert.equal(tr.points.length,33);assert.equal(model.segmentCount,model.traces.length*32);
  for(let i=0;i<=32;i++)positionClose(tr.points[i],pointOnTrace(original,i/32),`subdivided point ${i}`,1e-12);
  assert.deepEqual(tr.marks.map(mark=>mark.pos),marks);
});

test('all field marks use one circular-dot contract', () => {
  for(const form of forms){
    const model=buildModel(settings({form,density:35})),pose=createFieldPose(model);
    assert.equal(Object.hasOwn(pose,'dotSquare'),false);
    for(const tr of model.traces)for(const mark of tr.marks)assert.equal(Object.hasOwn(mark,'square'),false);
  }
});

test('every motion starts with only the source visible', () => {
  for(const form of forms)for(const motion of modes)for(const stagger of [0,50,100]){
    const s=settings({form,motion,stagger,density:35,energy:100}),model=buildModel(s);
    const pose=updateFieldPose(model,s,timelineAt(0,s));
    assert.equal(pose.activeTraces,0);assert.equal(pose.activeMarks,1);
    assert(pose.lineAlpha.every(n=>n===0),`${form}/${motion}: invisible seed lines`);
    assert(pose.dotAlpha.slice(1).every(n=>n===0),`${form}/${motion}: invisible unborn marks`);
    positionClose(pose.dotPositions.slice(0,3),model.source,`${form}: source position`);
  }
});

test('every path and endpoint is complete by Hold, even at maximum density and stagger', () => {
  for(const form of forms)for(const motion of modes)for(const stagger of [0,50,100]){
    const s=settings({form,motion,stagger,density:180,energy:100}),model=buildModel(s);
    for(const progress of [.831,1]){
      const frame=timelineAt(progress,s),pose=updateFieldPose(model,s,frame);
      assert.equal(frame.phase,'Hold');assert.equal(pose.activeTraces,model.traces.length);
      let segment=0,dot=1;
      for(const [i,tr] of model.traces.entries()){
        for(let j=1;j<tr.points.length;j++,segment++){
          positionClose(pose.linePositions.slice(segment*6,segment*6+3),tr.points[j-1],`${form}: start ${i}/${j}`);
          positionClose(pose.linePositions.slice(segment*6+3,segment*6+6),tr.points[j],`${form}: end ${i}/${j}`);
          assert(pose.lineAlpha[segment*2]>0,`${form}/${motion}/${stagger}: completed segment visible`);
        }
        for(const mark of tr.marks){
          positionClose(pose.dotPositions.slice(dot*3,dot*3+3),mark.pos,`${form}: settled mark`);
          close(pose.dotAlpha[dot],mark.alpha,`${form}/${motion}/${stagger}: endpoint reaches full opacity`);dot++;
        }
        assert.equal(pose.dotAlpha[dot],0,'traveling tip disappears on arrival');dot++;
      }
    }
  }
});

test('random scrubbing and pose reuse match a fresh export frame exactly', () => {
  for(const form of forms)for(const motion of modes){
    const s=settings({form,motion,density:35,stagger:100,energy:100,loop:true}),model=buildModel(s),reused=createFieldPose(model);
    for(const progress of [1,.18,.83,.45,0,.61,.45,.17,.94,.45]){
      const frame=timelineAt(progress,s);
      updateFieldPose(model,s,frame,reused);
      assertPoseEqual(reused,updateFieldPose(model,s,frame),`${form}/${motion}/${progress}`);
    }
  }
});

test('loop seams match in positions, alpha, dot radius and counts', () => {
  for(const form of forms)for(const motion of modes)for(const duration of [6,7.5,12,24]){
    const s=settings({form,motion,duration,loop:true,turntable:true,density:35,stagger:100,energy:100}),model=buildModel(s);
    const first=timelineAt(0,s),last=timelineAt(1,s);
    assertPoseEqual(updateFieldPose(model,s,first),updateFieldPose(model,s,last),`${form}/${motion}/${duration}`);
    close(Math.sin(first.turn),Math.sin(last.turn),'loop camera yaw closes');
    close(Math.cos(first.turn),Math.cos(last.turn),'loop camera yaw closes');
  }
});

test('filament finishes preserve geometry and dots while fading both endpoints independently', () => {
  for(const form of forms){
    const base=settings({form,density:35,motion:'pulse',energy:100,stagger:50,filamentFinish:'off'}),model=buildModel(base);
    for(const progress of [.1,.47,1]){
      const frame=timelineAt(progress,base),original=updateFieldPose(model,base,frame);
      for(const filamentFinish of ['silk','veil']){
        const state={...base,filamentFinish,fadeStrength:100},pose=updateFieldPose(model,state,frame);
        for(const key of ['linePositions','dotPositions','dotAlpha','dotRadius'])assert.deepEqual(pose[key],original[key],`${form}/${filamentFinish}: ${key} unchanged`);
        assert.equal(pose.activeTraces,original.activeTraces);assert.equal(pose.activeMarks,original.activeMarks);
        assert(pose.lineAlpha.every((n,i)=>n>=0&&n<=original.lineAlpha[i]+1e-7));
        assert(pose.lineAlpha.some((n,i)=>n<original.lineAlpha[i]-1e-5),`${form}/${filamentFinish}: visible fade`);
        assert(pose.lineAlpha.some((n,i)=>i%2===0&&Math.abs(n-pose.lineAlpha[i+1])>1e-6),`${form}/${filamentFinish}: endpoint gradients`);
        assertPoseEqual(updateFieldPose(model,{...state,fadeStrength:0},frame),original,`${form}/${filamentFinish}: zero strength is identity`);
      }
    }
  }
});

test('a growing segment evaluates its fade at the actual moving tip', () => {
  for(const form of forms){
    const base=settings({form,density:35,motion:'pulse',filamentFinish:'off'}),model=buildModel(base);
    const frame={growth:.1,energy:0,stagger:.5,mode:2,pulse:0},original=updateFieldPose(model,base,frame);
    const tr=model.traces[0],steps=tr.points.length-1;
    const active=Array.from({length:steps},(_,i)=>i).filter(i=>original.lineAlpha[i*2]>0),i=active.at(-1);
    assert.notEqual(i,undefined);
    const a=tr.points[i],b=tr.points[i+1],tip=Array.from(original.linePositions.slice(i*6+3,i*6+6));
    const axis=[0,1,2].sort((k,l)=>Math.abs(b[l]-a[l])-Math.abs(b[k]-a[k]))[0];
    const fraction=(tip[axis]-a[axis])/(b[axis]-a[axis]),end=(i+fraction)/steps;
    assert(fraction>0&&fraction<1,`${form}: partially drawn terminal segment`);
    for(const filamentFinish of ['silk','veil']){
      const state={...base,filamentFinish,fadeStrength:100},pose=updateFieldPose(model,state,frame);
      close(pose.lineAlpha[i*2],original.lineAlpha[i*2]*filamentFade(i/steps,tr.variation,state),`${form}/${filamentFinish}: start fade`);
      close(pose.lineAlpha[i*2+1],original.lineAlpha[i*2+1]*filamentFade(end,tr.variation,state),`${form}/${filamentFinish}: moving tip fade`);
    }
  }
});

test('finished fields scrub reversibly and share the same pose with scene and export', () => {
  for(const form of forms)for(const filamentFinish of ['silk','veil']){
    const state=settings({form,density:35,motion:'pulse',filamentFinish,fadeStrength:83,loop:true,energy:100,stagger:100}),model=buildModel(state);
    const art=createFieldArtwork(THREE,model,state,{primary:'#5AEB41'}),reused=createFieldPose(model);
    for(const progress of [0,.18,.5,.76,.99,.5,.31,.76,1]){
      const frame=timelineAt(progress,state),fresh=updateFieldPose(model,state,frame);
      updateFieldPose(model,state,frame,reused);art.update(frame);
      assertPoseEqual(reused,fresh,`${form}/${filamentFinish}/${progress}: scrub/export parity`);
      assertPoseEqual(art.snapshot(),fresh,`${form}/${filamentFinish}/${progress}: scene/export parity`);
    }
    assertPoseEqual(updateFieldPose(model,state,timelineAt(0,state)),updateFieldPose(model,state,timelineAt(1,state)),`${form}/${filamentFinish}: loop seam`);
    for(const object of art.group.children){object.geometry.dispose();object.material.dispose();}
  }
});

test('all pose buffers remain finite, alpha-bounded and inside framing bounds at extremes', () => {
  const extremes=[{density:35,spread:10,depth:0,twist:-180,seed:1,lineOpacity:5,dotSize:1},
    {density:180,spread:100,depth:100,twist:180,seed:999999,lineOpacity:90,dotSize:7}];
  for(const form of forms)for(const options of extremes){
    const s=settings({form,...options,energy:100,stagger:100}),model=buildModel(s),bounds=boundsOf(model.framingPoints),pose=createFieldPose(model);
    assert.equal(model.framingPoints.length,8);
    for(const tr of model.traces){
      for(const p of tr.points)inBounds(p,bounds,`${form}: path`);
      for(const mark of tr.marks)inBounds(mark.pos,bounds,`${form}: mark`);
    }
    for(const motion of modes)for(const progress of [0,.08,.3,.6,.83,1]){
      const state={...s,motion};updateFieldPose(model,state,timelineAt(progress,state),pose);
      for(const key of arrayFields)assert(pose[key].every(Number.isFinite),`${form}/${motion}/${progress}: ${key} is finite`);
      for(const key of ['lineAlpha','dotAlpha'])assert(pose[key].every(n=>n>=0&&n<=1),`${form}: ${key} in [0,1]`);
      for(const key of ['linePositions','dotPositions'])for(let i=0;i<pose[key].length;i+=3)inBounds(pose[key].slice(i,i+3),bounds,`${form}: ${key}`);
    }
  }
});

test('scene styles, palette and export pixel ratio update the shared pose without rebuilding geometry', () => {
  for(const form of forms){
    const state=settings({form,density:35}),model=buildModel(state),art=createFieldArtwork(THREE,model,state,{primary:'#5AEB41'},1);
    const lines=art.group.getObjectByName('lines'),dots=art.group.getObjectByName('dots');
    const lineGeometry=lines.geometry,dotGeometry=dots.geometry;
    const frame=timelineAt(.47,state);art.update(frame);
    assertPoseEqual(art.snapshot(),updateFieldPose(model,state,frame),`${form}: scene/export parity`);
    assert.equal(lines.geometry.getAttribute('aStart').data.array,art.snapshot().linePositions);
    assert.equal(lines.geometry.getAttribute('aEnd').data.array,art.snapshot().linePositions);
    const alphaStart=lines.geometry.getAttribute('aAlphaStart'),alphaEnd=lines.geometry.getAttribute('aAlphaEnd');
    assert.equal(alphaStart.data.array,art.snapshot().lineAlpha);assert.equal(alphaEnd.data.array,art.snapshot().lineAlpha);
    assert.equal(alphaStart.offset,0);assert.equal(alphaEnd.offset,1);
    assert.equal(dots.geometry.getAttribute('position').array,art.snapshot().dotPositions);
    assert.equal(dots.geometry.getAttribute('aSquare'),undefined);
    for(const style of ['connected','dots','filaments']){
      const next={...state,style,dotSize:7};art.setStyle(next);
      assert.equal(lines.visible,style!=='dots');assert.equal(dots.visible,style!=='filaments');
      assert.equal(lines.geometry,lineGeometry);assert.equal(dots.geometry,dotGeometry);
      close(dots.material.uniforms.uSize.value,7/3,`${form}: dot-size update`);
      assertPoseEqual(art.snapshot(),updateFieldPose(model,next,frame),`${form}: restyled export parity`);
    }
    for(const filamentFinish of ['silk','veil','off']){
      const next={...state,filamentFinish,fadeStrength:100};art.setStyle(next);
      assert.equal(lines.geometry,lineGeometry);assert.equal(dots.geometry,dotGeometry);
      assertPoseEqual(art.snapshot(),updateFieldPose(model,next,frame),`${form}/${filamentFinish}: finish/export parity`);
      for(let i=0;i<model.segmentCount;i++){
        assert.equal(alphaStart.getX(i),art.snapshot().lineAlpha[i*2]);
        assert.equal(alphaEnd.getX(i),art.snapshot().lineAlpha[i*2+1]);
      }
    }
    art.setPalette({primary:'#1F41FF'});assert.equal(lines.material.uniforms.uColor.value.getHexString(),'1f41ff');assert.equal(dots.material.uniforms.uColor.value.getHexString(),'1f41ff');
    art.setPixelRatio(2);assert.equal(dots.material.uniforms.uPixelRatio.value,2);assert.equal(lines.material.uniforms.uPixelRatio.value,2);
    for(const object of [lines,dots]){object.geometry.dispose();object.material.dispose();}
  }
});

test('production camera fit contains full curves through all three views and turntable angles', () => {
  const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const begin=source.indexOf('function resetView('),end=source.indexOf('\nfunction disposeGroup(',begin);
  assert(begin>=0&&end>begin,'production resetView is available');
  const reset=new Function('THREE','art','model','state','camera','controls','pivot','$$','view','matchMedia',`let dirty=false;\n${source.slice(begin,end)}\nresetView(view);`);
  const axis=new THREE.Vector3(0,1,0);
  for(const form of forms)for(const aspect of [.55,2.3])for(const view of ['perspective','front','top']){
    const state=settings({form,density:35,spread:100,depth:100,twist:180,seed:999999,turntable:true}),model=buildModel(state);
    const points=model.traces.flatMap(tr=>tr.points.map(p=>new THREE.Vector3(...p)));
    const pivot=new THREE.Box3().setFromPoints(model.points.map(p=>new THREE.Vector3(...p.pos))).getCenter(new THREE.Vector3());
    const art=new THREE.Group();art.rotation.y=.7;art.position.copy(pivot).sub(pivot.clone().applyAxisAngle(axis,.7));
    const camera=new THREE.PerspectiveCamera(36,aspect,.1,200);
    const controls={target:new THREE.Vector3(),minDistance:3,maxDistance:65,update(){
      const delta=camera.position.clone().sub(this.target);delta.setLength(THREE.MathUtils.clamp(delta.length(),this.minDistance,this.maxDistance));
      camera.position.copy(this.target).add(delta);camera.lookAt(this.target);camera.updateMatrixWorld();
    }};
    const compact=aspect<1;reset(THREE,art,model,state,camera,controls,pivot,()=>[],view,()=>({matches:compact}));
    for(let step=0;step<48;step++)for(const point of points){
      const projected=point.clone().sub(pivot).applyAxisAngle(axis,step*Math.PI/24).add(pivot).project(camera);
      assert(projected.toArray().every(Number.isFinite));
      assert(Math.abs(projected.x)<1&&Math.abs(projected.y)<1&&projected.z>-1&&projected.z<1,`${form}/${view}/${aspect}: curve clips at yaw ${step}`);
      if(compact)assert(projected.y<.4,`${form}/${view}: mobile title reserve`);
    }
  }
});
