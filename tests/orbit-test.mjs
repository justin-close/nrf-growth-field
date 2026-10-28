import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.min.js';
import {sanitize,buildModel} from '../model.mjs';
import {timelineAt,pointTiming,movingPosition,traceAlpha,pulseAt} from '../motion.mjs';
import {updateFieldPose} from '../fields.mjs';
import {updateCascadingModel} from '../cascading.mjs';

const forms=['ascent','multiply','network','cascading','radial','shell','bifurcation'];
test('orbit sequence survives saves and ignores retained growth-loop options',()=>{
  assert.equal(sanitize({}).sequence,'growth');
  assert.equal(sanitize({sequence:'invalid'}).sequence,'growth');
  const state=sanitize({sequence:'orbit',loop:true,turntable:false,energy:100,stagger:100});
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(state))),state);
  for(const p of [0,.1,.25,.5,.75,.999,1]){
    const frame=timelineAt(p,state);
    assert.equal(frame.growth,1);assert.equal(frame.energy,0);assert.equal(frame.stagger,0);
    assert.equal(frame.phase,'Orbit loop');assert.equal(frame.turn,p*2*Math.PI);
  }
});

test('orbit keeps every system fully grown with fixed geometry, opacity and dot size',()=>{
  for(const form of forms){
    const state=sanitize({form,sequence:'orbit',energy:100,stagger:100,loop:true,turntable:false,density:35,filamentFinish:'veil',fadeStrength:85});
    const model=buildModel(state),first=timelineAt(0,state);
    for(const p of [.1,.25,.5,.75,1]){
      const frame=timelineAt(p,state);
      if(model.kind==='field'){
        const a=updateFieldPose(model,state,first),b=updateFieldPose(model,state,frame);
        for(const key of ['linePositions','lineAlpha','dotPositions','dotAlpha','dotRadius'])assert.deepEqual(a[key],b[key],`${form} ${key}`);
        assert.equal(b.activeTraces,model.traces.length);
      }else if(model.kind==='cascading'){
        const a=Float32Array.from(updateCascadingModel(model,state,first.growth).positions);
        assert.deepEqual(updateCascadingModel(model,state,frame.growth).positions,a);
      }else for(const point of model.points){
        const timing=pointTiming(point.g,point.variation,frame);
        assert.equal(timing.amount,1);assert.equal(timing.alpha,1);assert.equal(timing.pop,0);
        const position=movingPosition(point.pos,[0,0,0],point.g,point.variation,frame);
        position.forEach((v,i)=>assert(Math.abs(v-point.pos[i])<1e-10));
        assert.equal(traceAlpha(point.g,point.variation,1,frame),1);
        assert.equal(pulseAt(point.g,point.variation,.5,frame),0);
      }
    }
  }
});

test('turntable advances at constant speed through the loop seam around its center',()=>{
  const state=sanitize({sequence:'orbit',duration:6});
  const pivot=new THREE.Vector3(1,-2,.5),point=new THREE.Vector3(4,1,2),axis=new THREE.Vector3(0,1,0);
  const at=p=>point.clone().sub(pivot).applyAxisAngle(axis,timelineAt(p,state).turn).add(pivot);
  const frames=180,step=1/frames,first=at(0),last=at((frames-1)/frames),second=at(step);
  assert(Math.abs(first.distanceTo(last)-first.distanceTo(second))<1e-10);
  assert(at(1).distanceTo(first)<1e-10);
  const before=at(1-step).sub(first),after=second.clone().sub(first);
  assert(Math.abs(before.length()-after.length())<1e-10);
});
