import { isMobile } from './util.js';

// Graphics tier: 'low' (weak / old devices), 'mid' (typical phones), 'high' (desktops, flagship).
// Detected once from the GPU string + device hints, before the real renderer is created.
export function detectTier(pref = 'auto') {
  if (pref === 'low' || pref === 'high') return pref;
  let gpu = '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl && gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch (e) {
    /* ignore */
  }
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const weakGpu =
    /SwiftShader|llvmpipe|Software|Mali-[4T]\d\d|Mali-G(31|51|52|57|68)\b|Adreno \(TM\) [345]\d\d|Adreno \(TM\) 6[01]\d|PowerVR|Intel\(R\) (HD|UHD) Graphics( [2-6]\d\d)?\b|Apple A(9|10|11)\b/i.test(gpu);
  if (weakGpu || mem <= 2 || cores <= 2) return 'low';
  if (isMobile) return mem <= 3 || cores <= 4 ? 'low' : 'mid';
  return 'high';
}

export const TIER_CFG = {
  // dprCap: max pixel ratio · aa: MSAA · idleFps: ambient fps when nothing moves (0 = only redraw on change)
  low: { dprCap: 1.0, aa: false, idleFps: 0, menuFps: 0, grass: 0, flowers: 50, motes: false, wind: false, detail: 0 },
  mid: { dprCap: 1.5, aa: true, idleFps: 12, menuFps: 20, grass: 200, flowers: 110, motes: true, wind: true, detail: 1 },
  high: { dprCap: 2.0, aa: true, idleFps: 20, menuFps: 30, grass: 420, flowers: 170, motes: true, wind: true, detail: 2 },
};
