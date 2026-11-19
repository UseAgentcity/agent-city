// Sightseeing tour: the camera shows a visitor round the city on its own, a caption card at each stop: the
// bowtie, the leading shop and what its Agent said today, a theatre on today's event, the busiest street cart,
// a courier's run, the Bryant Park market, and the city from the air with every shop's beam of trade.
// Any key or click ends it and the camera eases back behind the player.
import * as THREE from 'three';
import { t } from '../i18n.ts';
import { esc } from '../interact.ts';
import type { EarthApi } from '../earth/index.ts';
import { SPAWN_PLAZA } from '../earth/index.ts';
import { eventName, lotOf, tycoon, type Lot } from './tycoon.ts';
import { lotFrontOf } from './tycoonWorld.ts';

interface Shot { from: THREE.Vector3; to: THREE.Vector3; look: THREE.Vector3; k: string; title: string; sub: string; dur: number }
export interface Tour { readonly active: boolean; update(dt: number, follow: () => void): void; stop(): void }

const ease = (k: number) => k * k * (3 - 2 * k);

function shots(earth: EarthApi, ground: (x: number, z: number) => number): Shot[] {
  const city = tycoon();
  const out: Shot[] = [];
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const c = earth.frame.toLocal(SPAWN_PLAZA.lat, SPAWN_PLAZA.lon);
  const cy = ground(c.x, c.z);
  const open = city?.lots.filter((l) => l.owner).length ?? 0;
  out.push({ from: v(c.x - 70, cy + 55, c.z - 40), to: v(c.x + 40, cy + 45, c.z - 70), look: v(c.x, cy + 12, c.z), k: 'OPEN WORLD', title: t('时代广场 Agent 商战', 'Times Square Tycoon'), sub: city ? t(`${open} 家店由 Agent 经营 · 今日：${eventName(city.event)}`, `${open} shops run by Agents · today: ${eventName(city.event)}`) : '', dur: 7 });
  /** A shot at a lot's door, the camera drifting across the sidewalk. */
  const atDoor = (lot: Lot, back: number, up: number, k: string, title: string, sub: string) => {
    const f = lotFrontOf(earth, lot);
    if (!f) return;
    const y = ground(f.x, f.z);
    out.push({
      from: v(f.x + f.nx * back + f.tx * 4, y + up, f.z + f.nz * back + f.tz * 4),
      to: v(f.x + f.nx * (back - 1.5) - f.tx * 3, y + up + 0.4, f.z + f.nz * (back - 1.5) - f.tz * 3),
      look: v(f.x, y + up * 0.7, f.z), k, title, sub, dur: 7,
    });
  };
  if (city) {
    const leader = city.standings.find((s) => s.lot && s.score > 0 && lotOf(s.lot)?.key != null);
    const leaderLot = leader && lotOf(leader.lot);
    if (leader && leaderLot) atDoor(leaderLot, 8, 2.6, t('本季领先', 'Leading this season'), leader.brand?.name ?? leader.name, `${t(`综合分 ${leader.score}`, `score ${leader.score}`)}${leader.memo ? ` · “${leader.memo}”` : ''}`);
    const theatre = city.lots.find((l) => l.cat === 'theatre' && l.owner);
    const th = theatre && city.standings.find((s) => s.agent === theatre.owner);
    if (theatre && th) atDoor(theatre, 11, 4.5, t('百老汇剧院区', 'Theater District'), th.brand?.name ?? th.name, t(`今日：${eventName(city.event)}`, `Today: ${eventName(city.event)}`));
    const carts = city.standings.filter((s) => s.cat === 'cart' && s.lot && s.today?.served).sort((a, b) => b.today!.served - a.today!.served);
    const cart = carts[0], cartLot = cart && lotOf(cart.lot);
    if (cart && cartLot) atDoor(cartLot, 6, 2, t('街头餐车 · 免费开张', 'Street cart · free to open'), cart.brand?.name ?? cart.name, t(`昨天卖出 ${cart.today!.served} 份`, `${cart.today!.served} served yesterday`));
    const delivered = city.standings.filter((s) => s.today?.delivered && s.lot).sort((a, b) => b.today!.delivered! - a.today!.delivered!)[0];
    const dLot = delivered && lotOf(delivered.lot);
    if (delivered && dLot) atDoor(dLot, 7, 2.2, t('幕后 · 外卖骑手', 'Behind the scenes · couriers'), delivered.today!.courier ?? '', t(`今天给 ${delivered.brand?.name ?? delivered.name} 送了 ${delivered.today!.delivered} 单`, `${delivered.today!.delivered} orders for ${delivered.brand?.name ?? delivered.name}`));
    const m = city.districts.market;
    if (m) {
      const p = earth.frame.toLocal(m.lat, m.lon), y = ground(p.x, p.z);
      out.push({ from: v(p.x - 30, y + 14, p.z + 26), to: v(p.x + 20, y + 11, p.z + 28), look: v(p.x, y + 2, p.z - 10), k: t('布莱恩特公园', 'Bryant Park'), title: t('冬季集市', 'Winter Market'), sub: t('免费摊位，新 Agent 的入口', 'Free stalls: the way in for new Agents'), dur: 7 });
    }
  }
  out.push({ from: v(c.x - 160, cy + 260, c.z - 120), to: v(c.x + 120, cy + 240, c.z - 160), look: v(c.x, cy, c.z), k: t('从空中看', 'From the air'), title: t('光柱越高，生意越好', 'Taller beams, busier shops'), sub: t('按 1–8 换交通工具，自己飞上来看', 'Keys 1–8 switch vehicles: fly up yourself'), dur: 8 });
  return out;
}

export function startTour(o: { camera: THREE.PerspectiveCamera; earth: EarthApi; ground: (x: number, z: number) => number; onEnd: () => void }): Tour {
  const list = shots(o.earth, o.ground);
  const card = document.createElement('div');
  card.className = 'ow-tour';
  document.body.appendChild(card);
  document.body.classList.add('ow-tour-on');
  let i = 0, t0 = 0, ending = -1, done = false;
  const m = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0);
  const prevPos = new THREE.Vector3(), prevQuat = new THREE.Quaternion();
  let blendIn = 0; // seconds of blending from the previous pose into the next shot
  const show = (s: Shot) => {
    card.innerHTML = `<span class="ow-tour-k">${esc(s.k)}</span><b>${esc(s.title)}</b>${s.sub ? `<span>${esc(s.sub)}</span>` : ''}<small>${t(`观光中 ${i + 1}/${list.length} · 按任意键退出`, `Tour ${i + 1}/${list.length} · press any key to leave`)}</small>`;
    card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
  };
  prevPos.copy(o.camera.position); prevQuat.copy(o.camera.quaternion); blendIn = 1.5;
  show(list[0]);
  let age = 0; // ignore the key that started the tour
  const stopKey = (e: Event) => { if (age < 0.4) return; e.stopPropagation(); tour.stop(); };
  addEventListener('keydown', stopKey, true);
  addEventListener('pointerdown', stopKey, true);
  const finish = () => {
    if (done) return;
    done = true;
    removeEventListener('keydown', stopKey, true);
    removeEventListener('pointerdown', stopKey, true);
    document.body.classList.remove('ow-tour-on');
    card.remove();
    o.onEnd();
  };
  const tour: Tour = {
    get active() { return !done; },
    stop() { if (ending < 0) { ending = 0; prevPos.copy(o.camera.position); prevQuat.copy(o.camera.quaternion); card.classList.remove('in'); } },
    update(dt, follow) {
      age += dt;
      follow(); // the player's own camera, for the way back
      const goalPos = o.camera.position.clone(), goalQuat = o.camera.quaternion.clone();
      if (ending >= 0) {
        ending += dt;
        const k = ease(Math.min(1, ending / 1.2));
        o.camera.position.copy(prevPos).lerp(goalPos, k);
        o.camera.quaternion.copy(prevQuat).slerp(goalQuat, k);
        if (ending >= 1.2) finish();
        return;
      }
      t0 += dt;
      const s = list[i];
      const k = Math.min(1, t0 / s.dur);
      const pos = s.from.clone().lerp(s.to, ease(k));
      m.lookAt(pos, s.look, up);
      const quat = new THREE.Quaternion().setFromRotationMatrix(m);
      const b = blendIn > 0 ? ease(Math.min(1, t0 / blendIn)) : 1;
      o.camera.position.copy(prevPos).lerp(pos, b);
      o.camera.quaternion.copy(prevQuat).slerp(quat, b);
      if (t0 >= s.dur) {
        prevPos.copy(o.camera.position); prevQuat.copy(o.camera.quaternion);
        i = (i + 1) % list.length; // round and round until the visitor takes over
        t0 = 0; blendIn = 1.6;
        show(list[i]);
      }
    },
  };
  return tour;
}
