// Project HQ entrances: a glass lobby pavilion on the front of the building, the way real office
// towers meet the street. Curtain wall with mullions, sliding (and on big towers revolving) doors that
// open as you walk up, a cantilevered canopy with downlights, halo-lit brushed-metal letters, a
// backlit logo, a street number on the glass, granite paving, planters and bollards, and a lit lobby
// you can see through the glass. Shared by the streaming world (earth/sites.ts) and the classic cities.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Tier } from '../../../shared/types.ts';
import { glowMaterials } from './buildings.ts';
import { shared } from '../engine.ts';
import { planarUV, surface, surfaceMaterial } from '../rooms/surfaces.ts';
import { disposeNpc, makeNpc, type Character } from '../characters.ts';
import { t } from '../i18n.ts';

export function drawTowerMark(g: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  g.save();
  g.translate(x, y);
  g.scale(size / 64, size / 64);
  g.fillStyle = color;
  // Match the sunset skyline mark used in the home page header.
  const sun = new Path2D('M10 33a22 22 0 1 1 44 0v7h-7V30h-6v10h-4V14l-9 9v17h-4V27l-7 4v9h-7z');
  g.fill(sun, 'evenodd');
  g.fillRect(12, 44, 40, 4);
  g.fillRect(19, 52, 26, 3);
  g.restore();
}

export interface EntranceOpts {
  /** Middle of the front wall at ground level, and the unit normal pointing out of it. */
  door: THREE.Vector3;
  out: THREE.Vector3;
  /** Length of the wall the entrance sits on, and how much building there is above the door. */
  wallLen: number;
  maxH: number;
  tier: Tier;
  name: string;
  brand: string;
  /** The square logo plaque (repo logo, or a monogram). */
  logo: THREE.Texture;
  seed: number;
}

interface Dims { W: number; H: number; P: number; revolving: boolean; plinth: boolean; bollards: boolean }
const DIMS: Record<Tier, Dims> = {
  landmark: { W: 20, H: 7.2, P: 3.0, revolving: true, plinth: true, bollards: true },
  tower: { W: 15, H: 6.0, P: 2.6, revolving: true, plinth: true, bollards: true },
  midrise: { W: 10, H: 4.6, P: 2.0, revolving: false, plinth: false, bollards: true },
  small: { W: 6.2, H: 3.6, P: 1.4, revolving: false, plinth: false, bollards: false },
};

/** How far the lobby pavilion sticks out of the wall (stand beyond this to use the doors). */
export function entranceDepth(tier: Tier) { return DIMS[tier].P; }

// ---------- shared materials (one set for every entrance) ----------

let MAT: ReturnType<typeof makeMaterials> | null = null;
function glowMat(color: number, base: number) {
  const m = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, emissive: color, emissiveIntensity: base, roughness: 0.5 });
  m.userData = { base };
  glowMaterials.push(m);
  return m;
}
function makeMaterials() {
  // Walnut paneling, warmly lit (it glows a little more at night, through the glass).
  const walnut = surface('walnut').map.clone();
  walnut.repeat.set(1 / 1.6, 1 / 1.6);
  walnut.needsUpdate = true;
  const lobbyWall = new THREE.MeshStandardMaterial({ map: walnut, color: 0xd8c2a8, roughness: 0.5, emissive: 0x6b4a2c, emissiveIntensity: 0.5, emissiveMap: walnut });
  lobbyWall.userData = { base: 0.5 };
  glowMaterials.push(lobbyWall);
  return {
    frame: new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.85, roughness: 0.32 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xa9bcc6, metalness: 0.1, roughness: 0.03, transparent: true, opacity: 0.26, depthWrite: false,
      side: THREE.DoubleSide, envMapIntensity: 1.8, specularIntensity: 1,
    }),
    lobbyGlass: new THREE.MeshPhysicalMaterial({
      color: 0x86a8c1, roughness: 0.28, transparent: true, opacity: 0.24, depthWrite: false,
      side: THREE.DoubleSide, envMapIntensity: 0.45, specularIntensity: 0.35,
    }),
    portalStone: new THREE.MeshStandardMaterial({ color: 0x252931, roughness: 0.49, metalness: 0.12 }),
    portalBronze: new THREE.MeshStandardMaterial({ color: 0xb58b4d, roughness: 0.43, metalness: 0.55 }),
    stone: new THREE.MeshStandardMaterial({ color: 0xbab4aa, roughness: 0.55, metalness: 0.02 }),
    darkStone: new THREE.MeshStandardMaterial({ color: 0x4d4a46, roughness: 0.35, metalness: 0.05 }),
    polished: new THREE.MeshStandardMaterial({ color: 0xd8d3ca, roughness: 0.12, metalness: 0.05 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x9a968f, roughness: 0.9 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.9, roughness: 0.3 }),
    shrub: new THREE.MeshStandardMaterial({ color: 0x3d5631, roughness: 0.95, flatShading: true }),
    shrub2: new THREE.MeshStandardMaterial({ color: 0x4d6638, roughness: 0.95, flatShading: true }),
    white: new THREE.MeshStandardMaterial({ color: 0xece9e4, roughness: 0.4 }),
    lobbyWall,
    marble: surfaceMaterial('marble'),
    leaf: new THREE.MeshStandardMaterial({ color: 0x3b6e33, roughness: 0.6, side: THREE.DoubleSide }),
    ceilingLight: glowMat(0xfff0d8, 1.6),
    downlight: glowMat(0xfff2dc, 2.4),
    uplight: glowMat(0xffe9c4, 1.4),
    signPlate: new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.42, metalness: 0.35 }),
  };
}

const LIGHT_SHAPES: Partial<Record<'pool' | 'panel', THREE.CanvasTexture>> = {};
/**
 * An additive light that only shows after dark (updateEntrances drives its opacity): a round pool
 * fading out from the middle, or a panel with feathered edges.
 */
function nightLight(color: number, shape: 'pool' | 'panel' = 'pool') {
  let t = LIGHT_SHAPES[shape];
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    // alphaMap reads the green channel, so the mask is opaque grey: black = clear, white = full.
    g.fillStyle = '#000';
    g.fillRect(0, 0, 256, 256);
    if (shape === 'pool') {
      const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      for (let i = 0; i <= 8; i++) { const v = Math.round(255 * (1 - i / 8) ** 2.2); grd.addColorStop(i / 8, `rgb(${v},${v},${v})`); }
      g.fillStyle = grd;
      g.fillRect(0, 0, 256, 256);
    } else {
      g.filter = 'blur(22px)';
      g.fillStyle = '#fff';
      g.fillRect(40, 40, 176, 176);
    }
    t = LIGHT_SHAPES[shape] = new THREE.CanvasTexture(c);
  }
  return new THREE.MeshBasicMaterial({ color, alphaMap: t, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 });
}

/** Collects boxes/cylinders per material and merges them into one mesh per material. */
class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(mat: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    g = g.rotateY(ry).translate(x, y, z);
    const l = this.parts.get(mat) ?? [];
    l.push(g);
    this.parts.set(mat, l);
  }
  /** Box with its base at y. */
  box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) {
    this.add(mat, new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), x, y, z, ry);
  }
  cyl(mat: THREE.Material, r0: number, r1: number, h: number, x: number, y: number, z: number, seg = 12) {
    this.add(mat, new THREE.CylinderGeometry(r0, r1, h, seg).translate(0, h / 2, 0), x, y, z);
  }
  build(parent: THREE.Object3D, shadows = true) {
    for (const [mat, list] of this.parts) {
      const g = mergeGeometries(list, false);
      list.forEach((x) => x.dispose());
      if (!g) continue;
      if (mat === MAT?.marble || mat === MAT?.lobbyWall) planarUV(g);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      const see = mat === MAT?.glass;
      m.castShadow = shadows && !see && mat !== MAT?.downlight && mat !== MAT?.ceilingLight;
      m.receiveShadow = !see;
      if (see) m.renderOrder = 2;
      parent.add(m);
    }
    this.parts.clear();
  }
}

// ---------- textures ----------

/** Brushed-metal letters on a transparent canvas, plus a soft halo version for the backlight. */
function letterTextures(text: string) {
  const W = 2048, Hh = 256;
  const make = (halo: boolean) => {
    const c = document.createElement('canvas');
    c.width = W; c.height = Hh;
    const g = c.getContext('2d')!;
    let size = 170;
    const font = (s: number) => `600 ${s}px Inter, "Helvetica Neue", Arial, sans-serif`;
    g.font = font(size);
    const label = text.toUpperCase();
    const spacing = () => size * 0.08;
    const width = () => g.measureText(label).width + spacing() * (label.length - 1);
    while (width() > W - 80 && size > 50) { size -= 6; g.font = font(size); }
    let x = (W - width()) / 2;
    g.textBaseline = 'middle';
    if (halo) {
      // Used as an alphaMap (green channel): grey glow on opaque black.
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, Hh);
      g.shadowColor = '#fff';
      g.shadowBlur = 26;
      g.fillStyle = '#999';
    } else {
      const grd = g.createLinearGradient(0, Hh / 2 - size / 2, 0, Hh / 2 + size / 2);
      grd.addColorStop(0, '#f2f3f4'); grd.addColorStop(0.45, '#b9bdc1'); grd.addColorStop(0.55, '#d9dcdf'); grd.addColorStop(1, '#8d9196');
      g.fillStyle = grd;
    }
    for (const ch of label) {
      g.fillText(ch, x, Hh / 2 + 6);
      x += g.measureText(ch).width + spacing();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { metal: make(false), halo: make(true) };
}

/** White vinyl street number for the glass above the door. */
function numberTexture(n: number) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.font = '500 72px Inter, "Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 128, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let TOWER_MARK: THREE.CanvasTexture | null = null;
/** The Open World headquarters mark alone on a transparent square. */
export function towerMarkTexture() {
  if (TOWER_MARK) return TOWER_MARK;
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d')!;
  drawTowerMark(g, 80, 80, 864, '#F3BA2F');
  const t = TOWER_MARK = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Width / height of the entrance plaque face; the texture covers the whole face, black plate included. */
export const TOWER_SIGN_ASPECT = 2048 / 472;
let TOWER_SIGN: { sign: THREE.CanvasTexture; halo: THREE.CanvasTexture } | null = null;
/** The plaque face (black plate, mark, wordmark, subtitle) and a soft copy of the gold parts for the night halo. */
export function towerSignTextures() {
  if (TOWER_SIGN) return TOWER_SIGN;
  const make = (halo: boolean) => {
    const c = document.createElement('canvas');
    c.width = 2048; c.height = 472;
    const g = c.getContext('2d')!;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    const sub = 'AGENT HEADQUARTERS  ·  NEW YORK';
    const draw = () => {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.filter = 'none';
      // The halo is an alphaMap (green channel): white glyph glow on opaque black.
      if (halo) {
        g.fillStyle = '#000';
        g.fillRect(0, 0, c.width, c.height);
      } else g.clearRect(0, 0, c.width, c.height);
      const spaced = (px: number) => { (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${px}px`; };
      const wordFont = '800 188px Inter, "Helvetica Neue", Arial, sans-serif';
      const subFont = '600 54px Inter, "Helvetica Neue", Arial, sans-serif';
      g.font = wordFont; spaced(8);
      const wordW = g.measureText('OPEN WORLD').width;
      g.font = subFont; spaced(9);
      const subW = g.measureText(sub).width;
      const mark = 220, gap = 56;
      const content = mark + gap + Math.max(wordW, subW);
      const fit = Math.min(1, 1860 / content);
      const kFit = fit;
      g.setTransform(kFit, 0, 0, kFit, c.width / 2 - content * kFit / 2, c.height / 2 - 224 * kFit);
      const tx = mark + gap;
      g.filter = halo ? 'blur(10px)' : 'none';
      drawTowerMark(g, 0, (448 - mark) / 2, mark, halo ? '#ffffff' : '#F3BA2F');
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.font = wordFont; spaced(8);
      if (!halo) g.fillStyle = '#F3BA2F';
      g.fillText('OPEN WORLD', tx, 230);
      if (!halo) {
        g.font = subFont; spaced(6);
        g.fillStyle = '#ece7da';
        g.fillText(sub, tx + 2, 328);
      }
      t.needsUpdate = true;
    };
    draw();
    void document.fonts?.ready.then(draw);
    return t;
  };
  TOWER_SIGN = { sign: make(false), halo: make(true) };
  return TOWER_SIGN;
}

// ---------- animated doors ----------

interface Leaf { mesh: THREE.Object3D; closedX: number; openX: number }
interface Entry {
  group: THREE.Group;
  at: THREE.Vector3; // world position of the doors
  leaves: Leaf[];
  halo: THREE.MeshBasicMaterial;
  haloMax: number;
  /** Extra after-dark lights (opacity fades in with the night up to the given maximum). */
  nightLights: [THREE.MeshBasicMaterial, number][];
  /** Real lights whose intensity follows the night (the same maximum-at-midnight rule). */
  lamps: [THREE.Light, number][];
  wings: THREE.Object3D | null;
  open: number;
  spin: number;
  attached: boolean;
  /** Hosts standing outside the doors: base yaw (group-local) and whether they've bowed to you yet. */
  hosts: { ch: Character; yaw: number }[];
  welcomed: boolean;
  sayId: string;
  sayT: number;
}

export interface EntranceHooks {
  /** Show a speech bubble at a world position, or remove it (pos null). */
  say(id: string, pos: THREE.Vector3 | null, text: string): void;
}

const HOST_R = 0.55;
const _h = new THREE.Vector3();
const entries: Entry[] = [];

/** Doors slide open when you're close, the revolving door turns; far entrances are hidden. */
export function updateEntrances(dt: number, player: THREE.Vector3, hooks?: EntranceHooks) {
  const night = shared.uNight.value;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!e.group.parent) {
      if (e.attached) { entries.splice(i, 1); for (const h of e.hosts) disposeNpc(h.ch); }
      continue;
    }
    e.attached = true;
    const d = Math.hypot(player.x - e.at.x, player.z - e.at.z);
    e.group.visible = d < 420;
    if (!e.group.visible) continue;
    e.halo.opacity = night * e.haloMax;
    for (const [m, max] of e.nightLights) m.opacity = night * max;
    for (const [l, max] of e.lamps) l.intensity = night * max;
    const want = d < 5 && Math.abs(player.y - e.at.y) < 4 ? 1 : 0;
    e.open += (want - e.open) * Math.min(1, dt * (want ? 3.2 : 1.6));
    for (const l of e.leaves) l.mesh.position.x = l.closedX + (l.openX - l.closedX) * e.open;
    if (e.hosts.length && d < 80) {
      const close = d < 7 && Math.abs(player.y - e.at.y) < 4;
      if (close) { _h.copy(player); e.group.worldToLocal(_h); }
      let pushed = false, nearest: { ch: Character; yaw: number } | null = null, nd = Infinity;
      for (const h of e.hosts) {
        h.ch.mixer.update(dt);
        let want = h.yaw;
        if (close) {
          const p = h.ch.root.position;
          const dx = _h.x - p.x, dz = _h.z - p.z, r = Math.hypot(dx, dz);
          want = Math.atan2(dx, dz);
          if (r < nd) { nd = r; nearest = h; }
          // Hosts are solid: you walk round them, not through them.
          if (r < HOST_R) {
            const k = r > 1e-4 ? HOST_R / r : 0;
            _h.x = r > 1e-4 ? p.x + dx * k : p.x;
            _h.z = r > 1e-4 ? p.z + dz * k : p.z + HOST_R;
            pushed = true;
          }
        }
        const dy = Math.atan2(Math.sin(want - h.ch.root.rotation.y), Math.cos(want - h.ch.root.rotation.y));
        h.ch.root.rotation.y += dy * Math.min(1, dt * 3);
      }
      if (pushed) {
        e.group.localToWorld(_h);
        player.x = _h.x; player.z = _h.z;
      }
      if (!e.welcomed && d < 4.5) {
        e.welcomed = true;
        e.hosts.forEach((h, i) => setTimeout(() => h.ch.gesture('agree'), i * 160));
        if (hooks && nearest) {
          const at = nearest.ch.root.getWorldPosition(new THREE.Vector3());
          at.y += 2.3;
          hooks.say(e.sayId, at, t('欢迎光临 Agent 大厦！', 'Welcome to the Agent Tower!'));
          e.sayT = 3.2;
        }
      } else if (e.welcomed && d > 12) e.welcomed = false;
    }
    if (e.sayT > 0 && (e.sayT -= dt) <= 0) hooks?.say(e.sayId, null, '');
    if (e.wings) {
      e.spin += ((want ? 1.1 : 0.12) - e.spin) * Math.min(1, dt * 1.5);
      e.wings.rotation.y += e.spin * dt;
    }
  }
}

// ---------- the entrance ----------

export function buildEntrance(o: EntranceOpts): THREE.Group {
  const M = (MAT ??= makeMaterials());
  const dims = DIMS[o.tier];
  const group = new THREE.Group();
  group.name = 'entrance';
  group.position.copy(o.door);
  group.rotation.y = Math.atan2(o.out.x, o.out.z);
  const b = new Batch();
  const rnd = mulberry(o.seed);

  const towerDemo = o.name === 'OPEN WORLD TOWER';
  // Headquarters: a tall glass lobby, not a shopfront fitted to whatever short wall was nearest.
  const W = towerDemo ? Math.max(20, Math.min(32, o.wallLen - 1)) : Math.max(4, Math.min(dims.W, o.wallLen - 1.2));
  const H = towerDemo ? 16 : Math.max(3.2, Math.min(dims.H, o.maxH - 0.4));
  const P = dims.P;
  const nightLights: [THREE.MeshBasicMaterial, number][] = [];
  const lamps: [THREE.Light, number][] = [];
  const facadeGlass = towerDemo ? M.lobbyGlass : M.glass;
  const head = Math.min(2.85, H - 0.45); // door head / transom
  const revolving = dims.revolving && W >= 6;
  const R = 1.25; // revolving drum radius
  const sideDoors = revolving && W >= 11;

  // Openings in the front glass: [center x, half width].
  const openings: [number, number][] = [];
  if (revolving) {
    openings.push([0, R + 0.08]);
    if (sideDoors) for (const s of [-1, 1]) openings.push([s * (R + 2.2), 1.05]);
  } else openings.push([0, W < 5 ? 0.9 : 1.05]);

  // ---- Paving: lobby floor, a granite apron with two shallow steps ----
  b.box(towerDemo ? M.darkStone : M.marble, W - 0.1, 0.05, P, 0, 0, P / 2);
  const apron = towerDemo ? W + 6 : Math.min(W + 4, o.wallLen + 2);
  b.box(towerDemo ? M.darkStone : M.stone, apron, 0.04, 3.6, 0, 0, P + 1.8);
  const doorSpan = revolving ? (sideDoors ? 2 * (R + 3.3) : 2 * R + 0.6) : 2.6;
  b.box(towerDemo ? M.darkStone : M.stone, doorSpan + 1.2, 0.1, 0.55, 0, 0, P + 0.28);
  b.box(towerDemo ? M.darkStone : M.stone, doorSpan + 1.8, 0.05, 0.5, 0, 0, P + 0.8);

  // ---- The pavilion: glass front and sides, mullions, a stone cap ----
  const frontSegs = segmentsExcluding(-W / 2, W / 2, openings.map(([c, h]) => [c - h, c + h]));
  const mullionsAt = (x0: number, x1: number, step: number) => {
    const n = Math.max(1, Math.round((x1 - x0) / step));
    return Array.from({ length: n + 1 }, (_, i) => x0 + ((x1 - x0) * i) / n);
  };
  for (const [x0, x1] of frontSegs) {
    if (x1 - x0 < 0.05) continue;
    b.box(facadeGlass, x1 - x0, H - 0.12, 0.03, (x0 + x1) / 2, 0.06, P);
    for (const x of mullionsAt(x0, x1, 1.6)) b.box(M.frame, 0.07, H, 0.16, x, 0, P);
  }
  // Glass above the doors, a transom bar, a base rail and a head rail.
  for (const [c, h] of openings) {
    b.box(facadeGlass, 2 * h, H - head - 0.12, 0.03, c, head + 0.06, P);
    b.box(M.frame, 2 * h + 0.14, 0.14, 0.18, c, head - 0.07, P);
    for (const s of [-1, 1]) b.box(M.frame, 0.1, H, 0.18, c + s * h, 0, P);
  }
  b.box(M.frame, W + 0.1, 0.08, 0.16, 0, 0, P);
  b.box(M.frame, W + 0.2, 0.22, 0.24, 0, H - 0.22, P);
  for (const s of [-1, 1]) {
    b.add(facadeGlass, new THREE.BoxGeometry(P, H - 0.12, 0.03).translate(0, (H - 0.12) / 2, 0), s * W / 2, 0.06, P / 2, Math.PI / 2);
    for (const z of mullionsAt(0, P, 1.5)) b.box(M.frame, 0.16, H, 0.07, s * W / 2, 0, z);
  }
  b.box(M.darkStone, W + 0.5, 0.42, P + 0.3, 0, H, (P + 0.3) / 2);
  b.box(M.frame, W + 0.52, 0.06, P + 0.32, 0, H + 0.42, (P + 0.3) / 2);
  // ---- Inside: a warm lobby you can see through the glass ----
  b.box(towerDemo ? M.darkStone : M.lobbyWall, W - 0.3, H - 0.1, 0.06, 0, 0.05, 0.05);
  for (let x = -W / 2 + 0.9; x <= W / 2 - 0.9; x += 1.8) b.box(M.frame, 0.03, H - 0.1, 0.02, x, 0.05, 0.09); // panel joints
  b.box(M.white, W - 0.2, 0.04, P - 0.05, 0, H - 0.05, P / 2); // ceiling
  for (let x = -W / 2 + 1.2; x < W / 2 - 0.6; x += 2.2) b.box(M.ceilingLight, 0.9, 0.02, Math.max(0.3, P - 1.1), x, H - 0.08, P / 2);
  if (W >= 7 && P >= 2) {
    // Reception desk off to one side, a bench and a tall plant.
    const dx = W * 0.27;
    b.box(M.marble, 2.2, 1.0, 0.65, dx, 0.05, P * 0.42);
    b.box(M.darkStone, 2.3, 0.05, 0.75, dx, 1.05, P * 0.42);
    b.box(M.darkStone, 1.6, 0.42, 0.45, -dx, 0.05, P * 0.35);
    b.cyl(M.darkStone, 0.3, 0.24, 0.55, -W / 2 + 0.7, 0.05, 0.6, 20);
    // A fiddle-leaf fig: stems and big leaves.
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2, r = rnd() * 0.25, h = 0.8 + rnd() * 1.1;
      const g = new THREE.SphereGeometry(1, 7, 3).scale(0.08, 0.012, 0.15).translate(0, 0, 0.12).rotateX(-0.3 - rnd() * 0.8).rotateY(a);
      b.add(M.leaf, g, -W / 2 + 0.7 + Math.cos(a) * r, 0.05 + h, 0.6 + Math.sin(a) * r);
    }
  }
  // Backlit logo on the lobby wall, behind the doors.
  const logoS = Math.min(1.6, H - head + 0.9, W * 0.18);
  const lobbyLogo = new THREE.Mesh(new THREE.PlaneGeometry(logoS, logoS), logoMaterial(o.logo));
  lobbyLogo.position.set(0, Math.min(head + 0.1, H - 0.25 - logoS / 2), 0.1);
  group.add(lobbyLogo);

  // ---- Doors ----
  const leaves: Leaf[] = [];
  const leaf = (cx: number, w: number, dir: number) => {
    const lb = new Batch();
    lb.box(M.glass, w - 0.08, head - 0.12, 0.025, 0, 0.06, 0);
    lb.box(M.frame, w, 0.06, 0.06, 0, 0, 0);
    lb.box(M.frame, w, 0.08, 0.06, 0, head - 0.08, 0);
    for (const s of [-1, 1]) lb.box(M.frame, 0.05, head, 0.06, s * (w / 2 - 0.025), 0, 0);
    lb.box(M.steel, 0.03, 1.1, 0.03, -dir * (w / 2 - 0.12), 0.55, 0.06); // pull bar
    const g = new THREE.Group();
    lb.build(g, false);
    g.position.set(cx, 0.05, P - 0.1);
    group.add(g);
    leaves.push({ mesh: g, closedX: cx, openX: cx + dir * (w - 0.1) });
  };
  for (const [c, h] of openings) {
    if (revolving && c === 0) continue;
    leaf(c - h / 2, h, -1);
    leaf(c + h / 2, h, 1);
  }
  let wings: THREE.Object3D | null = null;
  if (revolving) {
    // Drum: two curved glass walls (open to the front and back), a canopy disc and a floor disc.
    for (const a of [0, Math.PI]) {
      const arc = new THREE.CylinderGeometry(R, R, head - 0.1, 24, 1, true, a + Math.PI / 2 - 0.95, 1.9).translate(0, (head - 0.1) / 2 + 0.05, 0);
      b.add(M.glass, arc, 0, 0, P);
    }
    b.cyl(M.frame, R + 0.06, R + 0.06, 0.24, 0, head - 0.12, P, 32);
    b.cyl(M.downlight, R - 0.2, R - 0.2, 0.01, 0, head - 0.13, P, 24);
    b.cyl(M.darkStone, R + 0.04, R + 0.04, 0.05, 0, 0.0, P, 32);
    const wb = new Batch();
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      wb.add(M.glass, new THREE.BoxGeometry(R - 0.08, head - 0.3, 0.03).translate((R - 0.08) / 2, (head - 0.3) / 2, 0), 0, 0.12, 0, a);
      wb.add(M.frame, new THREE.BoxGeometry(0.05, head - 0.3, 0.05).translate(R - 0.1, (head - 0.3) / 2, 0), 0, 0.12, 0, a);
    }
    wb.cyl(M.steel, 0.07, 0.07, head - 0.2, 0, 0.05, 0, 10);
    const w = new THREE.Group();
    wb.build(w, false);
    w.position.set(0, 0, P);
    group.add(w);
    wings = w;
  }

  // ---- Canopy: a thin steel blade on tension rods, with downlights ----
  const cY = towerDemo ? 4.55 : Math.min(head + 0.75, H - 0.1);
  const cW = towerDemo ? Math.min(W - 2.2, 14.4) : doorSpan + 2.4;
  const cD = towerDemo ? 2.65 : 2.6;
  const fasciaHeight = 2.85;
  const fasciaFront = P + cD;
  if (towerDemo) {
    // A single portal wraps the door bank. The fascia and pilasters share a front plane.
    const pierW = 1.35;
    const pierX = (cW - pierW) / 2;
    const top = cY + fasciaHeight;
    const inlayZ = fasciaFront + 0.025;
    b.box(M.portalStone, cW, fasciaHeight, cD, 0, cY, P + cD / 2);
    b.box(M.portalStone, cW + 0.26, 0.18, cD + 0.22, 0, top, P + cD / 2);
    b.box(M.portalBronze, cW + 0.05, 0.09, 0.08, 0, top - 0.19, inlayZ);
    b.box(M.portalBronze, cW, 0.11, 0.1, 0, cY, inlayZ);
    for (const side of [-1, 1]) {
      const x = side * pierX;
      b.box(M.portalStone, pierW, cY, cD, x, 0, P + cD / 2);
      b.box(M.signPlate, pierW + 0.14, 0.46, cD + 0.13, x, 0, P + cD / 2);
      for (const offset of [-0.42, 0.42]) {
        b.box(M.portalBronze, 0.055, cY - 0.08, 0.06, x + offset, 0.46, inlayZ);
      }
      b.box(M.ceilingLight, 0.075, cY - 0.92, 0.03, x, 0.55, inlayZ);
    }
    for (const x of [-3.7, 0, 3.7]) {
      b.box(M.downlight, 0.66, 0.025, 1.68, x, cY - 0.026, P + cD / 2);
    }
  } else {
    b.box(M.frame, cW, 0.16, cD, 0, cY, P + cD / 2);
    b.box(M.steel, cW + 0.02, 0.05, 0.05, 0, cY + 0.16, fasciaFront);
    for (let x = -cW / 2 + 0.8; x <= cW / 2 - 0.7; x += 1.4) for (const z of [P + 0.8, fasciaFront - 0.6]) b.cyl(M.downlight, 0.11, 0.11, 0.02, x, cY - 0.015, z, 10);
    for (const side of [-1, 1]) {
      const x = side * (cW / 2 - 0.4), y0 = cY + 0.16, y1 = Math.min(H, cY + 1.8), z1 = fasciaFront - 0.2;
      const len = Math.hypot(y1 - y0, z1 - P);
      const rod = new THREE.CylinderGeometry(0.025, 0.025, len, 6).rotateX(Math.atan2(z1 - P, y1 - y0)).translate(0, (y0 + y1) / 2, (P + z1) / 2);
      b.add(M.steel, rod, x, 0, 0);
    }
  }

  // ---- Nameplate: ordinary HQs use metal letters; the Open World tower gets its black-and-gold plaque. ----
  const tex = letterTextures(o.name);
  const above = o.maxH > H + 3.2; // room on the wall above the pavilion
  const letterW = Math.min(above ? W * 0.9 : cW - 0.4, Math.max(4, o.name.length * (o.tier === 'landmark' ? 1.0 : o.tier === 'tower' ? 0.85 : 0.6)));
  const letterH = letterW / 8;
  // A dark sign band standing off the wall (or on the canopy) with the letters pinned to it, so the
  // name reads against any facade.
  const lx = 0, ly = above ? H + 0.75 + letterH / 2 : cY + 0.3 + letterH / 2;
  const bandZ = above ? 0.35 : P + cD - 0.2;
  // Headquarters: the name sits on the canopy, where the sidewalk looks, not on the roof of the lobby.
  const bandW = towerDemo ? cW - 1.5 : letterW + 0.7;
  const artW = bandW * (towerDemo ? 1 : 0.9);
  const artH = towerDemo ? Math.min(artW / TOWER_SIGN_ASPECT, fasciaHeight - 0.32) : letterH;
  const bandH = towerDemo ? Math.max(artH, 2.4) : letterH + 0.45;
  const signY = towerDemo ? cY + fasciaHeight / 2 : ly;
  const signZ = towerDemo ? fasciaFront : bandZ;
  if (!towerDemo) b.box(M.frame, bandW, bandH, 0.16, lx, signY - bandH / 2, signZ);
  if (above && !towerDemo) for (const s of [-1, 1]) b.box(M.steel, 0.06, 0.06, bandZ, lx + s * (bandW / 2 - 0.4), ly, bandZ / 2); // stand-off brackets
  else if (!above && !towerDemo) b.box(M.frame, bandW, 0.05, 0.3, lx, cY + 0.16, bandZ); // sits on the canopy
  if (!towerDemo) b.box(M.uplight, bandW - 0.1, 0.03, 0.05, lx, signY - bandH / 2 - 0.02, signZ + 0.14); // wall-washer under the band
  const lz = towerDemo ? signZ + 0.031 : signZ + 0.1;
  // The halo only comes on after dark (updateEntrances fades it with the night).
  const brand = towerDemo ? towerSignTextures() : null;
  const halo = new THREE.MeshBasicMaterial({
    color: towerDemo ? 0xf3ba2f : 0xffe2b8, transparent: true, depthWrite: false, opacity: 0,
    alphaMap: brand ? brand.halo : tex.halo, blending: brand ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const haloM = new THREE.Mesh(new THREE.PlaneGeometry(artW * (brand ? 1 : 1.04), artH * (brand ? 1 : 1.2)), halo);
  // Keep the additive glow in front of the gold lettering.
  haloM.position.set(lx, signY, lz + (brand ? 0.006 : -0.008));
  const metal = brand
    ? new THREE.MeshBasicMaterial({ map: brand.sign, transparent: true, alphaTest: 0.04, toneMapped: false })
    : new THREE.MeshBasicMaterial({ map: tex.metal, transparent: true, alphaTest: 0.02, toneMapped: false });
  const signM = new THREE.Mesh(new THREE.PlaneGeometry(artW, artH), metal);
  signM.position.set(lx, signY, lz);
  signM.name = towerDemo ? 'tower-plaque' : 'nameplate';
  group.add(haloM, signM);

  // Backlit logo plaque: on a stone monument at the curb (big towers) or on the wall by the letters.
  if (dims.plinth && !towerDemo) {
    const mx = Math.min(W / 2 + 1.4, apron / 2 - 0.9) * (rnd() < 0.5 ? -1 : 1), mz = P + 3.0;
    b.box(M.darkStone, 1.7, 2.3, 0.5, mx, 0, mz);
    b.box(M.stone, 1.9, 0.12, 0.7, mx, 0, mz);
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), logoMaterial(o.logo));
    plaque.position.set(mx, 1.45, mz + 0.26);
    const nm = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5 / 8), new THREE.MeshStandardMaterial({ map: tex.metal, transparent: true, alphaTest: 0.4, metalness: 0.75, roughness: 0.32 }));
    nm.position.set(mx, 0.55, mz + 0.26);
    group.add(plaque, nm);
    b.box(M.uplight, 1.2, 0.03, 0.12, mx, 0.12, mz + 0.38);
  } else if (!towerDemo) {
    const s = Math.min(1.3, letterH * 1.6);
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(s, s), logoMaterial(o.logo));
    plaque.position.set(-W / 2 + s / 2 + 0.35, above ? ly : Math.min(head + 0.1, H - s / 2 - 0.3), above ? 0.13 : P + 0.05);
    group.add(plaque);
  }

  // Street number in white vinyl on the transom glass.
  if (!towerDemo) {
    const num = 10 + (o.seed % 880);
    const numM = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.28), new THREE.MeshBasicMaterial({ map: numberTexture(num), transparent: true, depthWrite: false }));
    numM.position.set(revolving ? 0 : openings[0][0], Math.min(head + 0.32, H - 0.3), P + 0.03);
    group.add(numM);
  }

  // ---- Street furniture: planters with uplights, bollards ----
  const planter = (x: number, z: number) => {
    b.box(towerDemo ? M.darkStone : M.concrete, 1.7, 0.62, 0.85, x, 0, z);
    b.box(M.darkStone, 1.6, 0.04, 0.75, x, 0.6, z);
    if (towerDemo) b.box(M.portalBronze, 1.73, 0.055, 0.89, x, 0.6, z);
    for (let i = 0; i < 5; i++) b.add(i % 2 ? M.shrub : M.shrub2, new THREE.IcosahedronGeometry(0.28 + rnd() * 0.16, 1), x + (i - 2) * 0.3 + (rnd() - 0.5) * 0.1, 0.78 + rnd() * 0.2, z + (rnd() - 0.5) * 0.3, rnd() * 3);
    b.box(M.uplight, 0.12, 0.03, 0.12, x, 0.62, z + 0.36);
  };
  const px = doorSpan / 2 + 1.6;
  if (px + 0.9 < apron / 2) for (const s of [-1, 1]) planter(s * (towerDemo ? cW / 2 + 1.15 : px), P + 1.5);
  if (dims.bollards) {
    for (let x = -apron / 2 + 0.6; x <= apron / 2 - 0.6; x += 1.5) {
      if (Math.abs(x) < 1.6) continue;
      b.cyl(towerDemo ? M.frame : M.steel, 0.1, 0.11, 0.95, x, 0, P + 3.9, 10);
      b.cyl(towerDemo ? M.portalBronze : M.frame, 0.115, 0.115, 0.06, x, 0.7, P + 3.9, 10);
    }
  }

  b.build(group);

  if (towerDemo) {
    const identity = new Batch();
    // Warm white LED noses on both entrance steps.
    identity.box(M.downlight, doorSpan + 1.1, 0.025, 0.02, 0, 0.06, P + 0.56);
    identity.box(M.downlight, doorSpan + 1.7, 0.02, 0.02, 0, 0.02, P + 1.06);
    identity.build(group, false);
    const groundMark = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2), logoMaterial(o.logo));
    groundMark.position.set(0, 0.09, P + 2.45);
    group.add(groundMark);
    // After dark: warm white light on the lobby's back wall, and a warm pool on the steps and forecourt.
    const lobby = nightLight(0xfff0dc, 'panel');
    const lobbyM = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.2, H + 0.3), lobby);
    lobbyM.position.set(0, H / 2, 0.11);
    const pool = nightLight(0xfff1dc);
    const poolM = new THREE.Mesh(new THREE.PlaneGeometry(doorSpan + 6, 7).rotateX(-Math.PI / 2), pool);
    poolM.position.set(0, 0.1, P + 2.4);
    group.add(lobbyM, poolM);
    nightLights.push([lobby, 0.3], [pool, 0.18]);
    // One real, shadowless downlight under the canopy so the steps, doors and people are actually lit.
    const lamp = new THREE.SpotLight(0xfff0dc, 0, 16, 0.95, 0.75, 1.6);
    lamp.position.set(0, cY - 0.05, P + 1.4);
    lamp.target.position.set(0, 0, P + 3.2);
    lamp.castShadow = false;
    group.add(lamp, lamp.target);
    lamps.push([lamp, 70]);
  }

  // Hosts lining the walk up to the doors, two each side, turned in toward the arriving guest.
  const hosts: { ch: Character; yaw: number }[] = [];
  if (towerDemo) {
    for (const [x, z, seed] of [[-1.5, 2.25, 11], [1.5, 2.25, 23], [-2.5, 1.35, 37], [2.5, 1.35, 41]] as const) {
      const ch = makeNpc(0x18191d, 0xf0b90b, { role: 'greeter', seed: o.seed + seed });
      const yaw = Math.atan2(-Math.sign(x) * 0.7, 1);
      ch.root.position.set(x, 0.04, P + z);
      ch.root.rotation.y = yaw;
      ch.root.traverse((m) => { if ((m as THREE.Mesh).isMesh) m.castShadow = true; });
      group.add(ch.root);
      hosts.push({ ch, yaw });
    }
  }

  const at = new THREE.Vector3(o.door.x + o.out.x * P, o.door.y, o.door.z + o.out.z * P);
  entries.push({ group, at, leaves, halo, haloMax: towerDemo ? 0.08 : 0.85, nightLights, lamps, wings, open: 0, spin: 0, attached: false, hosts, welcomed: false, sayId: `host-say:${o.seed}`, sayT: 0 });
  return group;
}

const logoMats = new WeakMap<THREE.Texture, THREE.MeshStandardMaterial>();
function logoMaterial(t: THREE.Texture) {
  let m = logoMats.get(t);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.55, roughness: 0.35 });
    m.userData = { base: 0.55 };
    glowMaterials.push(m);
    logoMats.set(t, m);
  }
  return m;
}

function segmentsExcluding(x0: number, x1: number, holes: [number, number][]) {
  const out: [number, number][] = [];
  let x = x0;
  for (const [a, c] of [...holes].sort((p, q) => p[0] - q[0])) {
    if (a > x) out.push([x, Math.min(a, x1)]);
    x = Math.max(x, c);
  }
  if (x < x1) out.push([x, x1]);
  return out;
}

function mulberry(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
