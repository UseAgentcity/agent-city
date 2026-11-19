import type * as THREE from 'three';
import { quality } from '../engine.ts';
import './diag.css';

/**
 * When the GPU drops the WebGL context (a phone out of graphics memory), the game would just go black:
 * say so and offer a reload. With `?debug=1` a small overlay also lists the GPU, memory and the latest
 * errors, so a screenshot from a phone is enough to see what broke.
 */
export function installDiagnostics(renderer: THREE.WebGLRenderer, state: () => Record<string, unknown>) {
  const zh = localStorage.getItem('agent-city-language') !== 'en';
  const canvas = renderer.domElement;
  const log: string[] = [];
  const note = (s: string) => { log.unshift(`${new Date().toLocaleTimeString()} ${s}`.slice(0, 260)); log.length = Math.min(log.length, 10); };

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    note('context lost');
    if (document.querySelector('.diag-lost')) return;
    const el = document.createElement('button');
    el.className = 'diag-lost';
    el.innerHTML = zh
      ? '<b>画面渲染中断</b><span>手机显存可能不够了，点这里重新加载。</span>'
      : '<b>Rendering stopped</b><span>The phone may be out of graphics memory. Tap to reload.</span>';
    el.addEventListener('click', () => location.reload());
    document.body.appendChild(el);
  });
  canvas.addEventListener('webglcontextrestored', () => note('context restored'));

  if (new URLSearchParams(location.search).get('debug') !== '1') return;
  window.addEventListener('error', (e) => note(`error: ${e.message} @${String(e.filename).split('/').pop()}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => note(`rejection: ${(e.reason as Error)?.message ?? e.reason}`));
  for (const k of ['error', 'warn'] as const) {
    const orig = console[k].bind(console);
    console[k] = (...a: unknown[]) => { note(`${k}: ${a.map((x) => (x instanceof Error ? x.message : String(x))).join(' ')}`); orig(...a); };
  }
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const box = document.createElement('pre');
  box.className = 'diag-box';
  document.body.appendChild(box);
  setInterval(() => {
    const m = renderer.info.memory, r = renderer.info.render;
    box.textContent = [
      `GPU ${gpu}`,
      `tier ${quality.tier} dpr ${devicePixelRatio} px ${renderer.getPixelRatio().toFixed(2)} ${canvas.width}x${canvas.height} lost ${gl.isContextLost()}`,
      `tex ${m.textures} geo ${m.geometries} prog ${renderer.info.programs?.length ?? 0} calls ${r.calls} tris ${r.triangles}`,
      Object.entries(state()).map(([k, v]) => `${k}=${v}`).join(' '),
      ...log,
    ].join('\n');
  }, 1000);
}
