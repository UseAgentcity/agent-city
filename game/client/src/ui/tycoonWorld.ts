// Times Square Tycoon in the 3D city: a lit sign over every lot (the tenant's brand, or "for lease"), a
// queue at the door that grows with yesterday's trade, and wooden stalls for the Bryant Park market.
// Everything is read from the public city snapshot and redrawn only when it changes.
import * as THREE from 'three';
import { Crowd } from '../earth/crowd.ts';
import type { EarthApi } from '../earth/index.ts';
import { t } from '../i18n.ts';
import { catName, coins, onTycoon, shopOf, tycoon, type Lot } from './tycoon.ts';

/** A lot's door on the street: the point, the outward normal and the wall tangent (world x/z). */
export interface LotFront { x: number; z: number; nx: number; nz: number; tx: number; tz: number; wall: number }

const fronts = new Map<string, LotFront | null>();
/**
 * Where a lot's door is: on the edge of its building outline nearest its district centre, facing out.
 * Market stalls (no building) face the lawn. Null while the building's map tile isn't loaded yet.
 */
export function lotFrontOf(earth: EarthApi, lot: Lot): LotFront | null {
  if (fronts.has(lot.id)) return fronts.get(lot.id)!;
  const city = tycoon();
  const d = city?.districts[lot.district];
  if (!d) return null;
  const p = earth.frame.toLocal(lot.lat, lot.lon);
  const c = earth.frame.toLocal(d.lat, d.lon);
  let front: LotFront | null = null;
  if (lot.key == null) {
    const dx = c.x - p.x, dz = c.z - p.z, l = Math.hypot(dx, dz) || 1;
    front = { x: p.x, z: p.z, nx: dx / l, nz: dz / l, tx: -dz / l, tz: dx / l, wall: 3 };
  } else {
    const hit = earth.footprintsNear(p.x, p.z, 40).find((h) => h.fp.key === lot.key);
    if (!hit) return null; // tile not streamed yet; try again later
    const r = hit.ring;
    let best: LotFront | null = null, bestD = Infinity;
    for (let i = 0; i < r.length; i += 2) {
      const ax = r[i], az = r[i + 1], bx = r[(i + 2) % r.length], bz = r[(i + 3) % r.length];
      const vx = bx - ax, vz = bz - az, len = Math.hypot(vx, vz);
      if (len < 1.5) continue;
      const k = Math.max(0.15, Math.min(0.85, ((c.x - ax) * vx + (c.z - az) * vz) / (len * len)));
      const x = ax + vx * k, z = az + vz * k, dd = Math.hypot(x - c.x, z - c.z);
      if (dd >= bestD) continue;
      let nx = -vz / len, nz = vx / len;
      if (nx * (x - hit.cx) + nz * (z - hit.cz) < 0) { nx = -nx; nz = -nz; }
      bestD = dd;
      best = { x, z, nx, nz, tx: vx / len, tz: vz / len, wall: len };
    }
    front = best;
  }
  fronts.set(lot.id, front);
  return front;
}

// ---------- signs ----------
const SIGN_W = 1024, SIGN_H = 256;
function fit(g: CanvasRenderingContext2D, text: string, weight: number, max: number, width: number) {
  let px = max;
  g.font = `${weight} ${px}px Inter, "PingFang SC", "Microsoft YaHei", Arial, sans-serif`;
  while (g.measureText(text).width > width && px > 24) { px -= 4; g.font = `${weight} ${px}px Inter, "PingFang SC", "Microsoft YaHei", Arial, sans-serif`; }
  return px;
}
function drawSign(c: HTMLCanvasElement, lot: Lot) {
  const g = c.getContext('2d')!;
  const shop = shopOf(lot.owner);
  g.clearRect(0, 0, SIGN_W, SIGN_H);
  if (!shop) {
    g.fillStyle = '#121418'; g.fillRect(0, 0, SIGN_W, SIGN_H);
    g.strokeStyle = 'rgba(240,185,11,.7)'; g.lineWidth = 8; g.setLineDash([28, 18]); g.strokeRect(10, 10, SIGN_W - 20, SIGN_H - 20); g.setLineDash([]);
    g.fillStyle = '#f0b90b'; g.textAlign = 'center'; g.textBaseline = 'middle';
    fit(g, t('招租 · FOR LEASE', 'FOR LEASE'), 900, 96, SIGN_W - 80);
    g.fillText(t('招租 · FOR LEASE', 'FOR LEASE'), SIGN_W / 2, 104);
    g.fillStyle = '#c9d1dc';
    const sub = t(`${catName(lot.cat)} · 日租 ${coins(lot.reserve)} 起 · 派你的 Agent 来开店`, `${catName(lot.cat)} · from ${coins(lot.reserve)}/day · send your Agent`);
    fit(g, sub, 600, 40, SIGN_W - 80);
    g.fillText(sub, SIGN_W / 2, 190);
    return;
  }
  const color = shop.brand?.color ?? '#f0b90b';
  const bg = g.createLinearGradient(0, 0, SIGN_W, SIGN_H);
  bg.addColorStop(0, '#0b0d12'); bg.addColorStop(0.55, '#14161c'); bg.addColorStop(1, color);
  g.fillStyle = bg; g.fillRect(0, 0, SIGN_W, SIGN_H);
  g.fillStyle = color; g.fillRect(0, 0, SIGN_W, 10); g.fillRect(0, SIGN_H - 10, SIGN_W, 10);
  const name = shop.brand?.name ?? shop.name;
  g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = '#ffffff';
  g.shadowColor = color; g.shadowBlur = 24;
  fit(g, name, 900, 120, SIGN_W - 120);
  g.fillText(name, 56, 150);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,255,255,.82)';
  const sub = `${catName(lot.cat)}${shop.brand?.slogan ? ` · ${shop.brand.slogan}` : ''}`;
  fit(g, sub, 600, 42, SIGN_W - 300);
  g.fillText(sub, 58, 214);
  g.textAlign = 'right'; g.fillStyle = color;
  fit(g, shop.name, 700, 34, 260);
  g.fillText(shop.name, SIGN_W - 40, 214);
}

// ---------- market stalls ----------
function buildStall(color: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3b2a1f, roughness: 0.9 });
  const canvas = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.8 });
  const box = (m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; g.add(b);
    return b;
  };
  box(wood, 2.4, 1.0, 1.0, 0, 0.5, 0.2); // counter
  box(dark, 2.5, 0.06, 1.1, 0, 1.03, 0.2);
  box(wood, 2.4, 2.4, 0.08, 0, 1.2, -0.45); // back wall
  for (const x of [-1.18, 1.18]) box(wood, 0.1, 2.6, 0.1, x, 1.3, 0.6);
  // Striped awning, sloping toward the walkway.
  for (let i = 0; i < 6; i++) {
    const s = box(i % 2 ? white : canvas, 0.44, 0.05, 1.5, -1.1 + i * 0.44, 2.62, 0.25);
    s.rotation.x = -0.32;
  }
  // A few goods on the counter.
  for (let i = 0; i < 5; i++) box(i % 2 ? white : canvas, 0.22, 0.22 + (i % 3) * 0.08, 0.22, -0.8 + i * 0.4, 1.17, 0.35);
  return g;
}

export function installTycoonWorld(scene: THREE.Scene, earth: EarthApi, ground: (x: number, z: number) => number) {
  const group = new THREE.Group();
  group.name = 'tycoon-world';
  scene.add(group);
  const queue = new Crowd(180);
  group.add(queue.group);
  for (const m of queue.members) { m.pose = 'stand'; m.speed = 0; m.scale = 0.94 + Math.random() * 0.12; }

  interface Sign { mesh: THREE.Mesh; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; key: string }
  const signs = new Map<string, Sign>();
  const stalls = new Map<string, { root: THREE.Group; key: string }>();
  let pending = true;

  function placeSign(lot: Lot, f: LotFront) {
    const width = Math.max(2.6, Math.min(6.5, f.wall * 0.7));
    const canvas = document.createElement('canvas');
    canvas.width = SIGN_W; canvas.height = SIGN_H;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * SIGN_H / SIGN_W), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }));
    mesh.position.set(f.x + f.nx * 0.25, ground(f.x + f.nx, f.z + f.nz) + 4.1, f.z + f.nz * 0.25);
    mesh.rotation.y = Math.atan2(f.nx, f.nz);
    mesh.name = `tycoon-sign:${lot.id}`;
    group.add(mesh);
    const s = { mesh, canvas, tex, key: '' };
    signs.set(lot.id, s);
    return s;
  }
  function placeStall(lot: Lot, f: LotFront) {
    const color = new THREE.Color(shopOf(lot.owner)?.brand?.color ?? '#5b6170');
    const root = buildStall(color);
    root.position.set(f.x, ground(f.x, f.z), f.z);
    root.rotation.y = Math.atan2(f.nx, f.nz);
    group.add(root);
    // The stall's own small sign above the awning.
    const canvas = document.createElement('canvas');
    canvas.width = SIGN_W; canvas.height = SIGN_H;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    mesh.position.set(0, 3.25, 0.75);
    root.add(mesh);
    // The same sign on the back, so it reads the right way round from either side of the row.
    const back = new THREE.Mesh(mesh.geometry, mesh.material);
    back.position.set(0, 3.25, 0.73);
    back.rotation.y = Math.PI;
    root.add(back);
    signs.set(lot.id, { mesh, canvas, tex, key: '' });
    stalls.set(lot.id, { root, key: color.getHexString() });
  }

  /** Signs, stall colours and queues, from the current snapshot. */
  function sync() {
    const city = tycoon();
    if (!city) return;
    pending = false;
    const served = new Map<string, number>();
    for (const lot of city.lots) {
      const shop = shopOf(lot.owner);
      if (shop?.today) served.set(lot.cat, Math.max(served.get(lot.cat) ?? 1, shop.today.served));
    }
    let used = 0;
    for (const lot of city.lots) {
      const f = lotFrontOf(earth, lot);
      if (!f) { pending = true; continue; }
      if (lot.key == null && !stalls.has(lot.id)) placeStall(lot, f);
      if (lot.key == null) {
        const want = new THREE.Color(shopOf(lot.owner)?.brand?.color ?? '#5b6170').getHexString();
        const st = stalls.get(lot.id)!;
        if (st.key !== want) {
          group.remove(st.root);
          signs.delete(lot.id);
          stalls.delete(lot.id);
          placeStall(lot, f);
        }
      }
      const sign = signs.get(lot.id) ?? placeSign(lot, f);
      const shop = shopOf(lot.owner);
      const key = `${lot.owner ?? ''}|${shop?.brand?.name ?? ''}|${shop?.brand?.slogan ?? ''}|${shop?.brand?.color ?? ''}|${document.documentElement.lang}`;
      if (sign.key !== key) { drawSign(sign.canvas, lot); sign.tex.needsUpdate = true; sign.key = key; }
      // Queue: up to ten people, scaled to the best shop of the same trade yesterday.
      const n = shop?.today?.served ? Math.max(1, Math.round((shop.today.served / (served.get(lot.cat) ?? 1)) * 10)) : 0;
      const side = lot.key == null ? 1 : (lot.id.charCodeAt(lot.id.length - 1) % 2 ? 1 : -1);
      for (let i = 0; i < n && used < queue.members.length; i++, used++) {
        const m = queue.members[used];
        const along = 0.9 + i * 0.78;
        const out = (lot.key == null ? 1.6 : 1.3) + (i % 2 ? 0.12 : -0.08);
        const x = f.x + f.nx * out + f.tx * side * (i ? along : 0) + (i ? 0 : f.nx * 0.2);
        const z = f.z + f.nz * out + f.tz * side * (i ? along : 0) + (i ? 0 : f.nz * 0.2);
        m.pos.set(x, ground(x, z), z);
        // The first in line faces the door; the rest face the person ahead.
        m.yaw = i === 0 ? Math.atan2(-f.nx, -f.nz) : Math.atan2(-f.tx * side, -f.tz * side) + (Math.random() - 0.5) * 0.4;
        m.visible = true; m.fade = 1;
      }
    }
    for (let i = used; i < queue.members.length; i++) queue.members[i].visible = false;
  }
  onTycoon(sync);
  let retry = 0;
  return {
    /** Per frame: draw only in the city view; keep retrying lots whose map tiles are still streaming. */
    update(dt: number, visible: boolean) {
      group.visible = visible;
      if (!visible) return;
      retry -= dt;
      if (pending && retry <= 0) { retry = 2; sync(); }
      queue.update(dt);
    },
    sync,
  };
}
