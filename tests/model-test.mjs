import assert from 'node:assert/strict';
import {buildModel,defaults,sanitize,MAX_PER_GENERATION,edgeSamples} from '../model.mjs';
for(const form of ['ascent','multiply','network']){
  for(const settings of [defaults,{...defaults,rate:1.3,generations:3,depth:0},{...defaults,rate:3,generations:10,spread:100,depth:100,twist:180}]){
    const model=buildModel({...settings,form});
    assert.equal(model.levels.length,settings.generations+1);
    model.levels.forEach((level,g)=>assert.equal(level.length,Math.min(MAX_PER_GENERATION,Math.round(settings.rate**g))));
    assert.equal(model.finalCount,Math.round(settings.rate**settings.generations));
    assert(model.points.every(p=>p.pos.every(Number.isFinite)));
    assert(model.edges.every(e=>e.a!==e.b&&model.points[e.a]&&model.points[e.b]&&e.g===Math.max(model.points[e.a].g,model.points[e.b].g)));
    const unique=new Set(model.edges.map(e=>[e.a,e.b].sort((a,b)=>a-b).join(':')));assert.equal(unique.size,model.edges.length);
    const last=model.edges.at(-1),samples=edgeSamples(model,last,form);assert(samples.flat().every(Number.isFinite));
    assert.deepEqual(samples[0],model.points[last.a].pos);
    const end=samples.at(-1);model.points[last.b].pos.forEach((v,i)=>assert(Math.abs(v-end[i])<1e-9));
    if(settings.rate===3)assert(model.sampled);
    console.log(`${form}: factor ${settings.rate}, ${settings.generations} generations → ${model.points.length} points / ${model.edges.length} edges`);
  }
  assert.deepEqual(buildModel({...defaults,form}),buildModel({...defaults,form}));
  assert.notDeepEqual(buildModel({...defaults,form}).points,buildModel({...defaults,form,seed:2}).points);
}
assert.deepEqual(sanitize({rate:NaN,depth:Infinity,form:'bad',grid:'false'}),defaults);
assert.equal(sanitize({rate:99,generations:20,progress:-1}).rate,3);
assert.equal(sanitize({generations:20}).generations,10);
for(const form of ['helix','bloom','canopy']){
  const study=sanitize({form,rate:2.6,palette:3,motion:'pulse',duration:18,loop:true,turntable:true});
  assert.equal(study.form,'ascent','Removed systems gracefully restore to Exponential growth');
  assert.deepEqual([study.rate,study.palette,study.motion,study.duration,study.loop,study.turntable],[2.6,3,'pulse',18,true,true]);
  assert.deepEqual(buildModel(study),buildModel({...study,form:'ascent'}));
}
// New surface controls survive the same JSON + sanitize boundaries used by
// saved studies and shared links, including changes away from the surface.
const surfaceStudy=sanitize({form:'cascading',folds:17,foldAmplitude:1.35,palette:2,progress:.42,duration:18,loop:true,turntable:true});
assert.equal(surfaceStudy.form,'cascading');
assert.deepEqual([surfaceStudy.folds,surfaceStudy.foldAmplitude],[17,1.35]);
assert.equal(buildModel(surfaceStudy).kind,'cascading');
const savedPayload=JSON.parse(JSON.stringify({state:surfaceStudy,saved:[{state:surfaceStudy}]}));
assert.deepEqual(sanitize(savedPayload.state),surfaceStudy);
assert.deepEqual(sanitize(savedPayload.saved[0].state),surfaceStudy);
const sharedHash=encodeURIComponent(Buffer.from(JSON.stringify({state:surfaceStudy})).toString('base64'));
const sharedPayload=JSON.parse(Buffer.from(decodeURIComponent(sharedHash),'base64').toString());
assert.deepEqual(sanitize(sharedPayload.state),surfaceStudy);
const switched=sanitize({...surfaceStudy,form:'network'});
assert.deepEqual(sanitize({...switched,form:'cascading'}),surfaceStudy);
const oldStudy=sanitize({form:'network',rate:2.6,palette:3});
assert.deepEqual([oldStudy.folds,oldStudy.foldAmplitude],[11,1],'Older saved studies receive usable surface defaults');
assert.deepEqual(
  [sanitize({folds:0,foldAmplitude:-1}).folds,sanitize({folds:0,foldAmplitude:-1}).foldAmplitude],
  [4,0],
);
assert.deepEqual(
  [sanitize({folds:30,foldAmplitude:3}).folds,sanitize({folds:30,foldAmplitude:3}).foldAmplitude],
  [20,1.8],
);
assert.equal(sanitize({folds:12.6}).folds,13);
assert.deepEqual(sanitize({folds:NaN,foldAmplitude:Infinity}),defaults);
assert.deepEqual(sanitize({folds:'18',foldAmplitude:'1.4'}),defaults);
for(const form of ['ascent','multiply','network']){
  assert.deepEqual(
    buildModel({...defaults,form,folds:4,foldAmplitude:0}),
    buildModel({...defaults,form,folds:20,foldAmplitude:1.8}),
    `${form} ignores controls that belong only to Cascading folds`,
  );
}
console.log('All growth-model checks passed.');
