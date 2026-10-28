import { updateCascadingModel } from './cascading.mjs';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Share one dynamic vertex buffer across the mesh, rim and sampled points.
// Each frame deforms the existing surface; no vertices are born or faded in.
export function createCascadingArtwork(THREE, model, state, palette, pixelRatio = 1) {
  const group = new THREE.Group();
  group.name = 'cascading-artwork';
  let settings = state;
  let frame = updateCascadingModel(model, settings, 1);
  const positions = new THREE.BufferAttribute(frame.positions, 3);
  positions.setUsage(THREE.DynamicDrawUsage);
  const meshIndices = [], rimIndices = [];
  for (const edge of model.edges) (edge.rim ? rimIndices : meshIndices).push(edge.a, edge.b);

  const geometryFor = indices => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', positions);
    geometry.setIndex(indices);
    return geometry;
  };
  const meshMaterial = new THREE.LineBasicMaterial({
    color: palette.primary, transparent: true, opacity: .42,
    depthWrite: false, toneMapped: false
  });
  const rimMaterial = new THREE.LineBasicMaterial({
    color: palette.primary, transparent: true, opacity: .96,
    depthWrite: false, toneMapped: false
  });
  const mesh = new THREE.LineSegments(geometryFor(meshIndices), meshMaterial);
  mesh.name = 'lines';
  mesh.frustumCulled = false;
  const rim = new THREE.LineSegments(geometryFor(rimIndices), rimMaterial);
  rim.name = 'cascading-rim';
  rim.frustumCulled = false;
  rim.renderOrder = 1;
  const dotMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    uniforms: {
      uColor: {value: new THREE.Color(palette.primary)},
      uSize: {value: state.dotSize},
      uPixelRatio: {value: pixelRatio},
      uOpacity: {value: .82}
    },
    vertexShader: `
      uniform float uSize;
      uniform float uPixelRatio;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp(uSize * (18.0 / max(2.0, -viewPosition.z)), 1.0, 30.0) * uPixelRatio;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        float distanceFromCenter = length(gl_PointCoord - .5);
        if (distanceFromCenter > .5) discard;
        float edge = 1.0 - smoothstep(.34, .5, distanceFromCenter);
        gl_FragColor = vec4(uColor, uOpacity * edge);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });
  const dots = new THREE.Points(geometryFor(model.dotIndices), dotMaterial);
  dots.name = 'dots';
  dots.frustumCulled = false;
  dots.renderOrder = 2;
  group.add(mesh, rim, dots);

  function setStyle(next) {
    settings = next;
    const opacity = clamp(Number(next.lineOpacity) / 100, 0, 1);
    meshMaterial.opacity = clamp(opacity * 1.2, 0, 1);
    rimMaterial.opacity = clamp(opacity * 2.75, 0, 1);
    dotMaterial.uniforms.uSize.value = next.dotSize;
    mesh.visible = rim.visible = next.style !== 'dots';
    dots.visible = next.style !== 'filaments';
  }
  setStyle(state);

  return {
    group,
    update(growth) {
      frame = updateCascadingModel(model, settings, growth);
      if (positions.array !== frame.positions) positions.array.set(frame.positions);
      positions.needsUpdate = true;
      return frame;
    },
    setPalette(next) {
      meshMaterial.color.set(next.primary);
      rimMaterial.color.set(next.primary);
      dotMaterial.uniforms.uColor.value.set(next.primary);
    },
    setStyle,
    setPixelRatio(ratio) {
      dotMaterial.uniforms.uPixelRatio.value = ratio;
    },
    snapshot() {
      return {
        positions: frame.positions, rimRatio: frame.rimRatio, growth: frame.growth,
        meshOpacity: meshMaterial.opacity, rimOpacity: rimMaterial.opacity,
        dotOpacity: dotMaterial.uniforms.uOpacity.value, dotScale: 1
      };
    }
  };
}
