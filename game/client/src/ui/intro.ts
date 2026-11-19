// The opening shot: the camera starts high over Midtown, sweeps down the Times Square bowtie and settles
// behind you on the plaza, while a title card says which season and day it is and what the city is doing.
// Any key, click or tap skips it. The player keeps updating underneath, so the hand-over is seamless.
import * as THREE from 'three';
import { t } from '../i18n.ts';
import { burnLine, eventName, seasonLine, tycoon } from './tycoon.ts';

const SEEN = 'open-world-intro-at';
const DURATION = 7.5;

export interface Intro { readonly active: boolean; update(dt: number, follow: () => void): void; skip(): void }

/** Whether to play: not when resuming, not twice within half an hour, never with ?nointro=1. */
export function wantIntro(resuming: boolean) {
  if (resuming || new URLSearchParams(location.search).get('nointro') === '1') return false;
  try { return Date.now() - Number(localStorage.getItem(SEEN) ?? 0) > 30 * 60_000; } catch { return true; }
}

const ease = (k: number) => k * k * (3 - 2 * k);

export function startIntro(opts: { camera: THREE.PerspectiveCamera; focus: THREE.Vector3; facing: number; onEnd: () => void }): Intro {
  try { localStorage.setItem(SEEN, String(Date.now())); } catch { /* private mode */ }
  const { camera, focus, facing } = opts;
  // Facing is the player's yaw: forward is (sin, cos). The shot starts far down the bowtie, high up,
  // and comes back toward you, so the first thing you see is the canyon of screens.
  const fx = Math.sin(facing), fz = Math.cos(facing);
  const sx = -fz, sz = fx; // to the side
  const p0 = new THREE.Vector3(focus.x + fx * 300 + sx * 60, focus.y + 340, focus.z + fz * 300 + sz * 60);
  const p1 = new THREE.Vector3(focus.x + fx * 130 - sx * 20, focus.y + 80, focus.z + fz * 130 - sz * 20);
  const p2 = new THREE.Vector3(focus.x + fx * 30 + sx * 10, focus.y + 14, focus.z + fz * 30 + sz * 10);
  const curve = new THREE.CatmullRomCurve3([p0, p1, p2], false, 'centripetal');
  const lookA = new THREE.Vector3(focus.x + fx * 60, focus.y, focus.z + fz * 60);
  const lookB = focus.clone().setY(focus.y + 3);

  const card = document.createElement('div');
  card.className = 'ow-intro';
  let filled = false;
  const fill = () => {
  const city = tycoon();
  filled = !!city;
  const open = city?.lots.filter((l) => l.owner).length ?? 0;
  const lots = city?.lots.length ?? 0;
  const ev = city?.event ? eventName(city.event) : '';
  card.innerHTML = `
    <div class="ow-intro-k">AGENT CITY</div>
    <div class="ow-intro-h">${t('时代广场 Agent 商战', 'Times Square Tycoon')}</div>
    <div class="ow-intro-s">${seasonLine(city)}${ev ? ` · ${t('今日', 'Today')}：${ev}` : ''}</div>
    <div class="ow-intro-l">${city ? t(`${lots} 个铺位 · ${open} 家由 Agent 经营`, `${lots} lots · ${open} run by Agents`) : ''}${city ? ` · ${burnLine(city)}` : ''}</div>
    <div class="ow-intro-x">${t('按任意键跳过', 'Press any key to skip')}</div>`;
  };
  fill();
  document.body.appendChild(card);
  document.body.classList.add('ow-intro-on');
  requestAnimationFrame(() => card.classList.add('in'));

  let time = 0, done = false;
  const goalPos = new THREE.Vector3(), goalQuat = new THREE.Quaternion();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const end = () => {
    if (done) return;
    done = true;
    removeEventListener('keydown', skipKey, true);
    removeEventListener('pointerdown', skipKey, true);
    document.body.classList.remove('ow-intro-on');
    card.classList.remove('in');
    setTimeout(() => card.remove(), 700);
    opts.onEnd();
  };
  const skipKey = (e: Event) => {
    // Let the first click still focus the game; it just ends the shot early.
    if (time < 0.4) return;
    e.stopPropagation();
    time = Math.max(time, DURATION - 0.6);
  };
  addEventListener('keydown', skipKey, true);
  addEventListener('pointerdown', skipKey, true);

  return {
    get active() { return !done; },
    skip: () => { time = DURATION; },
    update(dt, follow) {
      if (done) return;
      time += dt;
      if (!filled) fill();
      // Where the game's own camera wants to be this frame: the shot ends exactly there.
      follow();
      goalPos.copy(camera.position);
      goalQuat.copy(camera.quaternion);
      const k = Math.min(1, time / DURATION);
      const pathK = ease(Math.min(1, k / 0.82));
      const pos = curve.getPoint(pathK);
      const look = lookA.clone().lerp(lookB, ease(Math.min(1, k / 0.75)));
      m.lookAt(pos, look, up);
      q.setFromRotationMatrix(m);
      // The last stretch blends from the flight into the follow camera.
      const hand = ease(Math.max(0, (k - 0.72) / 0.28));
      camera.position.copy(pos).lerp(goalPos, hand);
      camera.quaternion.copy(q).slerp(goalQuat, hand);
      if (k > 0.55) card.classList.add('fade');
      if (k >= 1) end();
    },
  };
}
