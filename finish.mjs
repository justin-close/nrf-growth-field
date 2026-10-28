// Fixed strand profiles keep the texture attached to the form while it grows.
const clamp = value => Math.max(0, Math.min(1, value));
export const filamentFinishMode = finish => ({silk:1, veil:2}[finish] || 0);
export function filamentFade(t, variation, settings = {}) {
  const mode = filamentFinishMode(settings.filamentFinish);
  const strength = clamp((Number.isFinite(settings.fadeStrength) ? settings.fadeStrength : 65) / 100);
  if (!mode || !strength) return 1;
  t = clamp(t); variation = clamp(variation);
  const taper = Math.max(0, Math.sin(Math.PI * t));
  const profile = mode === 1
    ? (.08 + .92 * Math.pow(taper, .65 + variation * .65)) * (.62 + .38 * variation)
    : (.08 + .92 * Math.pow(.5 + .5 * Math.cos(Math.PI * 2 * (2 * t - variation)), 1.5)) * (.72 + .28 * Math.pow(taper, .7));
  return 1 + (profile - 1) * strength;
}

// Same profile as the CPU pose and SVG export, evaluated along each fragment.
export const filamentGLSL = `
float filamentFade(float t, float variation, float mode, float strength) {
  if (mode < .5 || strength <= 0.0) return 1.0;
  t = clamp(t, 0.0, 1.0); variation = clamp(variation, 0.0, 1.0);
  float taper = max(0.0, sin(3.14159265359 * t));
  float profile = mode < 1.5
    ? (.08 + .92 * pow(taper, .65 + variation * .65)) * (.62 + .38 * variation)
    : (.08 + .92 * pow(.5 + .5 * cos(6.28318530718 * (2.0 * t - variation)), 1.5)) * (.72 + .28 * pow(taper, .7));
  return mix(1.0, profile, clamp(strength, 0.0, 1.0));
}`;
