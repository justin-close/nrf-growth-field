import {createFieldPose,updateFieldPose,FIELD_LINE_WIDTH} from './fields.mjs';

export function createFieldArtwork(THREE,model,state,palette,pixelRatio=1) {
  const group=new THREE.Group();group.name='filament-field';
  let settings=state,frame,pose=createFieldPose(model);
  const geometry=(position,alpha)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(position,3).setUsage(THREE.DynamicDrawUsage));g.setAttribute('aAlpha',new THREE.BufferAttribute(alpha,1).setUsage(THREE.DynamicDrawUsage));return g;};
  const dotGeometry=geometry(pose.dotPositions,pose.dotAlpha);
  // Screen-space quads retain hairline weight across DPR and raster exports.
  // WebGL's native lines are fixed at one device pixel on most browsers.
  const lineGeometry=new THREE.InstancedBufferGeometry();
  lineGeometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,0,0,1,0,0,-1,1,0,1,1,0],3));
  lineGeometry.setIndex([0,1,2,2,1,3]);lineGeometry.instanceCount=model.segmentCount;
  const linePositions=new THREE.InstancedInterleavedBuffer(pose.linePositions,6).setUsage(THREE.DynamicDrawUsage);
  const lineAlpha=new THREE.InstancedInterleavedBuffer(pose.lineAlpha,2).setUsage(THREE.DynamicDrawUsage);
  lineGeometry.setAttribute('aStart',new THREE.InterleavedBufferAttribute(linePositions,3,0));
  lineGeometry.setAttribute('aEnd',new THREE.InterleavedBufferAttribute(linePositions,3,3));
  lineGeometry.setAttribute('aAlphaStart',new THREE.InterleavedBufferAttribute(lineAlpha,1,0));
  lineGeometry.setAttribute('aAlphaEnd',new THREE.InterleavedBufferAttribute(lineAlpha,1,1));
  dotGeometry.setAttribute('aRadius',new THREE.BufferAttribute(pose.dotRadius,1).setUsage(THREE.DynamicDrawUsage));
  const material=points=>new THREE.ShaderMaterial({transparent:true,depthWrite:false,toneMapped:false,
    uniforms:{uColor:{value:new THREE.Color(palette.primary)},uSize:{value:state.dotSize/3},uPixelRatio:{value:pixelRatio}},
    vertexShader:`attribute float aAlpha; varying float vAlpha; ${points?'attribute float aRadius; uniform float uSize; uniform float uPixelRatio;':''}
      void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mv;vAlpha=aAlpha;
      ${points?'gl_PointSize=clamp(aRadius*2.0*uSize*(18.0/max(2.0,-mv.z)),.65,30.0)*uPixelRatio;':''}}`,
    fragmentShader:`uniform vec3 uColor; varying float vAlpha;
      void main(){if(vAlpha<.001)discard;float edge=1.0;
      ${points?'float d=length(gl_PointCoord-.5);if(d>.5)discard;edge=1.0-smoothstep(.32,.5,d);':''}
      gl_FragColor=vec4(uColor,vAlpha*edge);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`});
  const lineMaterial=material(false),dotMaterial=material(true);
  lineMaterial.side=THREE.DoubleSide;
  lineMaterial.uniforms.uResolution={value:new THREE.Vector2(1,1)};
  lineMaterial.uniforms.uWidth={value:FIELD_LINE_WIDTH};
  lineMaterial.uniforms.uNear={value:.1};
  lineMaterial.vertexShader=`attribute vec3 aStart;attribute vec3 aEnd;attribute float aAlphaStart;attribute float aAlphaEnd;
    uniform vec2 uResolution;uniform float uWidth;uniform float uPixelRatio;uniform float uNear;varying float vAlpha;
    void main(){
      vec4 a=modelViewMatrix*vec4(aStart,1.0),b=modelViewMatrix*vec4(aEnd,1.0);
      float alphaStart=aAlphaStart,alphaEnd=aAlphaEnd;
      if(a.z>-uNear&&b.z>-uNear){vAlpha=0.0;gl_Position=vec4(0.0);return;}
      if(a.z>-uNear){float clip=(-uNear-a.z)/(b.z-a.z);a=mix(a,b,clip);alphaStart=mix(alphaStart,alphaEnd,clip);}
      if(b.z>-uNear){float clip=(-uNear-b.z)/(a.z-b.z);b=mix(b,a,clip);alphaEnd=mix(alphaEnd,alphaStart,clip);}
      vAlpha=mix(alphaStart,alphaEnd,position.y);
      a=projectionMatrix*a;b=projectionMatrix*b;
      vec2 delta=(b.xy/b.w-a.xy/a.w)*uResolution;
      vec2 normal=vec2(-delta.y,delta.x)/max(length(delta),.00001);
      gl_Position=mix(a,b,position.y);
      gl_Position.xy+=normal*position.x*uWidth*uPixelRatio/uResolution*gl_Position.w;
    }`;
  const lines=new THREE.Mesh(lineGeometry,lineMaterial),dots=new THREE.Points(dotGeometry,dotMaterial);
  lines.onBeforeRender=(renderer,scene,camera)=>{renderer.getDrawingBufferSize(lineMaterial.uniforms.uResolution.value);lineMaterial.uniforms.uNear.value=camera.near;};
  lines.name='lines';dots.name='dots';lines.frustumCulled=dots.frustumCulled=false;dots.renderOrder=1;group.add(lines,dots);
  const update=next=>{frame=next;updateFieldPose(model,settings,frame,pose);linePositions.needsUpdate=true;lineAlpha.needsUpdate=true;for(const attribute of Object.values(dotGeometry.attributes))attribute.needsUpdate=true;};
  function setStyle(next){settings=next;lines.visible=next.style!=='dots';dots.visible=next.style!=='filaments';dotMaterial.uniforms.uSize.value=next.dotSize/3;if(frame)update(frame);}
  setStyle(state);
  return {group,update,setStyle,snapshot:()=>pose,
    setPalette:next=>{lineMaterial.uniforms.uColor.value.set(next.primary);dotMaterial.uniforms.uColor.value.set(next.primary);},
    setPixelRatio:ratio=>{dotMaterial.uniforms.uPixelRatio.value=ratio;lineMaterial.uniforms.uPixelRatio.value=ratio;}};
}
