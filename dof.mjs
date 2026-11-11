// Depth of field for marks that never write depth: each dot and strand computes
// its own circle of confusion, so WebGL, MP4, PNG and SVG blur identically.
// Sizes are reference (CSS) pixels; shaders multiply by their pixel ratio.
export const DOF_MAX = 48;
export const dofDefaults = { dof: false, dofFocus: 50, dofBlur: 40 };

// One set of uniform objects is shared by every material, so a single update
// per render reaches dots, strands and surfaces alike.
export function createDofUniforms() {
  return { uDofOn: { value: 0 }, uFocus: { value: 10 }, uAperture: { value: 0 } };
}

// Circular marks are part of the NRF dot-grid identity.
export const dotShapeGLSL = `float dotDistance(vec2 p){return length(p-.5);}`;

export const dofGLSL = `
uniform float uDofOn; uniform float uFocus; uniform float uAperture;
float dofCoc(float depth){return uDofOn*min(${DOF_MAX.toFixed(1)},uAperture*abs(depth-uFocus)/max(depth,.1));}
`;

export function dofCoc(depth, uniforms) {
  if (!uniforms.uDofOn.value) return 0;
  return Math.min(DOF_MAX, uniforms.uAperture.value * Math.abs(depth - uniforms.uFocus.value) / Math.max(depth, .1));
}

// A blurred dot spreads the same light over a larger disc. Dimming slightly
// less than its area keeps out-of-focus marks readable as bokeh.
export const dotFade = (size, blurred) => Math.max(.1, Math.pow(size / blurred, 1.2));
// Hairline strands that cannot widen (native WebGL lines) fade instead.
export const hairlineFade = coc => 1 / (1 + coc * .35);
export const dotFadeGLSL = 'max(.1,pow(baseSize/gl_PointSize,1.2))';
