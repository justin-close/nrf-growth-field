// Timing panel: phase markers on a draggable track, plus two bezier curve editors.
// Stored times are seconds; the shared timeline reads them as clamped fractions.
import { TIMING_KEYS, curvePresets, timingFractions, zoomFractions, moveFractions, buildEase, deconEase, zoomEase, moveEase, sanitizeBezier } from './motion.mjs?v=20261111-motion-core';

const $=id=>document.getElementById(id);
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const NS='http://www.w3.org/2000/svg';
const curveLabels={style:'Follows the motion style',mirror:'Reverses the build curve',custom:'Custom'};
const fmt=n=>(Math.round(n*100)/100).toString().replace(/^(-?)0\./,'$1.');
export const bezierText=b=>`cubic-bezier(${b.map(fmt).join(', ')})`;

// Graph space: x is time in [0,1]; y is growth, with padding around the handles.
const W=200,H=124,X0=12,X1=188,Y0=100,Y1=24;
const toX=x=>X0+x*(X1-X0),toY=y=>Y0+y*(Y1-Y0);
const fromX=v=>(v-X0)/(X1-X0),fromY=v=>(v-Y0)/(Y1-Y0);
const el=(name,attrs,parent)=>{const n=document.createElementNS(NS,name);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);parent?.append(n);return n;};

function createCurveEditor(host,{falling,onDrag}){
  const svg=el('svg',{viewBox:`0 0 ${W} ${H}`,class:'curve-svg','aria-hidden':'true'},host);
  el('rect',{x:X0,y:Y1,width:X1-X0,height:Y0-Y1,class:'curve-frame'},svg);
  for(const q of [.25,.5,.75]){el('line',{x1:toX(q),x2:toX(q),y1:Y1,y2:Y0,class:'curve-grid'},svg);el('line',{x1:X0,x2:X1,y1:toY(q),y2:toY(q),class:'curve-grid'},svg);}
  const arms=[el('line',{class:'curve-arm'},svg),el('line',{class:'curve-arm'},svg)];
  const path=el('path',{class:'curve-path'},svg);
  const dot=el('circle',{r:3.2,class:'curve-dot'},svg);
  const handles=[0,1].map(i=>{const h=el('circle',{r:5,class:'curve-handle'},svg);h.dataset.index=i;return h;});
  let bezier=[0,0,1,1],dragging=-1;
  // Deconstruct handles are drawn in falling growth space, so flip their y.
  const viewY=y=>falling?1-y:y;
  const point=e=>{const r=svg.getBoundingClientRect();return[fromX((e.clientX-r.left)/r.width*W),fromY((e.clientY-r.top)/r.height*H)];};
  handles.forEach((h,i)=>{
    h.addEventListener('pointerdown',e=>{e.preventDefault();dragging=i;h.setPointerCapture(e.pointerId);host.classList.add('dragging');});
    h.addEventListener('pointermove',e=>{if(dragging!==i)return;const [x,y]=point(e),next=[...bezier];next[i*2]=x;next[i*2+1]=viewY(y);onDrag(sanitizeBezier(next.map(v=>Math.round(v*100)/100)));});
    const end=()=>{dragging=-1;host.classList.remove('dragging');};
    h.addEventListener('pointerup',end);h.addEventListener('pointercancel',end);
  });
  let ease=t=>t;
  return{
    draw(nextEase,nextBezier,editable){
      ease=nextEase;bezier=nextBezier;
      const pts=Array.from({length:65},(_,i)=>{const t=i/64;return`${i?'L':'M'}${toX(t).toFixed(2)} ${toY(clamp(ease(t))).toFixed(2)}`;});
      path.setAttribute('d',pts.join(''));
      const anchors=falling?[[0,1],[1,0]]:[[0,0],[1,1]];
      handles.forEach((h,i)=>{
        const x=bezier[i*2],y=viewY(bezier[i*2+1]);
        h.setAttribute('cx',toX(x));h.setAttribute('cy',toY(y));h.style.display=editable?'':'none';
        const a=arms[i];a.setAttribute('x1',toX(anchors[i][0]));a.setAttribute('y1',toY(anchors[i][1]));a.setAttribute('x2',toX(x));a.setAttribute('y2',toY(y));a.style.display=editable?'':'none';
      });
    },
    marker(local,visible){dot.style.display=visible?'':'none';if(visible){dot.setAttribute('cx',toX(local));dot.setAttribute('cy',toY(clamp(ease(local))));}}
  };
}

export function createTimingUI({getState,onChange,onCommit}){
  const track=$('timing-track');
  const segments=Object.fromEntries(['seed','build','hold','decon','end'].map(k=>[k,track.querySelector(`[data-segment="${k}"]`)]));
  const handles=Object.fromEntries(TIMING_KEYS.map(k=>[k,track.querySelector(`[data-handle="${k}"]`)]));
  const playhead=track.querySelector('.timing-playhead');
  const commit=()=>{onChange();onCommit();};

  const cameraTrack=$('camera-track'),zoomSegment=cameraTrack.querySelector('[data-segment="zoom"]'),cameraPlayhead=cameraTrack.querySelector('.timing-playhead');
  const ZOOM_KEYS=['zoomStart','zoomEnd'];
  for(const key of ZOOM_KEYS)handles[key]=cameraTrack.querySelector(`[data-handle="${key}"]`);
  // Rotation, spread and blur moves: a toggle, a track with two markers, and a curve.
  // range pairs each from/to input with the state key it shows.
  const moves=[
    {kind:'rot',track:'rotation-track',options:'rotation-options',fmt:v=>(v>0?'+':'')+v+'°',range:[['rotFrom','rotFrom'],['rotTo','rotTo']]},
    {kind:'spread',track:'spread-track',options:'spread-options',fmt:v=>String(v),range:[['spreadFrom','spreadFrom'],['spreadTo','spread']]},
    {kind:'ext',track:'ext-track',options:'ext-options',fmt:v=>'Gen '+v,range:[['extFrom','extFrom'],['extTo','generations']]},
    {kind:'dof',track:'dof-track',options:'dof-move-options',fmt:v=>v===0?'Off':v+'%',range:[['dofFrom','dofFrom'],['dofTo','dofTo']]},
    // Sprouts: the markers bound the births; their sliders live in app.js.
    {kind:'sprout',toggle:'sprouts',track:'sprout-track',options:'sprout-options',fmt:String,range:[]}
  ].map(m=>{
    m.toggle=m.toggle||m.kind+'Move';
    const track=$(m.track),keys=[m.kind+'Start',m.kind+'End'];
    for(const key of keys)handles[key]=track.querySelector(`[data-handle="${key}"]`);
    return{...m,keys,trackEl:track,segment:track.querySelector('.timing-segment'),playhead:track.querySelector('.timing-playhead')};
  });
  const movePair=key=>moves.find(m=>m.keys.includes(key))?.keys;
  // Each marker stays between its neighbours, so the phases never reorder.
  function setTime(key,seconds){
    const s=getState(),pair=ZOOM_KEYS.includes(key)?ZOOM_KEYS:movePair(key)||null,chain=pair||TIMING_KEYS,i=chain.indexOf(key),last=pair?1:s.deconstruct?3:1;
    const lo=i>0?Math.min(s[chain[i-1]],s.duration):0,hi=i<last?Math.min(s[chain[i+1]],s.duration):s.duration;
    s[key]=Math.round(clamp(seconds,lo,hi)*100)/100;onChange();
  }
  for(const key of [...TIMING_KEYS,...ZOOM_KEYS,...moves.flatMap(m=>m.keys)]){
    $(key).addEventListener('input',()=>setTime(key,+$(key).value));$(key).addEventListener('change',onCommit);
    const h=handles[key];
    h.addEventListener('pointerdown',e=>{e.preventDefault();h.setPointerCapture(e.pointerId);h.classList.add('dragging');});
    h.addEventListener('pointermove',e=>{if(!h.hasPointerCapture(e.pointerId))return;const r=h.parentElement.getBoundingClientRect();setTime(key,clamp((e.clientX-r.left)/r.width)*getState().duration);});
    const end=e=>{if(!h.classList.contains('dragging'))return;h.classList.remove('dragging');onCommit();};
    h.addEventListener('pointerup',end);h.addEventListener('pointercancel',end);
  }

  // Unsyncing starts the camera's own markers from the current build span.
  document.querySelectorAll('[data-zoom-focus]').forEach(b=>b.onclick=()=>{getState().zoomFocus=b.dataset.zoomFocus;commit();});
  $('camMove').onchange=()=>{getState().camMove=$('camMove').checked;commit();};
  $('zoomSync').onchange=()=>{const s=getState();s.zoomSync=$('zoomSync').checked;if(!s.zoomSync){const f=timingFractions(s);s.zoomStart=Math.round(f.buildStart*s.duration*100)/100;s.zoomEnd=Math.round(f.buildEnd*s.duration*100)/100;}commit();};
  for(const {toggle} of moves)$(toggle).onchange=()=>{getState()[toggle]=$(toggle).checked;commit();};
  for(const key of ['zoomFrom','zoomTo','rotFrom','rotTo','dofFrom','dofTo']){$(key).addEventListener('input',()=>{getState()[key]=+$(key).value;onChange();});$(key).addEventListener('change',onCommit);}
  $('deconstruct').onchange=()=>{const s=getState();s.deconstruct=$('deconstruct').checked;if(s.deconstruct)fitDeconstruct(s);commit();};

  const editors={};
  for(const [kind,falling] of [['build',false],['decon',true],['zoom',false],['rot',false],['spread',false],['ext',false],['dof',false],['sprout',false]]){
    const select=$(kind+'Curve'),bezierKey=kind+'Bezier';
    editors[kind]=createCurveEditor($(kind+'-curve-editor'),{falling,onDrag:b=>{const s=getState();s[bezierKey]=b;s[kind+'Curve']='custom';onChange();}});
    $(kind+'-curve-editor').addEventListener('pointerup',onCommit);
    const numbers=document.createElement('fieldset');numbers.className='bezier-inputs';
    const legend=document.createElement('legend');legend.textContent='Custom Bézier control points';numbers.append(legend);
    ['x1','y1','x2','y2'].forEach((axis,i)=>{
      const label=document.createElement('label');label.textContent=axis.toUpperCase();
      const input=document.createElement('input');input.type='number';input.min=0;input.max=1;input.step=.01;input.id=kind+'-'+axis;input.setAttribute('aria-label',kind+' curve '+axis);
      input.oninput=()=>{const value=Number(input.value);if(input.value===''||!Number.isFinite(value))return;const st=getState(),b=[...st[bezierKey]];b[i]=value;st[bezierKey]=sanitizeBezier(b);st[kind+'Curve']='custom';commit();};
      label.append(input);numbers.append(label);
    });
    $(kind+'-curve-editor').append(numbers);
    select.onchange=()=>{const s=getState();s[kind+'Curve']=select.value;if(curvePresets[select.value])s[bezierKey]=[...curvePresets[select.value]];commit();};
  }

  function sync(){
    const s=getState(),d=s.duration,f=timingFractions(s);
    for(const kind of Object.keys(editors)){
      const custom=s[kind+'Curve']==='custom';$(kind+'-curve-editor').hidden=!custom;
      ['x1','y1','x2','y2'].forEach((axis,i)=>{const input=$(kind+'-'+axis);if(document.activeElement!==input)input.value=s[kind+'Bezier'][i];});
    }
    for(const key of TIMING_KEYS){
      const input=$(key),value=Math.min(s[key],d);
      const index=TIMING_KEYS.indexOf(key),last=s.deconstruct?3:1;input.min=index?Math.min(d,s[TIMING_KEYS[index-1]]):0;input.max=index<last?Math.min(d,s[TIMING_KEYS[index+1]]):d;input.value=value;input.setAttribute('aria-valuetext',value.toFixed(2)+' seconds');input.style.setProperty('--fill',`${value/d*100}%`);
      $(key+'-value').textContent=value.toFixed(2)+' s';
      handles[key].style.left=f[key]*100+'%';
    }
    handles.deconStart.hidden=handles.deconEnd.hidden=!s.deconstruct;
    const place=(seg,a,b)=>{seg.style.left=a*100+'%';seg.style.width=Math.max(0,b-a)*100+'%';};
    place(segments.seed,0,f.buildStart);place(segments.build,f.buildStart,f.buildEnd);
    place(segments.hold,f.buildEnd,s.deconstruct?f.deconStart:1);
    place(segments.decon,f.deconStart,f.deconEnd);place(segments.end,f.deconEnd,1);
    segments.decon.hidden=segments.end.hidden=!s.deconstruct;
    $('timing-end').textContent=d+' s';
    $('deconstruct').checked=s.deconstruct;$('decon-timing').hidden=$('decon-curve-block').hidden=!s.deconstruct;
    const hold=(s.deconstruct?f.deconStart:1)-f.buildEnd;
    $('timing-summary').textContent=s.deconstruct?`Holds ${(hold*d).toFixed(1)} s · at seed by ${(f.deconEnd*d).toFixed(1)} s`:`Settles at ${(f.buildEnd*d).toFixed(1)} s · holds ${(hold*d).toFixed(1)} s`;
    const z=zoomFractions(s);
    for(const key of ZOOM_KEYS){
      const input=$(key),value=z[key]*d;
      input.max=d;input.value=value;input.setAttribute('aria-valuetext',value.toFixed(2)+' seconds');input.style.setProperty('--fill',`${value/d*100}%`);
      $(key+'-value').textContent=value.toFixed(2)+' s';
      handles[key].style.left=z[key]*100+'%';handles[key].hidden=s.zoomSync;
    }
    place(zoomSegment,z.zoomStart,z.zoomEnd);
    for(const key of ['zoomFrom','zoomTo']){const input=$(key);input.value=s[key];input.style.setProperty('--fill',`${(s[key]-input.min)/(input.max-input.min)*100}%`);$(key+'-value').textContent=s[key]+'%';}
    document.querySelectorAll('[data-zoom-focus]').forEach(b=>{const active=b.dataset.zoomFocus===s.zoomFocus;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});
    $('camMove').checked=s.camMove;$('zoomSync').checked=s.zoomSync;
    $('camera-options').hidden=cameraTrack.hidden=!s.camMove;$('zoom-timing').hidden=s.zoomSync;
    const zoomCurve=curvePresets[s.zoomCurve]||s.zoomBezier;$('zoomCurve').value=s.zoomCurve;
    editors.zoom.draw(zoomEase(s),zoomCurve,true);$('zoomBezier-value').textContent=bezierText(zoomCurve);
    for(const m of moves){
      const f=moveFractions(s,m.kind);
      m.keys.forEach((key,i)=>{
        const input=$(key),at=i?f.end:f.start,value=at*d;
        input.max=d;input.value=value;input.setAttribute('aria-valuetext',value.toFixed(2)+' seconds');input.style.setProperty('--fill',`${value/d*100}%`);
        $(key+'-value').textContent=value.toFixed(2)+' s';handles[key].style.left=at*100+'%';
      });
      place(m.segment,f.start,f.end);
      for(const [id,key] of m.range){const input=$(id);input.value=s[key];input.style.setProperty('--fill',`${(s[key]-input.min)/(input.max-input.min)*100}%`);$(id+'-value').textContent=m.fmt(s[key]);}
      $(m.toggle).checked=s[m.toggle];$(m.options).hidden=m.trackEl.hidden=!s[m.toggle];
      const curve=curvePresets[s[m.kind+'Curve']]||s[m.kind+'Bezier'];$(m.kind+'Curve').value=s[m.kind+'Curve'];
      editors[m.kind].draw(moveEase(s,m.kind),curve,true);$(m.kind+'Bezier-value').textContent=bezierText(curve);
    }
    for(const kind of ['build','decon']){
      const curve=s[kind+'Curve'],bezier=curvePresets[curve]||s[kind+'Bezier'],editable=curve!=='style'&&curve!=='mirror';
      $(kind+'Curve').value=curve;
      const eased=s.form==='cascading'?{...s,motion:'pulse'}:s;
      editors[kind].draw(kind==='build'?buildEase(eased):deconEase(eased),bezier,editable);
      $(kind+'Bezier-value').textContent=editable?bezierText(bezier):curveLabels[curve];
    }
  }
  function update(frame){
    playhead.style.left=frame.progress*100+'%';
    const growing=/Propagate|Multiply|Settle/.test(frame.phase);
    editors.build.marker(frame.local,growing);
    editors.decon.marker(frame.local,frame.phase==='Deconstruct');
    const s=getState(),z=zoomFractions(s),d=z.zoomEnd-z.zoomStart;
    cameraPlayhead.style.left=frame.progress*100+'%';
    editors.zoom.marker(d>0?clamp((frame.progress-z.zoomStart)/d):1,s.camMove&&frame.progress>=z.zoomStart&&frame.progress<=z.zoomEnd);
    for(const m of moves){
      const f=moveFractions(s,m.kind),span=f.end-f.start;m.playhead.style.left=frame.progress*100+'%';
      editors[m.kind].marker(span>0?clamp((frame.progress-f.start)/span):1,s[m.toggle]&&frame.progress>=f.start&&frame.progress<=f.end);
    }
  }
  return{sync,update};
}

// Place a deconstruct phase in the time left after the build, or rebalance
// to the grow-and-return proportions when the build fills the sequence.
export function fitDeconstruct(s){
  const d=s.duration,end=Math.min(s.buildEnd,d),room=d-end;
  if(s.deconStart>=end&&s.deconEnd<=d&&s.deconEnd-s.deconStart>=d*.15)return;
  if(room<d*.3){const f=[.045,.43,.57,.955];TIMING_KEYS.forEach((k,i)=>{s[k]=Math.round(f[i]*d*100)/100;});return;}
  s.deconStart=Math.round((end+room*.3)*100)/100;s.deconEnd=Math.round((d-room*.1)*100)/100;
}
