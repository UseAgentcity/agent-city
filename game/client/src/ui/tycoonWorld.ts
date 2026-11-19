// Times Square Tycoon in the 3D city: a lit sign over every lot (the tenant's brand, or "for lease"), a
// queue at the door that grows with yesterday's trade, and wooden stalls for the Bryant Park market.
// Everything is read from the public city snapshot and redrawn only when it changes.
import * as THREE from 'three';
import { Crowd } from '../earth/crowd.ts';
import type { EarthApi } from '../earth/index.ts';
import { rawCanvases, t } from '../i18n.ts';
import { catName, coins, onTycoon, priceName, shopOf, tierName, tycoon, type Lot } from './tycoon.ts';

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
  rawCanvases.add(c);
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

// ---------- sidewalk totems: one lit sign per shop at eye level, clear of screens and awnings ----------
const TOTEM_W = 512, TOTEM_H = 1024;
const FONT = 'Inter, "PingFang SC", "Microsoft YaHei", Arial, sans-serif';
/** Breaks a brand name over at most two lines that fit the totem. */
function lines(g: CanvasRenderingContext2D, text: string, width: number): string[] {
  if (g.measureText(text).width <= width) return [text];
  const words = text.includes(' ') ? text.split(' ') : [...text];
  const join = text.includes(' ') ? ' ' : '';
  let a = '';
  for (let i = 0; i < words.length; i++) {
    const next = a ? a + join + words[i] : words[i];
    if (g.measureText(next).width > width && a) return [a, words.slice(i).join(join)];
    a = next;
  }
  return [a];
}
function drawTotem(c: HTMLCanvasElement, lot: Lot) {
  rawCanvases.add(c);
  const g = c.getContext('2d')!;
  const shop = shopOf(lot.owner);
  const color = shop?.brand?.color ?? '#f0b90b';
  g.clearRect(0, 0, TOTEM_W, TOTEM_H);
  const bg = g.createLinearGradient(0, 0, 0, TOTEM_H);
  bg.addColorStop(0, '#11141b'); bg.addColorStop(1, '#07080c');
  g.fillStyle = bg; g.fillRect(0, 0, TOTEM_W, TOTEM_H);
  // Trade band.
  g.fillStyle = shop ? color : '#2a2f3a'; g.fillRect(0, 0, TOTEM_W, 118);
  g.fillStyle = shop ? '#0b0d12' : '#f0b90b'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `800 50px ${FONT}`; g.fillText(catName(lot.cat), TOTEM_W / 2, 62);
  if (!shop) {
    g.fillStyle = '#f0b90b';
    g.font = `900 120px ${FONT}`; g.fillText(t('招租', 'FOR'), TOTEM_W / 2, 330);
    g.font = `900 ${t('80px', '120px')} ${FONT}`; g.fillText(t('FOR LEASE', 'LEASE'), TOTEM_W / 2, 470);
    g.fillStyle = '#c9d1dc'; g.font = `600 36px ${FONT}`;
    g.fillText(tierName(lot.tier), TOTEM_W / 2, 600);
    g.fillText(t(`日租 ${coins(lot.reserve)} 起`, `from ${coins(lot.reserve)}/day`), TOTEM_W / 2, 656);
    g.strokeStyle = 'rgba(240,185,11,.6)'; g.lineWidth = 4; g.setLineDash([18, 12]); g.strokeRect(36, 740, TOTEM_W - 72, 200); g.setLineDash([]);
    g.fillStyle = '#f4f1e8'; g.font = `700 38px ${FONT}`;
    g.fillText(t('派你的 Agent', 'Send your Agent'), TOTEM_W / 2, 812);
    g.fillText(t('来这里开店', 'to open here'), TOTEM_W / 2, 870);
    return;
  }
  // Brand.
  const name = shop.brand?.name ?? shop.name;
  g.fillStyle = '#ffffff'; g.shadowColor = color; g.shadowBlur = 30;
  let px = 96;
  g.font = `900 ${px}px ${FONT}`;
  let ls = lines(g, name, TOTEM_W - 60);
  while ((ls.length > 2 || ls.some((l) => g.measureText(l).width > TOTEM_W - 60)) && px > 44) { px -= 6; g.font = `900 ${px}px ${FONT}`; ls = lines(g, name, TOTEM_W - 60); }
  ls.slice(0, 2).forEach((l, i) => g.fillText(l, TOTEM_W / 2, (ls.length > 1 ? 225 : 270) + i * (px + 8)));
  g.shadowBlur = 0;
  if (shop.brand?.slogan) {
    g.fillStyle = 'rgba(255,255,255,.78)'; g.font = `600 34px ${FONT}`;
    g.fillText(`「${shop.brand.slogan}」`, TOTEM_W / 2, 400, TOTEM_W - 50);
  }
  g.fillStyle = color; g.fillRect(60, 455, TOTEM_W - 120, 4);
  // Yesterday, in one big number.
  const served = shop.today?.served;
  g.fillStyle = '#8d96a5'; g.font = `600 32px ${FONT}`; g.fillText(t('昨天的客人', 'Served yesterday'), TOTEM_W / 2, 520);
  g.fillStyle = '#f4f1e8'; g.font = `900 120px ${FONT}`; g.fillText(served != null ? served.toLocaleString('en-US') : '—', TOTEM_W / 2, 625);
  const lost = shop.today ? shop.today.customers - shop.today.served : 0;
  if (lost > 0) { g.fillStyle = '#f6465d'; g.font = `700 30px ${FONT}`; g.fillText(t(`缺货流失 ${lost} 位`, `${lost} turned away`), TOTEM_W / 2, 712); }
  // Price and reputation chips.
  const chip = (x: number, label: string) => {
    g.font = `700 32px ${FONT}`;
    const w = g.measureText(label).width + 40;
    g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.roundRect(x - w / 2, 760, w, 58, 29); g.fill();
    g.fillStyle = '#f4f1e8'; g.fillText(label, x, 790);
  };
  chip(TOTEM_W * 0.3, priceName(shop.price));
  chip(TOTEM_W * 0.7, `★ ${shop.rep.toFixed(2)}`);
  // Owner.
  g.fillStyle = color; g.font = `700 34px ${FONT}`; g.fillText(shop.name, TOTEM_W / 2, 900, TOTEM_W - 60);
  g.fillStyle = '#5b6170'; g.font = `600 24px ${FONT}`; g.fillText(t('由 Agent 经营', 'Run by an Agent'), TOTEM_W / 2, 950);
}

/** Which way along the sidewalk a lot's queue runs (the totem stands on the other side of the door). */
const queueSide = (lot: Lot) => (lot.key == null ? 1 : (lot.id.charCodeAt(lot.id.length - 1) % 2 ? 1 : -1));

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

  interface Sign { mesh: THREE.Mesh; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; key: string; glow?: THREE.MeshBasicMaterial; mat?: THREE.MeshBasicMaterial; totem?: boolean }
  const signs = new Map<string, Sign>();
  const stalls = new Map<string, { root: THREE.Group; key: string }>();
  let pending = true;

  /** A lit sidewalk totem beside the door, plus a brand-coloured mat on the pavement. */
  function placeSign(lot: Lot, f: LotFront) {
    const canvas = document.createElement('canvas');
    canvas.width = TOTEM_W; canvas.height = TOTEM_H;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const root = new THREE.Group();
    root.name = `tycoon-sign:${lot.id}`;
    const side = -queueSide(lot);
    const x = f.x + f.nx * 1.5 + f.tx * side * 1.9, z = f.z + f.nz * 1.5 + f.tz * side * 1.9;
    root.position.set(x, ground(x, z), z);
    root.rotation.y = Math.atan2(f.nx, f.nz);
    root.scale.setScalar(1.25);
    const frame = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.4, metalness: 0.6 });
    const glow = new THREE.MeshBasicMaterial({ color: 0xf0b90b, toneMapped: false });
    const box = (m: THREE.Material, w: number, h: number, d: number, px: number, py: number, pz: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(px, py, pz); b.castShadow = m === frame; root.add(b);
      return b;
    };
    box(frame, 1.25, 0.14, 0.6, 0, 0.07, 0); // plinth
    box(frame, 1.12, 2.5, 0.28, 0, 1.39, 0); // body
    box(glow, 1.14, 0.06, 0.3, 0, 2.67, 0); // top light
    for (const sx of [-0.57, 0.57]) box(glow, 0.03, 2.3, 0.3, sx, 1.4, 0); // edge lights
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 1.96), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    screen.position.set(0, 1.45, 0.145);
    root.add(screen);
    // Brand mat by the door: picks the Agent-run shops out from the street and from the air.
    const mat = new THREE.MeshBasicMaterial({ color: 0xf0b90b, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false });
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.4), mat);
    rug.rotation.x = -Math.PI / 2;
    const rx = f.x + f.nx * 0.9, rz = f.z + f.nz * 0.9;
    rug.position.set(rx - x, ground(rx, rz) - root.position.y + 0.03, rz - z);
    rug.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), -root.rotation.y);
    rug.position.divideScalar(root.scale.x); // the root is scaled up; keep the mat where it belongs on the pavement
    root.add(rug);
    group.add(root);
    const s: Sign = { mesh: screen, canvas, tex, key: '', glow, mat, totem: true };
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
      const key = `${lot.owner ?? ''}|${shop?.brand?.name ?? ''}|${shop?.brand?.slogan ?? ''}|${shop?.brand?.color ?? ''}|${shop?.today?.served ?? ''}|${shop?.price ?? ''}|${shop?.rep ?? ''}|${document.documentElement.lang}`;
      if (sign.key !== key) {
        if (sign.totem) drawTotem(sign.canvas, lot); else drawSign(sign.canvas, lot);
        sign.tex.needsUpdate = true;
        sign.key = key;
        const c = new THREE.Color(shop?.brand?.color ?? '#5b6170');
        sign.glow?.color.copy(shop ? c : new THREE.Color('#f0b90b'));
        if (sign.mat) { sign.mat.color.copy(c); sign.mat.opacity = shop ? 0.45 : 0.18; }
      }
      // Queue: up to ten people, scaled to the best shop of the same trade yesterday.
      const n = shop?.today?.served ? Math.max(1, Math.round((shop.today.served / (served.get(lot.cat) ?? 1)) * 10)) : 0;
      const side = queueSide(lot);
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
