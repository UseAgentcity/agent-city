// Times Square Tycoon in the 3D city: a lit sign over every lot (the tenant's brand, or "for lease"), a
// queue at the door that grows with yesterday's trade, and wooden stalls for the Bryant Park market.
// Everything is read from the public city snapshot and redrawn only when it changes.
import * as THREE from 'three';
import { Crowd } from '../earth/crowd.ts';
import type { EarthApi } from '../earth/index.ts';
import { rawCanvases, t } from '../i18n.ts';
import { catName, coins, onTycoon, priceName, shopOf, tierName, tokensShort, tycoon, type Lot } from './tycoon.ts';

/** A lot's door on the street: the point, the outward normal and the wall tangent (world x/z). */
export interface LotFront { x: number; z: number; nx: number; nz: number; tx: number; tz: number; wall: number; /** The building's own map name, which the game shows as the Agent's shop instead. */ poi?: string }

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
      best = { x, z, nx, nz, tx: vx / len, tz: vz / len, wall: len, poi: hit.fp.poi?.name };
    }
    front = best;
  }
  fronts.set(lot.id, front);
  return front;
}

/** The lot whose door is within `r` metres of (x, z), if its front is known. */
export function lotNear(earth: EarthApi, x: number, z: number, r = 18): Lot | null {
  let best: Lot | null = null, bestD = r;
  for (const lot of tycoon()?.lots ?? []) {
    const f = lotFrontOf(earth, lot);
    if (!f) continue;
    const d = Math.hypot(f.x - x, f.z - z);
    if (d < bestD) { bestD = d; best = lot; }
  }
  return best;
}
/** A lot whose building carries this map name (so a label naming that building names the shop instead). */
export function lotByBuildingName(earth: EarthApi, name: string): Lot | null {
  for (const lot of tycoon()?.lots ?? []) if (lotFrontOf(earth, lot)?.poi === name) return lot;
  return null;
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
    const sub = t(`${catName(lot.cat)} · ${lot.leaseReserve ? `租约 ${tokensShort(lot.leaseReserve)} 代币起` : '免费摆摊'} · 派你的 Agent 来开店`, `${catName(lot.cat)} · ${lot.leaseReserve ? `lease from ${tokensShort(lot.leaseReserve)} tokens` : 'free stall'} · send your Agent`);
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
    g.fillText(lot.leaseReserve ? t(`租约 ${tokensShort(lot.leaseReserve)} 代币起`, `lease from ${tokensShort(lot.leaseReserve)} tokens`) : t('免费摆摊', 'free stall'), TOTEM_W / 2, 656);
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
  chip(TOTEM_W * 0.7, t(`综合 ${shop.score}`, `Score ${shop.score}`));
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
  // ---- shoppers: a line at each door that moves, people going in, people coming out with a bag ----
  const queue = new Crowd(220);
  group.add(queue.group);
  for (const m of queue.members) { m.pose = 'stand'; m.speed = 0; m.scale = 0.94 + Math.random() * 0.12; m.visible = false; m.fade = 0; }
  interface Mem { busy: boolean; path: { x: number; z: number }[]; face: number | null; fadeTo: number; release: boolean; fadeAtEnd: boolean }
  const mem: Mem[] = queue.members.map(() => ({ busy: false, path: [], face: null, fadeTo: 0, release: false, fadeAtEnd: false }));
  interface Line { lot: Lot; f: LotFront; side: number; people: number[]; want: number; every: number; timer: number }
  const lineByLot = new Map<string, Line>();
  const WALK = 1.25;
  const take = () => {
    const i = mem.findIndex((m) => !m.busy);
    if (i < 0) return null;
    Object.assign(mem[i], { busy: true, path: [], face: null, fadeTo: 1, release: false, fadeAtEnd: false });
    const m = queue.members[i];
    m.visible = true; m.fade = 0; m.carry = false; m.speed = 0;
    return i;
  };
  const put = (i: number, x: number, z: number) => queue.members[i].pos.set(x, ground(x, z), z);
  /** Where the i-th person in a line stands, and which way they face (the door, or the person ahead). */
  function slot(l: Line, i: number) {
    const { f, side } = l;
    const along = i ? 0.9 + i * 0.78 : 0;
    const out = (l.lot.key == null ? 1.6 : 1.3) + (i % 2 ? 0.12 : -0.08) + (i ? 0 : 0.2);
    return {
      x: f.x + f.nx * out + f.tx * side * along, z: f.z + f.nz * out + f.tz * side * along,
      face: i === 0 ? Math.atan2(-f.nx, -f.nz) : Math.atan2(-f.tx * l.side, -f.tz * l.side),
    };
  }
  function join(l: Line) {
    const i = take();
    if (i == null) return;
    const s = slot(l, l.people.length), far = slot(l, l.people.length + 5);
    put(i, far.x, far.z);
    mem[i].path = [{ x: s.x, z: s.z }];
    mem[i].face = s.face;
    l.people.push(i);
  }
  function leaveBack(l: Line) {
    const i = l.people.pop()!;
    const p = queue.members[i].pos, far = slot(l, l.people.length + 6);
    Object.assign(mem[i], { path: [{ x: (p.x + far.x) / 2, z: (p.z + far.z) / 2 }], fadeTo: 0, release: true, face: null });
  }
  /** The person at the front goes in; everyone steps up; a shopper comes out with a bag. */
  function serve(l: Line) {
    const i = l.people.shift()!;
    const { f } = l;
    Object.assign(mem[i], { path: [{ x: f.x + f.nx * 0.15, z: f.z + f.nz * 0.15 }], fadeTo: 0, release: true, face: null });
    l.people.forEach((k, j) => { const s = slot(l, j); mem[k].path = [{ x: s.x, z: s.z }]; mem[k].face = s.face; });
    const out = take();
    if (out != null) {
      const away = -l.side;
      put(out, f.x + f.nx * 0.2, f.z + f.nz * 0.2);
      queue.members[out].carry = true;
      mem[out].path = [
        { x: f.x + f.nx * 1.7 + f.tx * away * 0.8, z: f.z + f.nz * 1.7 + f.tz * away * 0.8 },
        { x: f.x + f.nx * 1.9 + f.tx * away * 12, z: f.z + f.nz * 1.9 + f.tz * away * 12 },
      ];
      mem[out].fadeAtEnd = true;
    }
  }
  function stepPeople(dt: number) {
    for (let i = 0; i < mem.length; i++) {
      const st = mem[i];
      if (!st.busy) continue;
      const m = queue.members[i];
      if (st.path.length) {
        const p = st.path[0], dx = p.x - m.pos.x, dz = p.z - m.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.06) st.path.shift();
        else {
          const step = Math.min(d, WALK * dt);
          m.pos.x += (dx / d) * step; m.pos.z += (dz / d) * step;
          m.pos.y = ground(m.pos.x, m.pos.z);
          m.speed = WALK; m.yaw = Math.atan2(dx, dz);
        }
      } else {
        m.speed = 0;
        if (st.face != null) m.yaw = st.face;
        if (st.fadeAtEnd) { st.fadeAtEnd = false; st.fadeTo = 0; st.release = true; }
      }
      m.fade = Math.max(0, Math.min(1, m.fade + Math.sign(st.fadeTo - m.fade) * Math.min(Math.abs(st.fadeTo - m.fade), dt * 1.6)));
      if (st.release && !st.path.length && m.fade <= 0.01) { st.busy = false; m.visible = false; m.carry = false; }
    }
  }
  function stepLines(dt: number) {
    for (const l of lineByLot.values()) {
      while (l.people.length < l.want && mem.some((m) => !m.busy)) join(l);
      while (l.people.length > l.want) leaveBack(l);
      if (!l.people.length) continue;
      l.timer -= dt;
      if (l.timer > 0) continue;
      l.timer = l.every * (0.75 + Math.random() * 0.5);
      serve(l);
    }
  }

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
      // The line: up to nine people, scaled to the best shop of the same trade yesterday; busier shops
      // also serve faster, so people go in and come out more often.
      const ratio = shop?.today?.served ? shop.today.served / (served.get(lot.cat) ?? 1) : 0;
      const want = ratio ? Math.max(1, Math.round(ratio * 9)) : 0;
      let l = lineByLot.get(lot.id);
      if (!l) { l = { lot, f, side: queueSide(lot), people: [], want: 0, every: 6, timer: 2 + Math.random() * 4 }; lineByLot.set(lot.id, l); }
      l.want = want;
      l.every = 9 - 6 * Math.min(1, ratio);
    }
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
      stepLines(dt);
      stepPeople(dt);
      queue.update(dt);
    },
    sync,
  };
}
