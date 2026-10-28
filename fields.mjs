// Art-directed trajectories inspired by natural growth, in arbitrary units.
// The same deterministic pose is used by WebGL, SVG and video exports.
export const FIELD_FORMS = ['radial', 'shell', 'bifurcation'];
export const FIELD_LINE_WIDTH = .65;
export const isField = form => FIELD_FORMS.includes(form);
const clamp = v => Math.max(0, Math.min(1, v));
const smooth = v => { const t = clamp(v); return t * t * (3 - 2 * t); };
const noise = (i, seed) => { const n = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return n - Math.floor(n); };
const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
const bezier = (a, b, c, d, t) => a.map((v, k) => (1-t)**3*v + 3*(1-t)**2*t*b[k] + 3*(1-t)*t*t*c[k] + t**3*d[k]);
export function pointOnTrace(points, t) {
  const f = clamp(t) * (points.length - 1), i = Math.min(points.length - 2, Math.floor(f));
  return mix(points[i], points[i+1], f-i);
}

export function buildFieldModel(s) {
  const count = Math.round(({radial:560, shell:620, bifurcation:720}[s.form]) * s.density / 100);
  const n = (i, seed) => noise(i, seed + (s.seed - 1) * .731);
  const source = s.form === 'shell' ? [-2.65,-.03,-.12] : [0,0,0];
  // The approved studies use Z-up. Convert to the instrument's Y-up space.
  const transform = (p, t) => {
    const angle = (s.twist-25) * Math.PI/180 * t;
    const depth = p[1] * s.depth/70, height = p[2], spread = s.spread/65;
    return [p[0]*spread, (height*Math.cos(angle)-depth*Math.sin(angle))*spread,
      -(height*Math.sin(angle)+depth*Math.cos(angle))*spread];
  };
  const traces = [], points = [{pos:transform(source,0)}];
  let segmentCount = 0;
  for (let i=0; i<count; i++) {
    let curve, marks, seed;
    if (s.form === 'radial') {
      const u=2*n(i,7)-1, a=i*2.39996323, r=1.05+2.25*n(i,3)**.38+(i%47===0?.65:0), ring=Math.sqrt(1-u*u);
      const end=[Math.cos(a)*ring*r,Math.sin(a)*ring*r*.72,u*r], bend=mix(source,end,.5);
      bend[1]+=(n(i,4)-.5)*.18; curve=[source,bend,end]; seed=17;
      marks=[{t:1,r:i%31===0?1.6:.65+.5*n(i,8),alpha:.9,square:i%4===0}];
      for(let j=0;j<3;j++)marks.push({t:.17+.75*n(i*3+j,12),r:.5+.45*n(i+j,13),alpha:.3+.5*n(i+j,14),square:j===1});
    } else {
      let end,b,c,steps;
      if(s.form==='shell') {
        const u=2*n(i,29)-1,a=i*2.39996323,ring=Math.sqrt(1-u*u),r=2.55+.1*n(i,33);
        end=[.32+r*ring*Math.cos(a),r*ring*Math.sin(a)*.8,r*u];
        b=[-2.1,end[1]*.12,end[2]*.12];c=[end[0]-.22,end[1]*1.08,end[2]*1.08];steps=32;seed=41;
        marks=[{t:1,r:.65+.6*n(i,34),alpha:.88,square:i%3===0}];
        for(let j=0;j<3;j++)marks.push({t:.64+.34*n(i*3+j,35),r:.45+.35*n(i+j,36),alpha:.35+.5*n(i+j,37),square:j===0});
      } else {
        const side=i%2?1:-1,a=Math.floor(i/2)*2.39996323,r=.58+.42*n(i,51)**.25;
        const z=2.6*Math.sin(a)*r,depth=.8*Math.cos(a)*r,x=side*(1.32+1.65*Math.cos(a)**2)*r*(side>0?1:.88);
        end=[x,depth,z+(side>0?.3:-.22)];b=[side*.18,depth*.025,end[2]*.035];c=[x*.6,depth*.6,end[2]*.37];steps=26;seed=59;
        marks=[{t:1,r:.65+.65*n(i,54),alpha:.86,square:i%4===0}];
        for(let j=0;j<3;j++)marks.push({t:.75+.24*n(i*3+j,55),r:.45+.4*n(i+j,56),alpha:.32+.5*n(i+j,57),square:j===1});
      }
      curve=Array.from({length:steps+1},(_,j)=>bezier(source,b,c,end,j/steps));
    }
    curve=curve.map((p,j)=>transform(p,j/(curve.length-1)));
    for(const mark of marks)mark.pos=pointOnTrace(curve,mark.t);
    traces.push({points:curve,marks,birth:Math.log2(i+1)/Math.log2(count),duration:.16+.15*n(i,seed),alpha:.14+.24*n(i,seed+1),variation:n(i,seed+2)});
    points.push({pos:curve.at(-1)});segmentCount+=curve.length-1;
  }
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const tr of traces)for(const p of tr.points)for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
  const framingPoints=Array.from({length:8},(_,i)=>min.map((v,k)=>i&(1<<k)?max[k]:v));
  return {kind:'field',form:s.form,traces,source:transform(source,0),points,edges:[],framingPoints,segmentCount,markCount:count*5+1};
}

export function createFieldPose(model) {
  return {linePositions:new Float32Array(model.segmentCount*6),lineAlpha:new Float32Array(model.segmentCount*2),
    dotPositions:new Float32Array(model.markCount*3),dotAlpha:new Float32Array(model.markCount),
    dotRadius:new Float32Array(model.markCount),dotSquare:new Float32Array(model.markCount),activeTraces:0,activeMarks:0};
}

export function updateFieldPose(model, state, frame, pose=createFieldPose(model)) {
  const {growth,energy,stagger,mode,pulse}=frame;
  let segment=0,dot=1;pose.activeTraces=0;pose.activeMarks=1;
  pose.dotPositions.set(model.source,0);pose.dotAlpha[0]=.95;pose.dotRadius[0]=1.65;
  const setDot=(pos,r,alpha,square)=>{pose.dotPositions.set(pos,dot*3);pose.dotRadius[dot]=r;pose.dotAlpha[dot]=alpha;pose.dotSquare[dot]=square?1:0;if(alpha>.05)pose.activeMarks++;dot++;};
  for(const tr of model.traces) {
    const duration=tr.duration*(mode===1?1.05:.98),birth=tr.birth*Math.min(.67*(.4+1.2*stagger),.98-duration);
    const age=clamp((growth-birth)/duration),t=smooth(age),steps=tr.points.length-1;
    if(t>0)pose.activeTraces++;
    const envelope=Math.sin(Math.PI*growth),shine=f=>1+energy*envelope*(mode===2?.9:.35)*Math.max(0,Math.cos(f*12-pulse+tr.variation*6))**12;
    for(let j=1;j<=steps;j++,segment++) {
      const start=(j-1)/steps,end=Math.min(j/steps,t),visible=t>start;
      const a=tr.points[j-1],b=visible?pointOnTrace(tr.points,end):a;
      pose.linePositions.set(a,segment*6);pose.linePositions.set(b,segment*6+3);
      const alpha=visible?Math.min(1,tr.alpha*.6*(state.lineOpacity/35)*smooth(age/.12)*shine((start+end)*.5)):0;
      pose.lineAlpha[segment*2]=pose.lineAlpha[segment*2+1]=alpha;
    }
    for(const mark of tr.marks) {
      const alpha=smooth((t-mark.t+.012)/.012)*mark.alpha*shine(mark.t);
      setDot(mark.pos,mark.r,Math.min(1,alpha),mark.square);
    }
    const tipAlpha=t>0&&t<1?smooth(age/.12)*smooth((1-age)/.1)*(.65+.25*energy):0;
    setDot(pointOnTrace(tr.points,t),.65+energy*.4,tipAlpha,false);
  }
  pose.growth=growth;
  return pose;
}
