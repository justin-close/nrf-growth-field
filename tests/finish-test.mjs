import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitize} from '../model.mjs';
import {filamentFade} from '../finish.mjs';

test('old studies retain the original finish and new finishes survive JSON round trips',()=>{
  assert.equal(sanitize({form:'shell'}).filamentFinish,'off');
  for(const filamentFinish of ['off','silk','veil']){
    const state=sanitize({filamentFinish,fadeStrength:83,form:'cascading'});
    assert.deepEqual(sanitize(JSON.parse(JSON.stringify(state))),state);
  }
  assert.equal(sanitize({filamentFinish:'unknown',fadeStrength:Infinity}).filamentFinish,'off');
  assert.equal(sanitize({fadeStrength:300}).fadeStrength,100);
  assert.equal(sanitize({fadeStrength:-4}).fadeStrength,0);
});

test('fade reduces alpha smoothly without changing legacy or zero-strength lines',()=>{
  for(const filamentFinish of ['off','silk','veil'])for(const fadeStrength of [0,35,65,100])for(const variation of [0,.21,.67,1]){
    const state={filamentFinish,fadeStrength};let last=filamentFade(0,variation,state);
    for(let i=0;i<=1000;i++){
      const alpha=filamentFade(i/1000,variation,state);
      assert(Number.isFinite(alpha)&&alpha>=0&&alpha<=1);
      if(filamentFinish==='off'||fadeStrength===0)assert.equal(alpha,1);
      assert(Math.abs(alpha-last)<.03,'fade has no hard steps');last=alpha;
    }
    assert(Math.abs(filamentFade(0,variation,state)-filamentFade(1,variation,state))<1e-8,'closed contours have no seam');
  }
});

test('Silk tapers its ends while Veil creates staggered bands across strands',()=>{
  const silk={filamentFinish:'silk',fadeStrength:100},veil={filamentFinish:'veil',fadeStrength:100};
  assert(filamentFade(.5,.5,silk)>filamentFade(.02,.5,silk)*3);
  assert(filamentFade(.5,0,veil)>filamentFade(.25,0,veil)*3);
  assert(filamentFade(.25,.5,veil)>filamentFade(.25,0,veil)*3);
  for(const finish of [silk,veil]){
    const light=filamentFade(.1,.3,{...finish,fadeStrength:30});
    const strong=filamentFade(.1,.3,{...finish,fadeStrength:85});assert(strong<light);
  }
});
