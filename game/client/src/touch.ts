import type { Input } from './input.ts';
import { prefs } from './prefs.ts';
import './touch.css';

/**
 * Touch controls for phones and tablets: a floating stick on the left half moves, a drag anywhere else
 * looks around (two fingers pinch the camera in and out), and thumb buttons on the right jump, run,
 * interact and pick a vehicle. Everything goes through Input (its virtual keys/stick and mouse deltas),
 * so the game reads touch exactly like the keyboard.
 */
export interface TouchHooks {
  input: Input;
  canvas: HTMLCanvasElement;
  vehicles: { key: string; id: string; icon: string; label: string }[];
  state: () => { vehicle: string; flying: boolean };
  openPhone: () => void;
  /** A panel, the world map or photo mode is up: the controls step aside. */
  blocked: () => boolean;
}

const LOOK = 2.4;
const STICK = 52;
const DEAD = 0.12;
const zh = () => localStorage.getItem('agent-city-language') !== 'en';
const VEHICLE_ZH: Record<string, string> = { foot: '步行', skate: '滑板', bike: '自行车', jeep: '吉普', plane: '飞机', kayak: '皮划艇', boat: '快艇', shuttle: '航天飞机' };

/** Keep a finger's moves on the element it landed on (a pointer that already lifted can't be captured). */
function capture(el: HTMLElement, e: PointerEvent) {
  try { el.setPointerCapture(e.pointerId); } catch { /* already gone */ }
}

export function isTouchDevice() {
  return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(hover: hover)').matches);
}

export function installTouch(h: TouchHooks) {
  const { input, canvas } = h;
  let on = false;
  const root = document.createElement('div');
  root.id = 'touch-ui';
  root.className = 'hidden';
  root.innerHTML = `
    <div class="tc-zone"><div class="tc-base"><i class="tc-knob"></i></div></div>
    <div class="tc-pad">
      <button class="tc-btn tc-jump" data-hold="Space"><b></b></button>
      <button class="tc-btn tc-run" data-hold="ShiftLeft"><b></b></button>
      <button class="tc-btn tc-use" data-tap="KeyE"><b></b></button>
      <button class="tc-btn tc-dive" data-hold="KeyC"><b></b></button>
      <button class="tc-btn tc-wing" data-tap="KeyQ"><b></b></button>
    </div>
    <div class="tc-side">
      <button class="tc-mini tc-phone" data-act="phone"><b></b></button>
      <button class="tc-mini tc-map" data-tap="KeyM"><b></b></button>
      <button class="tc-mini tc-ride" data-act="ride"><b></b></button>
    </div>
    <div class="tc-rides hidden"></div>`;
  document.body.appendChild(root);
  const base = root.querySelector<HTMLElement>('.tc-base')!, knob = root.querySelector<HTMLElement>('.tc-knob')!;
  const rides = root.querySelector<HTMLElement>('.tc-rides')!;

  const label = () => {
    const z = zh();
    const set = (sel: string, a: string, b: string) => { root.querySelector(`${sel} b`)!.textContent = z ? a : b; };
    set('.tc-jump', '跳', 'Jump'); set('.tc-run', '冲刺', 'Run'); set('.tc-use', '互动', 'Use');
    set('.tc-dive', '俯冲', 'Dive'); set('.tc-wing', '翼装', 'Wing');
    set('.tc-phone', '手机', 'Phone'); set('.tc-map', '地图', 'Map'); set('.tc-ride', '载具', 'Ride');
    rides.innerHTML = h.vehicles.map((v) => `<button data-key="${v.key}" data-id="${v.id}"><i>${v.icon}</i>${z ? VEHICLE_ZH[v.id] ?? v.label : v.label}</button>`).join('');
    const look = document.getElementById('click-to-look');
    if (look) look.textContent = z ? '左下拖动摇杆走路 · 滑动屏幕转视角 · 双指缩放' : 'Drag the left stick to move · swipe to look · pinch to zoom';
  };

  const enable = () => {
    if (on) return;
    on = true;
    input.touch = true;
    document.body.classList.add('touch-ui');
    label();
    requestAnimationFrame(frame);
  };
  if (isTouchDevice()) enable();
  window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') enable(); }, { capture: true, passive: true });

  // ---- move stick: appears where the left thumb lands ----
  let stick: { id: number; x: number; y: number } | null = null;
  const zone = root.querySelector<HTMLElement>('.tc-zone')!;
  const resetStick = () => { stick = null; input.virtual.x = 0; input.virtual.y = 0; input.virtual.keys.delete('ShiftLeft'); base.classList.remove('on'); base.style.left = base.style.top = knob.style.transform = ''; };
  zone.addEventListener('pointerdown', (e) => {
    if (stick) return;
    e.preventDefault();
    capture(zone, e);
    const r = zone.getBoundingClientRect();
    stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
    base.style.left = `${e.clientX - r.left}px`; base.style.top = `${e.clientY - r.top}px`;
    base.classList.add('on');
    document.body.classList.add('touch-used');
  });
  zone.addEventListener('pointermove', (e) => {
    if (!stick || e.pointerId !== stick.id) return;
    let dx = e.clientX - stick.x, dy = e.clientY - stick.y;
    const d = Math.hypot(dx, dy);
    if (d > STICK) { dx *= STICK / d; dy *= STICK / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // A small dead zone, so a resting thumb doesn't creep the robot along.
    const m = Math.min(d, STICK) / STICK, k = m < DEAD ? 0 : (m - DEAD) / (1 - DEAD) / Math.max(m, 1e-6);
    input.virtual.x = (dx / STICK) * k; input.virtual.y = (-dy / STICK) * k;
    // Pushed to the rim: run (boost in a vehicle), like holding Shift.
    if (d > STICK * 1.35 && !held.has('ShiftLeft')) input.virtual.keys.add('ShiftLeft');
    else if (!held.has('ShiftLeft')) input.virtual.keys.delete('ShiftLeft');
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) zone.addEventListener(ev, (e) => { if (stick && (e as PointerEvent).pointerId === stick.id) resetStick(); });

  // ---- look: drag on the game view; two fingers pinch the camera distance ----
  const looks = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  const spread = () => { const [a, b] = [...looks.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    capture(canvas, e);
    looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinch = looks.size === 2 ? spread() : 0;
    document.body.classList.add('touch-used');
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = looks.get(e.pointerId);
    if (!p || !input.enabled) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (looks.size === 1) { const k = LOOK * prefs.lookSpeed; input.mouseDX += dx * k; input.mouseDY += dy * k; return; }
    const s = spread();
    if (pinch && s) window.dispatchEvent(new WheelEvent('wheel', { deltaY: (pinch - s) * 4 }));
    pinch = s;
  });
  for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, (e) => { looks.delete((e as PointerEvent).pointerId); pinch = looks.size === 2 ? spread() : 0; });

  // ---- buttons: hold ones act as held keys, tap ones fire the key once ----
  const held = new Set<string>();
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-hold]')) {
    const code = b.dataset.hold!;
    const up = () => { held.delete(code); input.virtual.keys.delete(code); b.classList.remove('down'); };
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); capture(b, e); held.add(code); input.virtual.keys.add(code); b.classList.add('down'); });
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
  }
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-tap]')) {
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); rides.classList.add('hidden'); input.press(b.dataset.tap!); });
  }
  root.querySelector('[data-act="phone"]')!.addEventListener('pointerdown', (e) => { e.preventDefault(); rides.classList.add('hidden'); h.openPhone(); });
  root.querySelector('[data-act="ride"]')!.addEventListener('pointerdown', (e) => { e.preventDefault(); rides.classList.toggle('hidden'); });
  rides.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-key]');
    if (!b) return;
    rides.classList.add('hidden');
    input.press(b.dataset.key!);
  });
  // The "E · Enter" prompt is a button too.
  document.getElementById('prompt')?.addEventListener('click', () => { if (on) input.press('KeyE'); });

  // ---- visibility: only while you're actually driving the robot ----
  const hud = document.getElementById('hud');
  function frame() {
    const hide = !input.enabled || !hud || hud.classList.contains('hidden') || document.body.classList.contains('phone-docked') || h.blocked();
    if (hide !== root.classList.contains('hidden')) {
      root.classList.toggle('hidden', hide);
      if (hide) { resetStick(); for (const c of held) input.virtual.keys.delete(c); held.clear(); looks.clear(); rides.classList.add('hidden'); }
    }
    const s = h.state();
    root.classList.toggle('flying', s.flying);
    root.classList.toggle('riding', s.vehicle !== 'foot');
    requestAnimationFrame(frame);
  }
}
