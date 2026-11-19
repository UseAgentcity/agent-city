// Each district dressed for what it sells: Broadway marquees with chasing bulbs over the theatres, neon
// blade signs on the bars, and festoon lights strung along the Bryant Park market with a gateway at the end.
// Names come from the tenant Agents and are redrawn when the city snapshot changes.
import * as THREE from 'three';
import { rawCanvases, t } from '../i18n.ts';
import { shopOf, tokensShort, type Lot } from './tycoon.ts';
import type { LotFront } from './tycoonWorld.ts';

const FONT = 'Inter, "PingFang SC", "Microsoft YaHei", Arial, sans-serif';
const MAX_BULBS = 2400;

function fitFont(g: CanvasRenderingContext2D, text: string, weight: number, max: number, width: number) {
  let size = max;
  g.font = `${weight} ${size}px ${FONT}`;
  while (size > 14 && g.measureText(text).width > width) { size -= 4; g.font = `${weight} ${size}px ${FONT}`; }
  return size;
}

function drawMarquee(c: HTMLCanvasElement, lot: Lot) {
  rawCanvases.add(c);
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height;
  const shop = shopOf(lot.owner);
  g.fillStyle = '#fbf6e9'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#0d0d10'; g.fillRect(14, 14, W - 28, H - 28);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#f5c542';
  g.font = `800 ${Math.round(H * 0.13)}px ${FONT}`;
  g.fillText(shop ? t('今 晚 开 演  ·  NOW PLAYING', 'NOW PLAYING') : t('剧 院 招 租', 'THEATRE FOR LEASE'), W / 2, H * 0.19);
  const name = shop ? (shop.brand?.name ?? shop.name).toUpperCase() : t('虚位以待', 'YOUR SHOW HERE');
  fitFont(g, name, 900, Math.round(H * 0.42), W - 90);
  g.fillStyle = '#fffaf0';
  g.shadowColor = '#ffd76a'; g.shadowBlur = 18;
  g.fillText(name, W / 2, H * 0.53);
  g.shadowBlur = 0;
  const sub = shop ? (shop.brand?.slogan || shop.memo || '') : t(`租约 ${tokensShort(lot.leaseReserve)} 代币起 · 派你的 Agent 来演`, `Lease from ${tokensShort(lot.leaseReserve)} tokens · send your Agent`);
  if (sub) {
    g.fillStyle = '#e6c46b';
    fitFont(g, sub, 600, Math.round(H * 0.13), W - 100);
    g.fillText(sub, W / 2, H * 0.84);
  }
}

function drawBlade(c: HTMLCanvasElement, lot: Lot) {
  rawCanvases.add(c);
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height;
  const shop = shopOf(lot.owner);
  const color = shop?.brand?.color ?? '#f0b90b';
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#0a0b10'; g.fillRect(0, 0, W, H);
  // Neon tube outline.
  g.strokeStyle = color; g.lineWidth = 10; g.shadowColor = color; g.shadowBlur = 30;
  g.strokeRect(22, 22, W - 44, H - 44);
  // The name runs down the blade, read with the head tilted, like a real one.
  const name = shop ? (shop.brand?.name ?? shop.name).toUpperCase() : t('招租', 'FOR LEASE');
  g.save();
  g.translate(W / 2, H / 2); g.rotate(-Math.PI / 2);
  fitFont(g, name, 900, Math.min(150, W - 80), H - 120);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ffffff'; g.shadowColor = color; g.shadowBlur = 40;
  g.fillText(name, 0, 0);
  g.fillText(name, 0, 0);
  g.restore();
  g.shadowBlur = 0;
}

function drawGate(c: HTMLCanvasElement) {
  rawCanvases.add(c);
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height;
  g.fillStyle = '#16301f'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#f2d27a'; g.lineWidth = 8; g.strokeRect(12, 12, W - 24, H - 24);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#fff6dc';
  g.font = `900 78px ${FONT}`;
  g.fillText(t('布莱恩特公园 冬季集市', 'WINTER MARKET'), W / 2, H * 0.42);
  g.fillStyle = '#f2d27a';
  g.font = `700 34px ${FONT}`;
  g.fillText(t('Agent 摆摊 · 免费入场', 'Bryant Park · Agent stalls'), W / 2, H * 0.76);
}

/** Local (x up z) on a lot's front to world, with z pointing out of the building. */
function onFront(f: LotFront, x: number, y: number, z: number, base: number) {
  // rotation.y = atan2(nx, nz): local x → (nz, -nx), local z → (nx, nz).
  return new THREE.Vector3(f.x + f.nz * x + f.nx * z, base + y, f.z - f.nx * x + f.nz * z);
}

export function installTycoonDecor(group: THREE.Group, ground: (x: number, z: number) => number) {
  // One instanced mesh for every bulb in the city; each frame sets its brightness.
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), MAX_BULBS);
  bulbs.count = 0;
  bulbs.frustumCulled = false;
  bulbs.setColorAt(0, new THREE.Color());
  group.add(bulbs);
  interface Bulb { base: THREE.Color; mode: 'chase' | 'twinkle'; phase: number }
  const meta: Bulb[] = [];
  const m4 = new THREE.Matrix4();
  const addBulb = (p: THREE.Vector3, color: THREE.ColorRepresentation, mode: Bulb['mode'], phase: number, size = 1) => {
    if (bulbs.count >= MAX_BULBS) return;
    m4.makeScale(size, size, size).setPosition(p);
    bulbs.setMatrixAt(bulbs.count, m4);
    meta.push({ base: new THREE.Color(color), mode, phase });
    bulbs.count++;
    bulbs.instanceMatrix.needsUpdate = true;
  };
  const wire = new THREE.LineBasicMaterial({ color: 0x1b1b1b });
  /** A sagging string of bulbs between two points. */
  const festoon = (a: THREE.Vector3, b: THREE.Vector3, sag: number, every = 0.45) => {
    const n = Math.max(2, Math.round(a.distanceTo(b) / every));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const p = a.clone().lerp(b, k);
      p.y -= sag * 4 * k * (1 - k);
      pts.push(p);
      if (i > 0 && i < n) addBulb(p.clone().setY(p.y - 0.07), i % 3 === 0 ? 0xfff1c4 : 0xffd27a, 'twinkle', Math.random() * 10);
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wire));
  };

  interface Board { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; key: string; draw: (c: HTMLCanvasElement, lot: Lot) => void }
  const boards = new Map<string, Board>();
  const board = (w: number, h: number, draw: Board['draw']) => {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return { canvas, tex, key: '', draw };
  };
  const dark = new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.6, metalness: 0.4 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xb8913a, roughness: 0.4, metalness: 0.7 });

  /** A Broadway marquee over the theatre door: a lit name board with a chasing bulb frame. */
  function marquee(lot: Lot, f: LotFront) {
    const W = Math.max(4.2, Math.min(7.6, f.wall - 1.0)), D = 2.0, Y = 4.0, Hh = 1.5;
    const root = new THREE.Group();
    const base = ground(f.x, f.z);
    root.position.set(f.x, base, f.z);
    root.rotation.y = Math.atan2(f.nx, f.nz);
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, Hh, D), dark);
    body.position.set(0, Y + Hh / 2, D / 2 + 0.05);
    root.add(body);
    // Soffit glow: the warm underside you walk beneath.
    const soffit = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.2, D - 0.2), new THREE.MeshBasicMaterial({ color: 0xffe2a0, toneMapped: false }));
    soffit.rotation.x = Math.PI / 2;
    soffit.position.set(0, Y - 0.01, D / 2 + 0.05);
    root.add(soffit);
    const b = board(1024, Math.round(1024 * (Hh - 0.22) / (W - 0.3)), drawMarquee);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.3, Hh - 0.22), new THREE.MeshBasicMaterial({ map: b.tex, toneMapped: false }));
    face.position.set(0, Y + Hh / 2, D + 0.06);
    root.add(face);
    for (const s of [-1, 1]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2), gold);
      rod.position.set(s * (W / 2 - 0.3), Y + Hh + 0.75, D * 0.55);
      rod.rotation.x = -0.75;
      root.add(rod);
    }
    group.add(root);
    boards.set(lot.id, b);
    // Bulbs round the face, chasing.
    const per = 0.22;
    const along = (x0: number, y0: number, x1: number, y1: number, start: number) => {
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / per));
      for (let i = 0; i < n; i++) {
        const k = i / n;
        addBulb(onFront(f, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, D + 0.1, base), 0xffe6a8, 'chase', start + i, 0.9);
      }
      return start + n;
    };
    const x = W / 2 - 0.05, lo = Y + 0.04, hi = Y + Hh - 0.04;
    let k = 0;
    k = along(-x, hi, x, hi, k); k = along(x, hi, x, lo, k); k = along(x, lo, -x, lo, k); along(-x, lo, -x, hi, k);
    // And a row under the soffit edge, for the glow on the pavement.
    for (let i = 0; i < Math.round(W / 0.4); i++) addBulb(onFront(f, -W / 2 + 0.2 + i * 0.4, Y - 0.06, D - 0.05, base), 0xfff3d0, 'twinkle', i * 0.7, 0.8);
  }

  /** A neon blade sign sticking out from a bar's wall, above head height. */
  function blade(lot: Lot, f: LotFront, side: number) {
    const root = new THREE.Group();
    const base = ground(f.x, f.z);
    // Along the wall, on the totem's side, above it.
    const d = side * Math.min(2.8, f.wall / 2 - 0.4);
    root.position.set(f.x + f.tx * d, base, f.z + f.tz * d);
    // Face the blade along the street: perpendicular to the wall.
    root.rotation.y = Math.atan2(f.nx, f.nz) + Math.PI / 2;
    const b = board(320, 1024, drawBlade);
    const geo = new THREE.PlaneGeometry(1.15, 3.6);
    const mat = new THREE.MeshBasicMaterial({ map: b.tex, toneMapped: false, side: THREE.DoubleSide });
    const sign = new THREE.Mesh(geo, mat);
    // Local x now runs out of the wall (negative-to-positive depends on the turn): offset to stand proud of it.
    sign.position.set(-0.85, 5.5, 0);
    root.add(sign);
    for (const y of [3.8, 7.2]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.05), dark);
      arm.position.set(-0.8, y, 0);
      root.add(arm);
    }
    group.add(root);
    boards.set(lot.id, b);
    blades.push({ mat, phase: Math.random() * 20 });
  }
  const blades: { mat: THREE.MeshBasicMaterial; phase: number }[] = [];

  /** The market: festoons between stall tops, one along the front of each, and a gateway at the west end. */
  let marketDone = false;
  function market(stalls: { lot: Lot; f: LotFront }[]) {
    marketDone = true;
    const row = stalls.slice().sort((a, b) => a.lot.lon - b.lot.lon);
    const top = (s: { f: LotFront }, x: number, z = 0.6) => onFront(s.f, x, 3.05, z, ground(s.f.x, s.f.z));
    for (let i = 0; i < row.length; i++) {
      const a = row[i];
      // Across the stall front.
      festoon(top(a, -1.18), top(a, 1.18), 0.25, 0.3);
      if (i + 1 < row.length) {
        const b = row[i + 1];
        const pa = top(a, -1.18), pb = top(b, 1.18), qa = top(a, 1.18), qb = top(b, -1.18);
        // Join the nearer corners; which side is nearer depends on which way the stall faces.
        const [u, v] = pa.distanceTo(pb) < qa.distanceTo(qb) ? [pa, pb] : pa.distanceTo(qb) < qa.distanceTo(pb) ? [pa, qb] : [qa, pb];
        festoon(u, v, 0.9);
        // A second string zig-zagging over the walkway in front.
        festoon(onFront(a.f, 0, 3.4, 4.2, ground(a.f.x, a.f.z)), onFront(b.f, 0, 3.4, 4.2, ground(b.f.x, b.f.z)), 0.7);
      }
      // Warm lamp under each awning.
      const lamp = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.9), new THREE.MeshBasicMaterial({ color: 0xffd894, toneMapped: false, transparent: true, opacity: 0.85 }));
      lamp.position.copy(onFront(a.f, 0, 2.5, 0.3, ground(a.f.x, a.f.z)));
      lamp.rotation.order = 'YXZ'; lamp.rotation.y = Math.atan2(a.f.nx, a.f.nz); lamp.rotation.x = Math.PI / 2 - 0.32;
      group.add(lamp);
    }
    // Gateway at the west end, spanning the walkway and facing down the row.
    const first = row[0], second = row[1] ?? row[0];
    const dirx = first.f.x - second.f.x, dirz = first.f.z - second.f.z, dl = Math.hypot(dirx, dirz) || 1;
    const ux = dirx / dl, uz = dirz / dl;
    const cx = first.f.x + ux * 6 + first.f.nx * 3, cz = first.f.z + uz * 6 + first.f.nz * 3;
    const gate = new THREE.Group();
    gate.position.set(cx, ground(cx, cz), cz);
    gate.rotation.y = Math.atan2(ux, uz);
    const green = new THREE.MeshStandardMaterial({ color: 0x1d3a27, roughness: 0.6 });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, 4.4, 0.28), green);
      post.position.set(s * 2.6, 2.2, 0);
      gate.add(post);
    }
    const b = board(1024, 220, () => drawGate(b.canvas));
    drawGate(b.canvas);
    const beamMat = new THREE.MeshBasicMaterial({ map: b.tex, toneMapped: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.2), beamMat);
    beam.position.set(0, 4.3, 0);
    gate.add(beam);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(5.8, 1.35, 0.12), green);
    frame.position.set(0, 4.3, 0);
    frame.scale.z = 0.5;
    gate.add(frame);
    beam.position.z = 0.05;
    const back = beam.clone(); back.position.z = -0.05; back.rotation.y = Math.PI; gate.add(back);
    group.add(gate);
    gate.updateMatrixWorld(true);
    for (let i = 0; i <= 14; i++) {
      const p = new THREE.Vector3(-2.75 + i * (5.5 / 14), 5.0, 0).applyMatrix4(gate.matrixWorld);
      addBulb(p, 0xfff0c0, 'chase', i, 1.1);
    }
    gateLang = document.documentElement.lang;
    gateBoard = b;
  }
  let gateBoard: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } | null = null;
  let gateLang = '';

  const placed = new Set<string>();
  const stalls = new Map<string, { lot: Lot; f: LotFront }>();
  let marketSize = 0;
  return {
    /** Called for every lot whose front is known, on each snapshot. */
    sync(lot: Lot, f: LotFront, totemSide: number) {
      if (lot.key == null) { stalls.set(lot.id, { lot, f }); return; }
      if (!placed.has(lot.id)) {
        placed.add(lot.id);
        if (lot.cat === 'theatre') marquee(lot, f);
        else if (lot.cat === 'bar') blade(lot, f, totemSide);
      }
      const b = boards.get(lot.id);
      if (!b) return;
      const shop = shopOf(lot.owner);
      const key = `${lot.owner ?? ''}|${shop?.brand?.name ?? ''}|${shop?.brand?.slogan ?? ''}|${shop?.brand?.color ?? ''}|${shop?.memo ?? ''}|${document.documentElement.lang}`;
      if (b.key === key) return;
      b.key = key;
      b.draw(b.canvas, lot);
      b.tex.needsUpdate = true;
    },
    /** After a pass over every lot: the market is strung once all its stalls are known. */
    done(total: number) {
      if (!marketDone && stalls.size && stalls.size === total) market([...stalls.values()]);
      marketSize = stalls.size;
      if (gateBoard && gateLang !== document.documentElement.lang) { gateLang = document.documentElement.lang; drawGate(gateBoard.canvas); gateBoard.tex.needsUpdate = true; }
    },
    get marketSize() { return marketSize; },
    update(time: number) {
      const c = new THREE.Color();
      for (let i = 0; i < bulbs.count; i++) {
        const b = meta[i];
        const k = b.mode === 'chase'
          ? ((Math.floor(time * 7) - b.phase) % 3 + 3) % 3 === 0 ? 0.35 : 1.25
          : 0.85 + 0.25 * Math.sin(time * 2.1 + b.phase) + (Math.sin(time * 17 + b.phase * 3) > 0.995 ? -0.5 : 0);
        bulbs.setColorAt(i, c.copy(b.base).multiplyScalar(k));
      }
      if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
      // The odd neon stutter.
      for (const bl of blades) {
        const s = Math.sin(time * 0.7 + bl.phase);
        const flick = s > 0.985 && Math.sin(time * 40) > 0 ? 0.45 : 1;
        bl.mat.color.setScalar(flick);
      }
    },
  };
}
