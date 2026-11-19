import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { AgentEvent, AgentInfo, BoardMessage, Repo, RepoDetail, Worker } from '../../shared/types.ts';
import type { GameCtx, Scene3D } from './ctx.ts';
import { api, onLive, track } from './api.ts';
import { shared } from './engine.ts';
import { CLOTHES, disposeNpc, makeNpc, type Character, type NpcRole } from './characters.ts';
import { Colliders, type PlayerWorld } from './player.ts';
import { Lift } from './rooms/lift.ts';
import { espresso } from './audio.ts';
import { FloorViews, type CityViewPlacement } from './rooms/cityView.ts';
import { planarUV, surfaceMaterial } from './rooms/surfaces.ts';
import { quality } from './engine.ts';
import { esc } from './interact.ts';
import {
  canvas, drawAgentMonitor, drawDecisions, drawFeed, drawIdleMonitor, drawLogoWall, drawPlate, drawSign,
  drawWorkerMonitor, hashStr, rng, skylineTexture, texFrom,
} from './interiorArt.ts';
import { openWorkerPanel } from './ui/workerPanel.ts';
import { openFrontDesk } from './ui/frontDesk.ts';
import { openAgentLivePanel, openHireAgentPanel } from './ui/agentPanel.ts';
import { openReview } from './ui/review.ts';
import { pulse } from './pulse.ts';
import { drawIssueBoard, drawShelfSign, makeCarryBox, makeCrate, openPrShelf } from './rooms/work.ts';
import { BOARD, openBoardroomPanel } from './ui/boardroomPanel.ts';
import { keymap } from './keymap.ts';
import { toast } from './ui/panel.ts';
import { drawTowerMark } from './city/entrance.ts';
import { coins, onTycoon, tycoon, type Shop } from './ui/tycoon.ts';
import { t as ui } from './i18n.ts';
import { drawBanner, drawOpenSeat, drawShopSeat, drawTycoonScreen } from './rooms/towerScreens.ts';

export interface Interior extends Scene3D {
  world: PlayerWorld;
  spawn: THREE.Vector3;
  spawnFacing: number;
  repo: Repo;
  detail: RepoDetail;
  /** Testing: jump straight to floor f, standing by the lifts. */
  debugFloor?(f: number): void;
  /** Testing: put n made-up running agents in the Agent Lab (they get up and talk like real ones). */
  debugBusy?(n: number): void;
}

// ---------- helpers ----------

type V3 = [number, number, number];
const KEEP = new Set(['position', 'normal', 'uv']);

/** Collects static geometry per material and merges it into one mesh per material. */
class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(mat: THREE.Material, geo: THREE.BufferGeometry, pos: V3, rotY = 0, rotX = 0, rotZ = 0) {
    let g = geo;
    if (g.index) { g = geo.toNonIndexed(); geo.dispose(); }
    for (const k of Object.keys(g.attributes)) if (!KEEP.has(k)) g.deleteAttribute(k);
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ)), new THREE.Vector3(1, 1, 1)));
    const list = this.parts.get(mat) ?? [];
    list.push(g);
    this.parts.set(mat, list);
  }
  box(mat: THREE.Material, w: number, h: number, d: number, pos: V3, rotY = 0) {
    this.add(mat, new THREE.BoxGeometry(w, h, d), pos, rotY);
  }
  cyl(mat: THREE.Material, rTop: number, rBot: number, h: number, pos: V3, seg = 16) {
    this.add(mat, new THREE.CylinderGeometry(rTop, rBot, h, seg), pos);
  }
  /** Materials whose merged geometry gets UVs in meters (textured surfaces: wood, stone, plaster). */
  worldUV = new Set<THREE.Material>();
  rounded(mat: THREE.Material, w: number, h: number, d: number, r: number, pos: V3, rotY = 0) {
    this.add(mat, new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)), pos, rotY);
  }
  build(parent: THREE.Object3D, casters: Set<THREE.Material>, out: THREE.BufferGeometry[]) {
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      if (this.worldUV.has(mat)) planarUV(merged);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = casters.has(mat);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      out.push(merged);
    }
    this.parts.clear();
  }
}

const addClips = new Map<string, THREE.AnimationClip>();
/** Additive gesture on top of the idle loop (the Xbot gesture clips are authored as additive poses). */
function additive(ch: Character, name: string) {
  const base = ch.actions[name]?.getClip();
  if (!base) return null;
  let clip = addClips.get(name);
  if (!clip) { clip = THREE.AnimationUtils.makeClipAdditive(base.clone()); addClips.set(name, clip); }
  return ch.mixer.clipAction(clip);
}
function gesture(ch: Character, name: string) {
  const a = additive(ch, name);
  if (!a) return;
  a.reset();
  a.setLoop(THREE.LoopOnce, 1);
  a.setEffectiveWeight(1);
  a.play();
}
function setPose(ch: Character, name: string, on: boolean) {
  const a = additive(ch, name);
  if (!a) return;
  if (on && !a.isRunning()) { a.reset(); a.setLoop(THREE.LoopRepeat, Infinity); a.setEffectiveWeight(1); a.fadeIn(0.4).play(); }
  if (!on && a.isRunning()) a.fadeOut(0.4);
}

interface Npc {
  id: string;
  ch: Character;
  base: number; // resting facing
  look: number | null; // override facing (toward speaker/player)
  turnToPlayer: boolean;
  nextGesture: number;
  kind: 'worker' | 'reception' | 'agent' | 'board' | 'staff';
  floor: number;
}

const angleTo = (from: THREE.Vector3, to: THREE.Vector3) => Math.atan2(to.x - from.x, to.z - from.z);
const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

const handDir = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qw = new THREE.Quaternion();
/** Turn `bone` (in world space) so the direction from it to `child` points along `dir`. */
function aimBone(bone: THREE.Object3D | undefined, child: THREE.Object3D | undefined, dir: THREE.Vector3) {
  if (!bone || !child || !bone.parent) return;
  bone.updateWorldMatrix(true, true);
  const cur = child.getWorldPosition(_b).sub(bone.getWorldPosition(_a)).normalize();
  _q.setFromUnitVectors(cur, dir);
  bone.getWorldQuaternion(_qw);
  bone.parent.getWorldQuaternion(_qp).invert();
  bone.quaternion.copy(_qp.multiply(_q.multiply(_qw)));
}

// ---------- build ----------

export async function buildInterior(ctx: GameCtx, repo: Repo, view?: CityViewPlacement): Promise<Interior> {
  const businessDemo = repo.fullName === 'open-world/agent-tower';
  const emptyDetail: RepoDetail = { repo, readme: '', workers: [], decisions: [], agents: [] };
  // The Agent Tower is not a GitHub repo: nothing to ask the old project server for.
  const detail: RepoDetail = repo.fullName === 'open-world/agent-tower' ? emptyDetail : await api.repo(repo.name).catch(() => emptyDetail);
  track('building_entered', { repo: repo.name, tier: repo.tier });

  const W = ({ landmark: 48, tower: 44, midrise: 40, small: 34 } as const)[repo.tier] ?? 40;
  const H = repo.tier === 'landmark' ? 5 : 4.2;
  const LOBBY = 9;
  // The tower gets a skyline lounge above the public boardroom.
  const FH = H + 2.6; // floor to floor: the slab and services between one ceiling and the next floor
  const LOBBY_F = 0, WORK_F = 1, LAB_F = 2, STUDIO_F = 3, BOARD_F = businessDemo ? 4 : 3, LOUNGE_F = 5, FLOORS = businessDemo ? 6 : 4;
  const DEPTH = businessDemo ? [14.5, 30, 26, 26, 26, 26] : [14.5, 30, 26, 26];
  const D = Math.max(...DEPTH);
  const fy = (f: number) => f * FH;
  const LIFT_Z = 12; // lift car center; its doors face the front of the building
  const LIFT_FRONT = LIFT_Z - (1.75 / 2 + 0.26); // the landing wall
  const labCx = 0, brdCx = 0, brdCz = 19.4;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1018);
  // Lighting from the room itself until the city view (captured per floor) takes over.
  const studio = new RoomEnvironment();
  const envRT = ctx.engine.pmrem.fromScene(studio, 0.04);
  studio.dispose(); // only needed for the capture
  if (new URLSearchParams(location.search).get('noenv') !== '1') scene.environment = envRT.texture;
  scene.environmentIntensity = 0.35;
  const lite = quality.low || quality.phone || ctx.engine.renderer.xr.isPresenting;

  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const M = <T extends THREE.Material>(m: T) => { mats.push(m); return m; };
  const T = <X extends THREE.Texture>(t: X) => { texs.push(t); return t; };
  const S = (name: Parameters<typeof surfaceMaterial>[0], opts: Parameters<typeof surfaceMaterial>[1] = {}) => {
    const m = M(surfaceMaterial(name, { lite, ...opts }));
    for (const k of ['map', 'normalMap', 'roughnessMap'] as const) { const t = (m as THREE.MeshStandardMaterial)[k]; if (t) T(t); }
    return m;
  };

  const brand = new THREE.Color(repo.brandColor || '#4fd1ff');
  const mat = {
    wall: S('plaster', { tint: 0xf1eee9 }),
    ceiling: S('acoustic'),
    plasterCeil: S('plaster', { tint: 0xf4f2ee, ceiling: true }),
    exposed: M(new THREE.MeshStandardMaterial({ color: 0x2e3238, roughness: 0.9 })),
    duct: M(new THREE.MeshStandardMaterial({ color: 0xa9aeb4, roughness: 0.38, metalness: 0.85 })),
    light: M(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3e2, emissiveIntensity: 2.4 })),
    trim: M(new THREE.MeshStandardMaterial({ color: 0xdfe1e3, roughness: 0.4, metalness: 0.6 })),
    brass: M(new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.25, metalness: 1 })),
    metal: M(new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.35, metalness: 0.85 })),
    steel: M(new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 0.9 })),
    white: M(new THREE.MeshStandardMaterial({ color: 0xf2f1ee, roughness: 0.35 })),
    whiteSteel: M(new THREE.MeshStandardMaterial({ color: 0xe9eaeb, roughness: 0.3, metalness: 0.4 })),
    wood: S('oak'),
    darkWood: S('walnut'),
    stone: S('marble'),
    quartz: S('terrazzo', { tint: 0xf4f2ee }),
    fabric: S('fabric', { tint: 0x323946 }),
    mesh: M(new THREE.MeshStandardMaterial({ color: 0x1d2026, roughness: 0.85 })),
    sofa: S('fabric', { tint: 0x8a7a68 }),
    sofa2: S('fabric', { tint: 0x5d6b62 }),
    leather: M(new THREE.MeshStandardMaterial({ color: 0x5a3a28, roughness: 0.55 })),
    felt: S('felt', { tint: 0x55606a }),
    rug: S('felt', { tint: 0xb9b0a3 }),
    divider: S('felt', { tint: 0x8f9aa6 }),
    black: M(new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.4, metalness: 0.3 })),
    leaf: M(new THREE.MeshStandardMaterial({ color: 0x3b6e33, roughness: 0.6, side: THREE.DoubleSide })),
    leaf2: M(new THREE.MeshStandardMaterial({ color: 0x2b5a2c, roughness: 0.6, side: THREE.DoubleSide })),
    stem: M(new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 })),
    soil: M(new THREE.MeshStandardMaterial({ color: 0x2f2620, roughness: 1 })),
    pot: M(new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.6 })),
    potDark: M(new THREE.MeshStandardMaterial({ color: 0x3a3c3f, roughness: 0.7 })),
    book: M(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })),
    ceramic: M(new THREE.MeshStandardMaterial({ color: 0xf6f5f2, roughness: 0.2 })),
    accent: M(new THREE.MeshStandardMaterial({ color: brand, emissive: brand, emissiveIntensity: 0.8, roughness: 0.4 })),
    glass: M(new THREE.MeshPhysicalMaterial({ color: 0xdbeef3, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6 })),
    window: M(new THREE.MeshPhysicalMaterial({ color: 0xc9dde6, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.2 })),
  };
  const casters = new Set<THREE.Material>([mat.white, mat.wood, mat.darkWood, mat.fabric, mat.mesh, mat.sofa, mat.sofa2, mat.leather, mat.felt, mat.divider, mat.black,
    mat.leaf, mat.leaf2, mat.pot, mat.potDark, mat.metal, mat.wall, mat.trim, mat.stone, mat.quartz, mat.whiteSteel, mat.duct, mat.exposed]);
  const worldUV = [mat.wall, mat.wood, mat.darkWood, mat.stone, mat.quartz, mat.plasterCeil];

  const colliders = new Colliders(8);
  let BF = 0; // the floor being built
  let cur = 0; // the floor you're on
  const solid = (x1: number, z1: number, x2: number, z2: number, maxY = 3) =>
    colliders.add({ minX: Math.min(x1, x2), maxX: Math.max(x1, x2), minZ: Math.min(z1, z2), maxZ: Math.max(z1, z2), minY: fy(BF) - 0.1, maxY: fy(BF) + maxY });

  // Each floor is its own group (only the floor you're on is drawn) with its own merged batch.
  const floorGroups: THREE.Group[] = [];
  let root = new THREE.Group();
  let b = new Batch();
  const beginFloor = (f: number) => {
    BF = f;
    root = new THREE.Group();
    root.position.y = fy(f);
    root.visible = f === cur;
    scene.add(root);
    floorGroups[f] = root;
    b = new Batch();
    for (const m of worldUV) b.worldUV.add(m);
  };
  const endFloor = () => b.build(root, casters, geos);

  // ---------- floors ----------
  /** A flat surface (floor, or ceiling when `down`) with UVs in meters, so its texture is to scale. */
  const flat = (m: THREE.Material, x1: number, z1: number, x2: number, z2: number, y: number, down = false) => {
    const g = new THREE.PlaneGeometry(x2 - x1, z2 - z1);
    g.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
    g.translate((x1 + x2) / 2, y, (z1 + z2) / 2);
    planarUV(g);
    geos.push(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    mesh.castShadow = down; // ceilings keep the sun out except through the windows
    root.add(mesh);
    return mesh;
  };
  const floorMesh = (m: THREE.Material, x1: number, z1: number, x2: number, z2: number, y: number) => flat(m, x1, z1, x2, z2, y);
  const marbleFloor = S('marble');
  const carpetFloor = S('carpet');
  const carpetWarm = S('carpetWarm');
  const oakFloor = S('oak');
  const walnutFloor = S('walnut');
  const concreteFloor = S('concrete');
  const carpetMat = (_d: number) => carpetFloor;
  const oakMat = (_w: number, _d: number) => oakFloor;

  // ---------- outer walls: a floor-to-ceiling curtain wall ----------
  const windowWall = (x1: number, z1: number, x2: number, z2: number) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const rot = Math.atan2(x2 - x1, z2 - z1) - Math.PI / 2; // box X axis along the wall
    b.box(mat.trim, len, 0.1, 0.22, [cx, 0.05, cz], rot); // base channel
    b.box(mat.wall, len, 0.42, 0.34, [cx, H - 0.21, cz], rot); // head soffit
    b.box(mat.black, len, 0.1, 0.16, [cx, H - 0.47, cz], rot); // roller-shade pocket
    b.box(mat.window, len, H - 0.6, 0.02, [cx, 0.1 + (H - 0.6) / 2, cz], rot);
    const n = Math.max(1, Math.round(len / 1.5));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      b.box(mat.metal, 0.055, H - 0.42, 0.16, [x1 + (x2 - x1) * t, (H - 0.42) / 2, z1 + (z2 - z1) * t], rot);
    }
  };
  /**
   * Ceiling (acoustic tiles with recessed linear lights, an exposed services ceiling, or smooth plaster
   * with downlights and a lit cove) and the curtain walls on the sides and back (and front, upstairs).
   */
  const shell = (f: number, glassFront: boolean, kind: 'acoustic' | 'exposed' | 'plaster' = 'acoustic') => {
    const Df = DEPTH[f];
    const inShaft = (x: number, z: number) => Math.abs(x) < 2.4 && Math.abs(z - LIFT_Z) < 2.2;
    if (kind === 'acoustic') {
      flat(mat.ceiling, -W / 2, 0, W / 2, Df, H, true);
      for (let x = -W / 2 + 3; x <= W / 2 - 3; x += 3) for (let z = 2.4; z < Df - 1.4; z += 3.6) {
        if (inShaft(x, z)) continue;
        b.box(mat.trim, 0.16, 0.02, 2.44, [x, H - 0.012, z]);
        b.box(mat.light, 0.07, 0.02, 2.3, [x, H - 0.02, z]);
      }
    } else if (kind === 'plaster') {
      flat(mat.plasterCeil, -W / 2, 0, W / 2, Df, H, true);
      for (let x = -W / 2 + 2.5; x <= W / 2 - 2.5; x += 2.5) for (let z = 2; z < Df - 1; z += 2.5) {
        if (inShaft(x, z)) continue;
        b.cyl(mat.trim, 0.11, 0.11, 0.02, [x, H - 0.012, z], 16);
        b.cyl(mat.light, 0.075, 0.075, 0.02, [x, H - 0.02, z], 16);
      }
      // Lit cove around the edge.
      b.box(mat.light, W - 1.2, 0.03, 0.06, [0, H - 0.5, Df - 0.6]);
      b.box(mat.light, 0.06, 0.03, Df - 1.2, [-W / 2 + 0.6, H - 0.5, Df / 2]);
      b.box(mat.light, 0.06, 0.03, Df - 1.2, [W / 2 - 0.6, H - 0.5, Df / 2]);
    } else {
      // Exposed: dark deck, round ducts, a cable tray, and linear pendants on wires.
      flat(mat.exposed, -W / 2, 0, W / 2, Df, H + 0.6, true);
      for (const x of [-W / 4, W / 4]) {
        const g = new THREE.CylinderGeometry(0.32, 0.32, Df - 1, 20);
        g.rotateX(Math.PI / 2);
        b.add(mat.duct, g, [x, H + 0.1, Df / 2]);
        for (let z = 3; z < Df - 2; z += 4) b.add(mat.duct, new THREE.CylinderGeometry(0.14, 0.14, 0.3, 14), [x, H - 0.3, z]);
      }
      b.box(mat.metal, 0.4, 0.06, Df - 1, [0, H + 0.2, Df / 2]);
      for (let x = -W / 2 + 4; x <= W / 2 - 4; x += 4) for (let z = 3; z < Df - 2; z += 4.5) {
        if (inShaft(x, z)) continue;
        b.box(mat.metal, 0.012, 0.9, 0.012, [x, H + 0.15, z - 1]);
        b.box(mat.metal, 0.012, 0.9, 0.012, [x, H + 0.15, z + 1]);
        b.box(mat.black, 0.1, 0.07, 2.4, [x, H - 0.33, z]);
        b.box(mat.light, 0.07, 0.02, 2.3, [x, H - 0.375, z]);
      }
    }
    windowWall(-W / 2, 0, -W / 2, Df);
    windowWall(W / 2, 0, W / 2, Df);
    windowWall(-W / 2, Df, W / 2, Df);
    if (glassFront) windowWall(-W / 2, 0, W / 2, 0);
    solid(-W / 2, -0.4, W / 2, 0.15, 5);
    solid(-W / 2, Df - 0.15, W / 2, Df + 0.4, 5);
    // Light: six warm ceiling lights on every floor (the same count, so floors share shaders).
    const spots: [number, number][] = [[-W / 4, 4], [W / 4, 4], [-W / 4, Df * 0.62], [W / 4, Df * 0.62], [-W / 2 + 3, Df - 3], [W / 2 - 3, Df - 3]];
    for (const [x, z] of spots) {
      const p = new THREE.PointLight(0xffe6c8, 26, 18, 2);
      p.position.set(x, H - 0.4, z);
      root.add(p);
    }
  };

  // ---------- skyline backdrops beyond the windows (they follow you from floor to floor) ----------
  const backdrop = new THREE.Group();
  scene.add(backdrop);
  {
    const seed = hashStr(repo.name);
    const day = T(skylineTexture(false, seed)), night = T(skylineTexture(true, seed));
    const sky = M(new THREE.ShaderMaterial({
      uniforms: { dayMap: { value: day }, nightMap: { value: night }, uNight: shared.uNight },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D dayMap; uniform sampler2D nightMap; uniform float uNight; varying vec2 vUv;
        void main(){ vec4 c = mix(texture2D(dayMap, vUv), texture2D(nightMap, vUv), uNight); gl_FragColor = vec4(c.rgb * 0.9, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
    }));
    const put = (w: number, x: number, z: number, ry: number) => {
      const g = new THREE.PlaneGeometry(w, 34);
      geos.push(g);
      const m = new THREE.Mesh(g, sky);
      m.position.set(x, 6, z);
      m.rotation.y = ry;
      backdrop.add(m);
    };
    put(W + 70, 0, D + 22, Math.PI);
    put(D + 70, -W / 2 - 22, D / 2, Math.PI / 2);
    put(D + 70, W / 2 + 22, D / 2, -Math.PI / 2);
    put(W + 70, 0, -22, 0);
  }

  // ---------- glass partitions ----------
  const glassWall = (x1: number, z1: number, x2: number, z2: number, gapAt?: number, gapW = 2.4) => {
    const segs: [number, number][] = [];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (gapAt === undefined) segs.push([0, len]);
    else { segs.push([0, gapAt - gapW / 2], [gapAt + gapW / 2, len]); }
    const dx = (x2 - x1) / len, dz = (z2 - z1) / len;
    const rot = Math.atan2(dx, dz) - Math.PI / 2;
    for (const [a, bb] of segs) {
      const l = bb - a;
      if (l <= 0.05) continue;
      const mx = x1 + dx * (a + l / 2), mz = z1 + dz * (a + l / 2);
      b.box(mat.glass, l, H - 0.2, 0.03, [mx, (H - 0.2) / 2 + 0.05, mz], rot);
      b.box(mat.metal, l, 0.06, 0.08, [mx, 0.03, mz], rot);
      b.box(mat.metal, l, 0.08, 0.08, [mx, H - 0.14, mz], rot);
      const n = Math.max(1, Math.round(l / 2));
      for (let i = 0; i <= n; i++) b.box(mat.metal, 0.05, H - 0.1, 0.06, [x1 + dx * (a + (l * i) / n), (H - 0.1) / 2, z1 + dz * (a + (l * i) / n)]);
      // Frosted privacy band
      b.box(mat.white, l, 0.12, 0.035, [mx, 1.25, mz], rot);
      const ax = x1 + dx * a, az = z1 + dz * a, bx = x1 + dx * bb, bz = z1 + dz * bb;
      solid(Math.min(ax, bx) - 0.1, Math.min(az, bz) - 0.1, Math.max(ax, bx) + 0.1, Math.max(az, bz) + 0.1, 5);
    }
    if (gapAt !== undefined) b.box(mat.metal, gapW, H - 3, 0.1, [x1 + dx * gapAt, 3 + (H - 3) / 2, z1 + dz * gapAt], rot);
  };

  const plate = (text: string, color: string, x: number, z: number, y = 3.25) => {
    const { c } = canvas(1024, 160);
    drawPlate(c, text, color);
    const g = new THREE.PlaneGeometry(2.4, 0.38);
    geos.push(g);
    const m = new THREE.Mesh(g, M(new THREE.MeshBasicMaterial({ map: T(texFrom(c)) })));
    m.position.set(x, y, z - 0.08);
    m.rotation.y = Math.PI;
    root.add(m);
  };

  const column = (x: number, z: number) => {
    b.cyl(mat.wall, 0.36, 0.36, H, [x, H / 2, z], 28);
    b.cyl(mat.trim, 0.38, 0.38, 0.1, [x, 0.05, z], 28);
    solid(x - 0.4, z - 0.4, x + 0.4, z + 0.4, 5);
  };

  // ---------- plants: a pot, soil, stems and many leaves (fiddle-leaf figs and palms) ----------
  const leafGeo = (len: number, wid: number) => {
    const g = new THREE.SphereGeometry(1, 8, 4);
    g.scale(wid, 0.012, len);
    g.translate(0, 0, len * 0.9);
    return g;
  };
  const plant = (x: number, z: number, s = 1) => {
    const r = rng(hashStr(`${x},${z},${BF}`));
    const ph = 0.55 * s, pr = 0.3 * s;
    const dark = r() < 0.5;
    b.add(dark ? mat.potDark : mat.pot, new THREE.CylinderGeometry(pr, pr * 0.8, ph, 24), [x, ph / 2, z]);
    b.cyl(mat.soil, pr * 0.92, pr * 0.92, 0.02, [x, ph - 0.03, z], 20);
    const stems = 3 + Math.floor(r() * 3);
    for (let i = 0; i < stems; i++) {
      const a = (i / stems) * Math.PI * 2 + r(), lean = 0.12 + r() * 0.18, h = (0.9 + r() * 0.9) * s;
      const g = new THREE.CylinderGeometry(0.012 * s, 0.02 * s, h, 5);
      g.translate(0, h / 2, 0);
      g.rotateX(lean);
      g.rotateY(a);
      b.add(mat.stem, g, [x, ph - 0.02, z]);
      const tipX = Math.sin(a) * Math.sin(lean) * h, tipZ = Math.cos(a) * Math.sin(lean) * h, tipY = Math.cos(lean) * h;
      const leaves = 6 + Math.floor(r() * 5);
      for (let k = 0; k < leaves; k++) {
        const t = 0.35 + (k / leaves) * 0.65;
        const lg = leafGeo((0.16 + r() * 0.1) * s, (0.08 + r() * 0.05) * s);
        b.add(r() < 0.5 ? mat.leaf : mat.leaf2, lg, [x + tipX * t, ph + tipY * t, z + tipZ * t], r() * Math.PI * 2, -0.2 - r() * 0.9, (r() - 0.5) * 0.6);
      }
    }
    solid(x - 0.35 * s, z - 0.35 * s, x + 0.35 * s, z + 0.35 * s, 2);
  };

  // ---------- furniture ----------
  /** Office task chair: five-star base, gas lift, seat and mesh back, arms. Faces +z rotated by yaw. */
  const taskChair = (x: number, z: number, yaw: number, exec = false) => {
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const P = (lx: number, ly: number, lz: number): V3 => [x + lx * c + lz * sn, ly, z - lx * sn + lz * c];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      b.box(mat.metal, 0.04, 0.035, 0.32, P(Math.sin(a) * 0.16, 0.07, Math.cos(a) * 0.16), yaw + a);
      b.add(mat.black, new THREE.SphereGeometry(0.028, 8, 6), P(Math.sin(a) * 0.31, 0.03, Math.cos(a) * 0.31));
    }
    b.cyl(mat.steel, 0.025, 0.025, 0.36, P(0, 0.26, 0), 10);
    b.rounded(exec ? mat.leather : mat.fabric, 0.5, 0.08, 0.48, 0.035, P(0, 0.47, 0), yaw);
    b.rounded(exec ? mat.leather : mat.mesh, 0.46, exec ? 0.62 : 0.55, 0.05, 0.025, P(0, exec ? 0.83 : 0.8, -0.24), yaw);
    b.box(mat.metal, 0.04, 0.3, 0.04, P(0, 0.6, -0.25), yaw);
    for (const sx of [-0.26, 0.26]) {
      b.box(mat.metal, 0.03, 0.2, 0.03, P(sx, 0.58, -0.02), yaw);
      b.rounded(mat.black, 0.06, 0.03, 0.24, 0.012, P(sx, 0.69, 0.0), yaw);
    }
  };
  /** Three-seat sofa (back toward -z, before rotation), on short legs. */
  const sofa = (x: number, z: number, yaw: number, m: THREE.Material = mat.sofa, w = 2.3) => {
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const P = (lx: number, ly: number, lz: number): V3 => [x + lx * c + lz * sn, ly, z - lx * sn + lz * c];
    b.rounded(m, w, 0.22, 0.9, 0.05, P(0, 0.22, 0), yaw);
    const seats = w > 1.5 ? 3 : 1, sw = (w - 0.36) / seats;
    for (let i = 0; i < seats; i++) {
      const lx = -w / 2 + 0.18 + sw * (i + 0.5);
      b.rounded(m, sw - 0.02, 0.14, 0.66, 0.06, P(lx, 0.4, 0.08), yaw);
      b.rounded(m, sw - 0.02, 0.42, 0.18, 0.07, P(lx, 0.62, -0.3), yaw);
    }
    b.rounded(m, w, 0.5, 0.16, 0.05, P(0, 0.52, -0.38), yaw);
    for (const sx of [-1, 1]) b.rounded(m, 0.18, 0.38, 0.9, 0.06, P(sx * (w / 2 - 0.09), 0.45, 0), yaw);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(mat.darkWood, 0.022, 0.018, 0.12, P(sx * (w / 2 - 0.1), 0.06, sz * 0.36), 8);
  };
  const armchair = (x: number, z: number, yaw: number, m: THREE.Material = mat.sofa2) => sofa(x, z, yaw, m, 0.95);
  const rug = (x: number, z: number, w: number, d: number) => {
    b.rounded(mat.rug, w, 0.012, d, 0.005, [x, 0.006, z]);
  };
  /** Lounge: a rug, sofa, armchairs and a coffee table, either side of the floor. */
  const lounge = (z: number) => {
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - 4.5);
      rug(x, z - 0.9, 3.6, 2.8);
      sofa(x, z, Math.PI);
      armchair(x - 1.55, z - 1.3, Math.PI / 2 + 0.35 * -sx * 0);
      armchair(x + 1.55, z - 1.3, -Math.PI / 2);
      b.cyl(mat.darkWood, 0.5, 0.5, 0.04, [x, 0.4, z - 1.3], 32);
      b.cyl(mat.metal, 0.03, 0.03, 0.38, [x, 0.19, z - 1.3], 8);
      b.cyl(mat.metal, 0.22, 0.22, 0.015, [x, 0.008, z - 1.3], 20);
      // A few books and a vase on the table.
      b.box(mat.book, 0.24, 0.04, 0.17, [x - 0.15, 0.44, z - 1.25], 0.3);
      b.add(mat.ceramic, new THREE.CylinderGeometry(0.05, 0.07, 0.22, 16), [x + 0.18, 0.53, z - 1.4]);
      solid(x - 1.3, z - 0.5, x + 1.3, z + 0.5, 1.2);
      solid(x - 0.6, z - 1.85, x + 0.6, z - 0.75, 1);
      solid(x - 2.05, z - 1.8, x - 1.05, z - 0.8, 1.1);
      solid(x + 1.05, z - 1.8, x + 2.05, z - 0.8, 1.1);
    }
  };
  /** A glass-fronted phone booth with felt walls, a stool and a shelf. Door faces -z. */
  const pod = (x: number, z: number) => {
    const w = 1.3, d = 1.2, h = 2.3;
    b.box(mat.felt, w, h, 0.05, [x, h / 2, z + d / 2]);
    b.box(mat.felt, 0.05, h, d, [x - w / 2, h / 2, z]);
    b.box(mat.felt, 0.05, h, d, [x + w / 2, h / 2, z]);
    b.box(mat.whiteSteel, w + 0.06, 0.06, d + 0.06, [x, h, z]);
    b.box(mat.glass, w, h - 0.08, 0.02, [x, h / 2, z - d / 2]);
    b.box(mat.metal, 0.03, h, 0.05, [x - w / 2, h / 2, z - d / 2]);
    b.box(mat.metal, 0.03, h, 0.05, [x + w / 2, h / 2, z - d / 2]);
    b.box(mat.steel, 0.02, 0.4, 0.03, [x + w / 2 - 0.12, 1.05, z - d / 2 - 0.03]);
    b.rounded(mat.wood, w - 0.15, 0.04, 0.4, 0.01, [x, 1.05, z + d / 2 - 0.25]);
    b.cyl(mat.sofa2, 0.2, 0.2, 0.08, [x, 0.66, z], 18);
    b.cyl(mat.metal, 0.03, 0.03, 0.62, [x, 0.31, z], 8);
    b.box(mat.light, w - 0.2, 0.02, 0.06, [x, h - 0.04, z]);
    solid(x - w / 2 - 0.05, z - d / 2 - 0.05, x + w / 2 + 0.05, z + d / 2 + 0.05, 2.5);
  };
  /** A kitchen run: base cabinets, quartz top, sink, espresso machine, open shelves; stools at an island. */
  const kitchen = (cx: number, cz: number, len: number, face: 1 | -1 = -1, shelves = true) => {
    b.box(mat.white, len, 0.86, 0.62, [cx, 0.43, cz]);
    for (let x = -len / 2 + 0.3; x < len / 2; x += 0.6) b.box(mat.black, 0.006, 0.7, 0.01, [cx + x, 0.45, cz + face * 0.315]); // door gaps
    b.box(mat.black, len, 0.1, 0.56, [cx, 0.05, cz + 0.02]); // toe kick
    b.box(mat.quartz, len + 0.04, 0.04, 0.66, [cx, 0.88, cz]);
    b.box(mat.steel, 0.5, 0.02, 0.4, [cx + len * 0.2, 0.9, cz]); // sink
    b.cyl(mat.steel, 0.012, 0.012, 0.3, [cx + len * 0.2, 1.05, cz + 0.22], 8);
    b.box(mat.steel, 0.36, 0.42, 0.4, [cx - len * 0.3, 1.11, cz + 0.05]); // espresso machine
    b.box(mat.black, 0.3, 0.06, 0.06, [cx - len * 0.3, 1.18, cz + face * 0.16]);
    for (let i = 0; i < 4; i++) b.add(mat.ceramic, new THREE.CylinderGeometry(0.04, 0.035, 0.09, 12), [cx - len * 0.3 + 0.3 + i * 0.1, 0.945, cz + face * 0.1]);
    if (shelves) {
      b.box(mat.wood, len, 0.03, 0.3, [cx, 1.6, cz - face * 0.17]);
      b.box(mat.wood, len, 0.03, 0.3, [cx, 2.0, cz - face * 0.17]);
      for (let i = 0; i < Math.floor(len / 0.18); i++) b.add(mat.ceramic, new THREE.CylinderGeometry(0.05, 0.05, 0.1 + (i % 3) * 0.05, 10), [cx - len / 2 + 0.15 + i * 0.18, 1.67 + (i % 3) * 0.025, cz - face * 0.17]);
    }
    b.box(mat.steel, 0.8, 2.0, 0.66, [cx + len / 2 + 0.42, 1.0, cz]); // fridge
    b.box(mat.black, 0.02, 0.6, 0.03, [cx + len / 2 + 0.12, 1.3, cz + face * 0.34]);
    solid(cx - len / 2 - 0.05, cz - 0.35, cx + len / 2 + 0.85, cz + 0.35, 2.2);
  };

  // ---------- people, labels, interactions (each belongs to a floor) ----------
  const npcs: Npc[] = [];
  const labelIds: string[] = [];
  const interactIds: string[] = [];
  const labelDefs = new Map<string, { floor: number; pos: THREE.Vector3; html: string; opts: { cls?: string; maxDist?: number } }>();
  const addLabel = (id: string, pos: THREE.Vector3, html: string, opts: { cls?: string; maxDist?: number } = {}, floor = BF) => {
    const p = pos.clone();
    p.y += fy(floor);
    labelDefs.set(id, { floor, pos: p, html, opts });
    if (floor === cur) ctx.labels.set(id, p, html, opts);
    if (!labelIds.includes(id)) labelIds.push(id);
  };
  const removeLabel = (id: string) => { labelDefs.delete(id); ctx.labels.remove(id); };
  const addInteract = (id: string, pos: THREE.Vector3, radius: number, label: string, sub: string | undefined, action: () => void, floor = BF) => {
    ctx.interactions.add({ id, position: pos.clone().setY(pos.y + fy(floor)), radius, label, sub, action });
    if (!interactIds.includes(id)) interactIds.push(id);
  };
  const spawnNpc = (id: string, kind: Npc['kind'], ch: Character, x: number, z: number, facing: number, turnToPlayer = true, floor = BF) => {
    ch.root.position.set(x, 0, z);
    ch.root.rotation.y = facing;
    floorGroups[floor].add(ch.root);
    const keep = BF;
    BF = floor;
    solid(x - 0.25, z - 0.25, x + 0.25, z + 0.25, 2);
    BF = keep;
    const n: Npc = { id, ch, base: facing, look: null, turnToPlayer, nextGesture: 3 + Math.random() * 10, kind, floor };
    npcs.push(n);
    return n;
  };

  // ---------- desk factory ----------
  const screens: THREE.Mesh[] = [];
  const desk = (x: number, z: number) => {
    // Height-adjustable desk: oak top on a white steel frame, monitor on an arm, keyboard, a mug.
    b.rounded(mat.wood, 1.6, 0.035, 0.8, 0.012, [x, 1.05, z]);
    for (const sx of [-0.68, 0.68]) {
      b.box(mat.whiteSteel, 0.07, 0.98, 0.05, [x + sx, 0.53, z + 0.05]);
      b.box(mat.whiteSteel, 0.07, 0.03, 0.7, [x + sx, 0.015, z + 0.05]);
      b.box(mat.whiteSteel, 0.06, 0.03, 0.6, [x + sx, 1.02, z + 0.05]);
    }
    b.box(mat.whiteSteel, 1.36, 0.05, 0.05, [x, 0.98, z + 0.3]);
    b.box(mat.metal, 1.3, 0.04, 0.12, [x, 0.9, z + 0.3]); // cable tray
    b.box(mat.divider, 1.6, 0.5, 0.035, [x, 1.33, z + 0.42]);
    b.rounded(mat.black, 0.9, 0.54, 0.025, 0.008, [x, 1.5, z + 0.22]);
    b.box(mat.metal, 0.04, 0.2, 0.04, [x, 1.17, z + 0.3]);
    b.box(mat.metal, 0.04, 0.04, 0.16, [x, 1.27, z + 0.26]);
    b.rounded(mat.whiteSteel, 0.44, 0.015, 0.13, 0.005, [x, 1.075, z - 0.15]);
    b.rounded(mat.whiteSteel, 0.06, 0.015, 0.1, 0.006, [x + 0.34, 1.075, z - 0.13]);
    const rr = rng(hashStr(`${x}:${z}:${BF}`));
    if (rr() < 0.6) b.add(mat.ceramic, new THREE.CylinderGeometry(0.04, 0.036, 0.1, 14), [x - 0.55, 1.12, z - 0.05]);
    if (rr() < 0.35) b.box(mat.book, 0.22, 0.03, 0.3, [x + 0.55, 1.083, z], rr());
    // Chair parked beside the standing desk
    taskChair(x + 1.05, z - 0.35, Math.PI * 0.85);
    solid(x - 0.85, z - 0.45, x + 0.85, z + 0.47, 2);
    const { c } = canvas(512, 320);
    const t = T(texFrom(c));
    const g = new THREE.PlaneGeometry(0.86, 0.5);
    geos.push(g);
    const scr = new THREE.Mesh(g, M(new THREE.MeshBasicMaterial({ map: t, toneMapped: false })));
    scr.position.set(x, 1.5, z + 0.2);
    scr.rotation.y = Math.PI;
    root.add(scr);
    screens.push(scr);
    return { c, t };
  };

  // ---------- the Agent Tower's live screens (redrawn from real arena data, only on the floor you're on) ----------
  interface LiveScreen { floor: number; c: HTMLCanvasElement; t: THREE.CanvasTexture; draw: (c: HTMLCanvasElement) => void; every: number; due: number }
  const liveScreens: LiveScreen[] = [];
  let liveClock = 0;
  /** A wall screen of w×h meters facing yaw (0 = +z) with a black bezel; `every` is its redraw period in seconds. */
  const liveScreen = (w: number, h: number, cw: number, pos: V3, yaw: number, draw: LiveScreen['draw'], every = 1, bezel = 0.08) => {
    const { c } = canvas(cw, Math.round((cw * h) / w));
    const t = T(texFrom(c));
    const g = new THREE.PlaneGeometry(w, h);
    geos.push(g);
    const m = new THREE.Mesh(g, M(new THREE.MeshBasicMaterial({ map: t, toneMapped: false })));
    m.position.set(...pos);
    m.rotation.y = yaw;
    root.add(m);
    const nx = Math.sin(yaw), nz = Math.cos(yaw);
    if (bezel > 0) b.box(mat.black, w + bezel * 2, h + bezel * 2, 0.08, [pos[0] - nx * 0.045, pos[1], pos[2] - nz * 0.045], yaw);
    const s: LiveScreen = { floor: BF, c, t, draw, every, due: 0 };
    liveScreens.push(s);
    return s;
  };
  /** A sign drawn once. */
  const staticScreen = (w: number, h: number, cw: number, pos: V3, yaw: number, draw: (c: HTMLCanvasElement) => void, basic = true) => {
    const { c } = canvas(cw, Math.round((cw * h) / w));
    draw(c);
    const g = new THREE.PlaneGeometry(w, h);
    geos.push(g);
    const map = T(texFrom(c));
    const m = new THREE.Mesh(g, M(basic ? new THREE.MeshBasicMaterial({ map, toneMapped: false }) : new THREE.MeshStandardMaterial({ map, roughness: 0.45, metalness: 0.1 })));
    m.position.set(...pos);
    m.rotation.y = yaw;
    root.add(m);
    return m;
  };
  const openApp = (app: string) => () => window.dispatchEvent(new CustomEvent('agent-city:open-economy', { detail: { app } }));
  /** The countdown strip over the lift landing, on every tower floor. */
  const liftStrip = () => liveScreen(2.2, 0.34, 1024, [0, Math.min(3.78, H - 0.45), LIFT_FRONT - 0.1], Math.PI, (c) => drawBanner(c, ui('时代广场 Agent 商战', 'TIMES SQUARE TYCOON'), 'OPEN WORLD', '#ffb698'), 12, 0.04);

  // =============================== LOBBY (ground floor) ===============================
  beginFloor(LOBBY_F);
  floorMesh(marbleFloor, -W / 2, 0, W / 2, DEPTH[0], 0);
  // Brass inlay lines from the door to reception
  b.box(mat.brass, 0.05, 0.004, LOBBY - 4.2, [-1.4, 0.002, (LOBBY - 4.2) / 2]);
  b.box(mat.brass, 0.05, 0.004, LOBBY - 4.2, [1.4, 0.002, (LOBBY - 4.2) / 2]);
  shell(LOBBY_F, false, 'plaster');
  // Lobby feature: two linear light slots above reception
  b.box(mat.trim, 8.2, 0.02, 0.2, [0, H - 0.012, 4.2]);
  b.box(mat.light, 8, 0.02, 0.1, [0, H - 0.02, 4.2]);
  b.box(mat.trim, 8.2, 0.02, 0.2, [0, H - 0.012, 7.2]);
  b.box(mat.light, 8, 0.02, 0.1, [0, H - 0.02, 7.2]);
  // Glass front with the entrance doors in the middle
  windowWall(-W / 2, 0, -2, 0);
  windowWall(2, 0, W / 2, 0);
  b.box(mat.wall, 4, H - 3, 0.34, [0, 3 + (H - 3) / 2, 0]);
  b.box(mat.glass, 1.95, 2.95, 0.04, [-1, 1.5, 0.02]);
  b.box(mat.glass, 1.95, 2.95, 0.04, [1, 1.5, 0.02]);
  b.box(mat.steel, 0.06, 3, 0.1, [0, 1.5, 0.02]);
  b.box(mat.steel, 0.06, 3, 0.1, [-2, 1.5, 0.02]);
  b.box(mat.steel, 0.06, 3, 0.1, [2, 1.5, 0.02]);
  b.box(mat.steel, 0.6, 0.04, 0.04, [-0.4, 1.1, 0.1]);
  b.box(mat.steel, 0.6, 0.04, 0.04, [0.4, 1.1, 0.1]);
  {
    const { c } = canvas(512, 128);
    drawPlate(c, 'EXIT', '#3ddc97');
    const t = T(texFrom(c));
    const g = new THREE.PlaneGeometry(0.9, 0.22);
    geos.push(g);
    const m = new THREE.Mesh(g, M(new THREE.MeshBasicMaterial({ map: t })));
    m.position.set(0, 3.25, 0.17);
    root.add(m);
  }
  column(-(W / 2 - 3), LOBBY + 0.8); column(W / 2 - 3, LOBBY + 0.8);
  plant(-W / 2 + 1.2, 1.2, 1.3); plant(W / 2 - 1.2, 1.2, 1.3);
  plant(-W / 2 + 1.2, LOBBY - 0.5, 1.1); plant(W / 2 - 1.2, LOBBY - 0.5, 1.1);
  plant(-W / 2 + 0.9, DEPTH[0] - 0.9); plant(W / 2 - 0.9, DEPTH[0] - 0.9);
  plant(-2.6, LIFT_FRONT - 0.5, 0.9); plant(2.6, LIFT_FRONT - 0.5, 0.9);
  plate(businessDemo ? ui('电梯', 'LIFTS') : 'LIFTS', '#e9ecef', 0, LIFT_FRONT);

  // Reception desk
  const recZ = 5.3;
  // Stone-clad reception desk with a walnut top, floating on a lit plinth.
  b.box(mat.stone, 4.6, 1.0, 0.8, [0, 0.58, recZ]);
  b.box(mat.light, 4.4, 0.04, 0.02, [0, 0.07, recZ - 0.36]);
  b.box(mat.black, 4.4, 0.08, 0.7, [0, 0.04, recZ]);
  b.rounded(mat.darkWood, 4.9, 0.06, 1.0, 0.015, [0, 1.11, recZ + 0.05]);
  b.box(mat.wood, 4.4, 0.04, 0.5, [0, 0.78, recZ + 0.3]); // work surface behind
  b.rounded(mat.black, 0.55, 0.36, 0.02, 0.008, [1.55, 1.33, recZ + 0.25]);
  b.add(mat.ceramic, new THREE.CylinderGeometry(0.06, 0.05, 0.28, 18), [-1.7, 1.28, recZ + 0.1]);
  for (let i = 0; i < 5; i++) b.add(i % 2 ? mat.leaf : mat.leaf2, leafGeo(0.14, 0.05), [-1.7, 1.42, recZ + 0.1], i * 1.3, -0.9, 0);
  b.box(mat.metal, 0.05, 0.16, 0.05, [1.55, 1.15, recZ + 0.28]);
  if (businessDemo) {
    // Keep the desk secondary to the brand wall: a small service marker, not another tower logo.
    const { c } = canvas(1024, 160);
    const drawDeskBrand = () => {
      const g = c.getContext('2d')!;
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = '#10131a'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#14F195'; g.fillRect(0, 0, c.width, 3); g.fillRect(0, c.height - 3, c.width, 3);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#ddd8ca'; g.font = '600 46px Inter, Arial, sans-serif';
      g.fillText('RECEPTION', c.width / 2, c.height / 2);
    };
    drawDeskBrand();
    const deskTexture = T(texFrom(c));
    const deskGeometry = new THREE.PlaneGeometry(2.35, 0.37);
    geos.push(deskGeometry);
    const deskSign = new THREE.Mesh(deskGeometry, M(new THREE.MeshBasicMaterial({ map: deskTexture, toneMapped: false })));
    deskSign.position.set(0, 0.61, recZ - 0.405);
    deskSign.rotation.y = Math.PI;
    deskSign.renderOrder = 4;
    root.add(deskSign);
  }
  solid(-2.45, recZ - 0.5, 2.45, recZ + 0.55, 2);
  const receptionistX = businessDemo ? -0.85 : 0;
  const receptionist = spawnNpc('reception', 'reception', makeNpc(0x2b3a55, 0xffcc33), receptionistX, recZ + 1.05, Math.PI);
  // The physical HQ brand wall is already the reception identifier; another floating label would
  // sit directly across the logo from the entry camera.
  if (!businessDemo) addLabel('lbl-reception', new THREE.Vector3(receptionistX, 2.15, recZ + 1.05), `Reception <small>${esc(repo.name)}</small>`, { maxDist: 16 });

  // Logo wall
  {
    const wz = LOBBY - 0.6;
    b.box(businessDemo ? mat.black : mat.darkWood, 11, 3.7, 0.3, [0, 1.85, wz]);
    // Vertical walnut slats either side of the logo panel, and a lit reveal at the top.
    for (const sx of [-1, 1]) for (let k = 0; k < 12; k++) b.box(mat.darkWood, 0.05, H - 0.05, 0.08, [sx * (5.62 + k * 0.12), (H - 0.05) / 2, wz]);
    b.box(mat.light, 10.6, 0.02, 0.04, [0, 3.75, wz - 0.2]);
    if (businessDemo) {
      // Slim gold reveals make the reception wall read as the HQ's signature brand wall.
      b.box(mat.brass, 10.6, 0.035, 0.06, [0, 3.68, wz - 0.22]);
      b.box(mat.brass, 10.6, 0.035, 0.06, [0, 0.02, wz - 0.22]);
    }
    solid(-7.1, wz - 0.1, 7.1, wz + 0.1, 5);
    solid(-5.5, wz - 0.2, 5.5, wz + 0.2, 5);
    const { c } = canvas(2048, 680);
    const drawTowerWall = () => {
      const g = c.getContext('2d')!;
      g.clearRect(0, 0, c.width, c.height);
      const grad = g.createLinearGradient(0, 0, c.width, c.height);
      grad.addColorStop(0, '#171b24'); grad.addColorStop(0.52, '#080a0f'); grad.addColorStop(1, '#11151d');
      g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);
      // Dark architectural ribs and a restrained gold frame replace the placeholder gold wall.
      g.fillStyle = 'rgba(255,255,255,.025)';
      for (let x = 18; x < c.width; x += 46) g.fillRect(x, 0, 12, c.height);
      g.fillStyle = '#F3BA2F'; g.fillRect(0, 0, c.width, 8); g.fillRect(0, c.height - 8, c.width, 8);
      g.fillStyle = 'rgba(153,69,255,.45)'; g.fillRect(280, 116, 1488, 2);
      const mark = 320;
      drawTowerMark(g, 430, (c.height - mark) / 2, mark, '#ffbd91');
      g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillStyle = '#ffbd91';
      g.font = '700 138px Inter, Arial, sans-serif'; g.fillText('OPEN WORLD', 815, 307, 950);
      g.fillStyle = '#d9d5cc';
      g.font = '600 43px Inter, Arial, sans-serif'; g.fillText(ui('纽约城市运营总部', 'NEW YORK CITY OPERATIONS'), 850, 414);
      g.textAlign = 'right'; g.fillStyle = '#F3BA2F';
      g.font = '700 28px Inter, Arial, sans-serif'; g.fillText(ui('OPEN WORLD  /  纽约', 'OPEN WORLD  /  NYC'), 1740, 530);
    };
    if (businessDemo) drawTowerWall(); else drawLogoWall(c, repo, null);
    const t = T(texFrom(c));
    const g = new THREE.PlaneGeometry(10.6, 3.5);
    geos.push(g);
    const wallMaterial = businessDemo
      ? new THREE.MeshBasicMaterial({ map: t, toneMapped: false })
      : new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.35 });
    const m = new THREE.Mesh(g, M(wallMaterial));
    m.position.set(0, 1.88, wz - 0.16);
    m.rotation.y = Math.PI;
    root.add(m);
    // Back side of the wall faces the lift lobby: a big brand stripe.
    b.box(mat.accent, 10.6, 0.08, 0.02, [0, 3.4, wz + 0.16]);
    if (!businessDemo && repo.hasLogo) {
      const img = new Image();
      img.onload = () => { drawLogoWall(c, repo, img); t.needsUpdate = true; };
      img.src = api.logoUrl(repo.name);
    }
  }

  // Directory totem (in the tower: on the right, opposite the live board)
  {
    const x = businessDemo ? 7.8 : -7.6, z = businessDemo ? 7.0 : 6.2;
    b.box(mat.black, 1.3, 2.3, 0.2, [x, 1.15, z]);
    if (businessDemo) { b.box(mat.brass, 1.34, 0.03, 0.24, [x, 2.315, z]); b.box(mat.brass, 1.34, 0.03, 0.24, [x, 0.015, z]); }
    solid(x - 0.7, z - 0.15, x + 0.7, z + 0.15, 3);
    const { c } = canvas(560, 1000);
    drawSign(c, businessDemo ? ui('Agent 大厦', 'Agent Tower') : repo.name, businessDemo ? [
      [ui('L  城市服务大堂', 'L  City lobby'), ui('利润榜 · 前台导览', 'Standings · reception')],
      [ui('12  商战大厅', '12  Standings Hall'), ui('利润榜 · 每家店的工位', 'Standings · a desk per shop')],
      [ui('36  Agent 接入中心', '36  Agent Onboarding'), ui('Agent ID 开店 · 每日经营计划', 'Open a shop with an Agent ID · daily plans')],
      [ui('48  商圈指挥室', '48  District Room'), ui('时代广场 · 剧院区 · 冬季集市', 'Times Square · Theater District · Winter Market')],
      [ui('60  BNB 奖池', '60  BNB Prize Pool'), ui('交易税奖池 · Agent 自己领取', 'Trading-tax pool · Agents claim')],
      [ui('71  天际酒廊', '71  Skyline Lounge'), ui('城市观景 · 吧台', 'City views · bar')],
      [ui('R  屋顶', 'R  Roof'), ui('走上塔顶 · 城市观景', 'Out on top · city views')],
    ] : [
      ['L  Lobby', 'Front desk · ask about the project'],
      ['2  Work floor', `${detail.workers.length} desks · past PRs & commits`],
      ['3  Agent Lab', 'Hire Claude agents'],
      ['4  Boardroom', 'Big decisions'],
      ['R  Roof terrace', 'Out on top of the tower · lifts behind the logo wall'],
    ]);
    const g = new THREE.PlaneGeometry(1.2, 2.14);
    geos.push(g);
    const m = new THREE.Mesh(g, M(new THREE.MeshBasicMaterial({ map: T(texFrom(c)) })));
    m.position.set(x, 1.17, z - 0.11);
    m.rotation.y = Math.PI;
    root.add(m);
    if (businessDemo) addInteract('directory', new THREE.Vector3(x, 0, z - 0.9), 1.6, ui('查看楼层导览', 'Floor guide'), ui('每层能做什么 · 规则与接入', 'What each floor does · rules & onboarding'), openApp('guide'));
  }
  // The live board: a big screen by the entrance with the round clock and what's on.
  if (businessDemo) {
    const x = -8.0, z = 7.6, w = 4.4, h = 2.475, y = 0.95 + h / 2;
    b.box(mat.stone, w + 0.5, 0.95, 0.6, [x, 0.475, z + 0.05]);
    b.box(mat.brass, w + 0.52, 0.03, 0.62, [x, 0.96, z + 0.05]);
    b.box(mat.light, w + 0.2, 0.02, 0.02, [x, 0.06, z - 0.26]);
    b.box(mat.black, w + 0.3, h + 0.3, 0.2, [x, y, z + 0.18]);
    liveScreen(w, h, 1600, [x, y, z + 0.06], Math.PI, (c) => drawTycoonScreen(c), 1, 0);
    solid(x - w / 2 - 0.3, z - 0.3, x + w / 2 + 0.3, z + 0.4, 4);
    addInteract('live-board', new THREE.Vector3(x, 0, z - 1.2), 2.2, ui('打开手机看排行榜', 'Standings on the phone'), ui('每家店的利润与客流', 'Profit and foot traffic per shop'), openApp('ranking'));
  }
  lounge(3.6);
  {
    const lobbyGlow = new THREE.PointLight(brand, businessDemo ? 2.4 : 8, 9, 2);
    lobbyGlow.position.set(0, 2, LOBBY - 1.5);
    root.add(lobbyGlow);
  }
  // The work, waiting for you: a parcel shelf of open pull requests on the right, and on the left
  // the table where agents drop what they finished for your review. (Parcels are rebuilt live below.)
  const shelf = { x: 7.4, z: 7.2, w: 3.3, tiers: [0.05, 0.62, 1.19] };
  const desk2 = { x: -4.6, z: 7.0, w: 2.5, h: 0.76 };
  if (!businessDemo) {
    const { x, z, w } = shelf;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(mat.metal, 0.04, 1.78, 0.04, [x + sx * (w / 2 - 0.02), 0.89, z + sz * 0.26]);
    for (const y of shelf.tiers) b.box(mat.wood, w, 0.035, 0.56, [x, y + 0.0, z]);
    b.box(mat.wood, w, 0.035, 0.56, [x, 1.76, z]);
    b.box(mat.metal, w, 0.02, 0.02, [x, 1.5, z + 0.27]);
    solid(x - w / 2, z - 0.3, x + w / 2, z + 0.3, 2);
    const { c } = canvas(640, 128);
    drawShelfSign(c, businessDemo ? ui('今日大屏', 'Today on the screens') : 'Pull requests', businessDemo ? ui('LED 大屏竞拍结果', 'Screen auction results') : `Open on GitHub · press ${keymap.label('interact')} on a parcel`, '#4fd1ff');
    const g = new THREE.PlaneGeometry(1.6, 0.32);
    geos.push(g);
    const m = new THREE.Mesh(g, M(new THREE.MeshBasicMaterial({ map: T(texFrom(c)), toneMapped: false })));
    m.position.set(x, 2.3, z - 0.05);
    m.rotation.y = Math.PI;
    root.add(m);
    b.box(mat.metal, 0.01, H - 2.46, 0.01, [x - 0.7, 2.46 + (H - 2.46) / 2, z - 0.05]);
    b.box(mat.metal, 0.01, H - 2.46, 0.01, [x + 0.7, 2.46 + (H - 2.46) / 2, z - 0.05]);
  }
  if (!businessDemo) {
    const { x, z, w, h } = desk2;
    b.rounded(mat.darkWood, w, 0.05, 0.8, 0.012, [x, h, z]);
    b.box(mat.stone, w - 0.1, h - 0.03, 0.06, [x, (h - 0.03) / 2, z - 0.34]);
    for (const sx of [-1, 1]) b.box(mat.stone, 0.06, h - 0.03, 0.74, [x + sx * (w / 2 - 0.05), (h - 0.03) / 2, z]);
    b.box(mat.light, w - 0.2, 0.02, 0.02, [x, 0.05, z - 0.38]);
    solid(x - w / 2, z - 0.42, x + w / 2, z + 0.42, 1.2);
    const { c } = canvas(640, 128);
    drawShelfSign(c, businessDemo ? ui('赛事结果与复盘', 'Results & Round Review') : 'Ready for review', businessDemo ? ui('成功、失误、证据与奖池变化', 'Wins, mistakes, evidence & prize changes') : `Finished agent runs · press ${keymap.label('interact')}`, '#2ee6c9');
    const g = new THREE.PlaneGeometry(1.6, 0.32);
    geos.push(g);
    const m = new THREE.Mesh(g, M(new THREE.MeshBasicMaterial({ map: T(texFrom(c)), toneMapped: false })));
    m.position.set(x, 2.3, z);
    m.rotation.y = Math.PI;
    root.add(m);
    b.box(mat.metal, 0.01, H - 2.46, 0.01, [x - 0.7, 2.46 + (H - 2.46) / 2, z]);
    b.box(mat.metal, 0.01, H - 2.46, 0.01, [x + 0.7, 2.46 + (H - 2.46) / 2, z]);
  }
  const lobbyWork = new THREE.Group();
  root.add(lobbyWork);
  addInteract('exit', new THREE.Vector3(0, 0, 0.8), 1.7, businessDemo ? ui('返回街道', 'Exit to the street') : 'Exit to the street', repo.name, () => ctx.exitBuilding());
  if (businessDemo) liftStrip();
  endFloor();

  // =============================== WORK FLOOR ===============================
  beginFloor(WORK_F);
  floorMesh(carpetFloor, -W / 2, 6.5, W / 2, DEPTH[WORK_F], 0);
  floorMesh(carpetWarm, -4, 0, W / 2, 6.5, 0);
  floorMesh(oakFloor, -W / 2, 0, -4, 6.5, 0);
  b.box(mat.trim, 0.03, 0.006, 6.5, [-4, 0.003, 3.25]);
  shell(WORK_F, true);
  plate(businessDemo ? ui('商战大厅 · 12', 'STANDINGS HALL · 12') : 'WORK FLOOR', '#4fd1ff', 0, LIFT_FRONT);
  // A coffee bar by the front windows, off to one side. (Keep the middle clear: the lobby's spawn
  // point is below it, and the player is dropped onto the highest thing under it.)
  {
    const cx = -9.4, cz = 1.0;
    kitchen(cx, cz, 4.6, 1, false);
    // Island with a quartz top and stools.
    const iz = cz + 2.2;
    b.box(mat.wood, 4.2, 0.92, 0.9, [cx, 0.46, iz]);
    b.box(mat.quartz, 4.5, 0.04, 1.1, [cx, 0.94, iz + 0.05]);
    for (const x of [-1.5, -0.5, 0.5, 1.5]) {
      b.cyl(mat.leather, 0.19, 0.19, 0.06, [cx + x, 0.74, iz + 0.95], 18);
      b.cyl(mat.metal, 0.025, 0.025, 0.7, [cx + x, 0.36, iz + 0.95], 8);
      b.cyl(mat.metal, 0.2, 0.2, 0.02, [cx + x, 0.01, iz + 0.95], 16);
    }
    for (const x of [-1.4, 0, 1.4]) {
      b.cyl(mat.metal, 0.005, 0.005, H - 2.2, [cx + x, 2.2 + (H - 2.2) / 2, iz], 4);
      b.add(mat.black, new THREE.ConeGeometry(0.2, 0.22, 20, 1, true), [cx + x, 2.15, iz]);
      b.cyl(mat.light, 0.17, 0.17, 0.01, [cx + x, 2.04, iz], 16);
    }
    solid(cx - 2.3, iz - 0.5, cx + 2.3, iz + 0.6, 1.2);
  }
  lounge(6.2);
  if (!businessDemo) { pod(W / 2 - 2.0, 12.6); pod(W / 2 - 3.6, 12.6); }
  // The issues board: a freestanding glass board facing the lifts, one sticky note per open issue.
  const issueC = canvas(1600, 900).c;
  const issueT = T(texFrom(issueC));
  const board = { x: 6.6, z: 8.4 };
  if (businessDemo) {
    // ---- Watch Hall: the public view on a cinema wall, boards either side, rows of seats ----
    const Dw = DEPTH[WORK_F], wallZ = Dw - 0.35, sw = 13, sh = sw * 600 / 2048, sy = 0.75 + sh / 2;
    b.box(mat.black, sw + 0.6, H, 0.3, [0, H / 2, wallZ + 0.12]);
    b.box(mat.brass, sw + 0.6, 0.035, 0.06, [0, sy + sh / 2 + 0.22, wallZ - 0.05]);
    b.box(mat.light, sw + 0.2, 0.02, 0.04, [0, 0.08, wallZ - 0.1]);
    liveScreen(sw, sh, 2048, [0, sy, wallZ - 0.04], Math.PI, (c) => drawTycoonScreen(c), 1, 0);
    solid(-sw / 2 - 0.3, wallZ - 0.1, sw / 2 + 0.3, wallZ + 0.3, 5);
    // Dark carpet under the seats, and three rows of sofas facing the wall.
    b.rounded(S('felt', { tint: 0x1d2230 }), sw - 1, 0.014, 10.4, 0.005, [0, 0.007, wallZ - 8.2]);
    for (const [k, z] of [wallZ - 5.2, wallZ - 7.8, wallZ - 10.4].entries()) {
      for (const x of [-4.4, -1.65, 1.65, 4.4]) {
        sofa(x, z, 0, k === 0 ? mat.leather : mat.sofa2, 2.5);
        solid(x - 1.25, z - 0.45, x + 1.25, z + 0.45, 1.1);
      }
    }
    // Leaderboard pillars either side of the wall.
    for (const side of [-1, 1]) {
      const x = side * (sw / 2 + 2.6), z = wallZ - 1.6;
      b.box(mat.black, 2.9, H, 0.5, [x, H / 2, z + 0.25]);
      b.box(mat.brass, 0.03, H, 0.52, [x - 1.46, H / 2, z + 0.25]);
      b.box(mat.brass, 0.03, H, 0.52, [x + 1.46, H / 2, z + 0.25]);
      solid(x - 1.5, z - 0.05, x + 1.5, z + 0.55, 5);
      liveScreen(2.4, 3.6, 900, [x, 2.35, z - 0.02], Math.PI, (c) => drawTycoonScreen(c, side < 0 ? 'districts' : 'screens'), 2, 0);
    }
    addInteract('watch-live', new THREE.Vector3(0, 0, wallZ - 3.2), 3, ui('查看利润榜', 'View the standings'), ui('利润 · 客流 · 店主留言', 'Profit · traffic · owner notes'), openApp('ranking'));
    addLabel('lbl-watch', new THREE.Vector3(0, H - 0.15, wallZ - 0.3), ui('商战大厅', 'Standings Hall'), { maxDist: 30 });
    liftStrip();
  } else {
    const { x, z } = board;
    const bw = 3.6, bh = 2.02;
    b.box(mat.whiteSteel, bw + 0.08, bh + 0.08, 0.04, [x, 1.95, z]);
    for (const sx of [-1, 1]) {
      b.box(mat.whiteSteel, 0.05, 2.0, 0.05, [x + sx * (bw / 2 - 0.1), 1.0, z]);
      b.box(mat.whiteSteel, 0.05, 0.03, 0.6, [x + sx * (bw / 2 - 0.1), 0.02, z]);
    }
    b.box(mat.whiteSteel, bw - 0.4, 0.03, 0.08, [x, 0.92, z + 0.05]); // marker ledge
    solid(x - bw / 2, z - 0.3, x + bw / 2, z + 0.3, 3);
    const g = new THREE.PlaneGeometry(bw, bh);
    geos.push(g);
    const m = new THREE.Mesh(g, M(new THREE.MeshStandardMaterial({ map: issueT, roughness: 0.25 })));
    m.position.set(x, 1.95, z + 0.025);
    root.add(m);
    addInteract('issues', new THREE.Vector3(x, 0, z + 1.0), 2.2, 'Open issues', `${repo.name} on GitHub`, () => window.open(`${repo.url}/issues`, '_blank', 'noopener'));
  }
  for (const z of [9, 21]) { column(-(W / 2 - 3), z); column(W / 2 - 3, z); }
  plant(-W / 2 + 1.2, 1.2, 1.3); plant(W / 2 - 1.2, 1.2, 1.3);
  plant(-W / 2 + 0.9, DEPTH[WORK_F] - 0.9); plant(W / 2 - 0.9, DEPTH[WORK_F] - 0.9);
  plant(-2.6, LIFT_FRONT - 0.5, 0.9); plant(2.6, LIFT_FRONT - 0.5, 0.9);

  const workers = detail.workers.slice(0, 24);
  const COLS = 6;
  const rowsZ = [16.8, 20.3, 23.8, 27.3];
  const nDesks = businessDemo ? 0 : Math.min(24, Math.max(12, Math.ceil(workers.length / COLS) * COLS));
  const colX = (i: number) => -(W / 2 - 5) + (i * (W - 10)) / (COLS - 1);
  const workerNpcs = new Map<string, Npc>();
  for (let i = 0; i < nDesks; i++) {
    const x = colX(i % COLS), z = rowsZ[Math.floor(i / COLS)];
    const { c, t } = desk(x, z);
    const w = workers[i];
    if (!w) { drawIdleMonitor(c, i * 31 + 7, businessDemo ? ui('空置工位', 'Unoccupied workstation') : 'Hot desk'); t.needsUpdate = true; continue; }
    drawWorkerMonitor(c, w);
    t.needsUpdate = true;
    const r = rng(hashStr(w.id));
    const ch = w.isAgent
      ? makeNpc(0xd5dde6, 0x2ee6c9, { glow: true })
      : makeNpc(CLOTHES[Math.floor(r() * CLOTHES.length)], [0x1a1a1f, 0x3b2a20, 0x2a2a35][Math.floor(r() * 3)]);
    const nx = x + (r() - 0.5) * 0.3, nz = z - 0.78;
    const n = spawnNpc(`w-${w.id}`, 'worker', ch, nx, nz, 0);
    workerNpcs.set(w.id, n);
    const ref = w.kind === 'pr' ? `PR #${w.number}` : w.sha?.slice(0, 7) ?? '';
    const name = w.isAgent ? (w.agentName ?? w.author) : w.author;
    addLabel(`lbl-${w.id}`, new THREE.Vector3(nx, 2.12, nz), `${esc(name)} <small>${esc(ref)}</small>${w.isAgent ? ' <span class="tag agent">AI agent</span>' : ''}`, { cls: w.isAgent ? 'agent' : '', maxDist: 14 });
    addInteract(`w-${w.id}`, new THREE.Vector3(nx, 0, nz), 2.1, businessDemo ? ui(`与 ${name} 交谈`, `Talk to ${name}`) : `Talk to ${name}`, `${ref} · ${w.title.slice(0, 48)}`, () => talkTo(n, w));
  }
  endFloor();

  // =============================== AGENT LAB ===============================
  beginFloor(LAB_F);
  floorMesh(carpetWarm, -W / 2, 0, W / 2, 14, 0);
  floorMesh(concreteFloor, -W / 2, 14, W / 2, DEPTH[LAB_F], 0);
  b.box(mat.brass, W, 0.006, 0.04, [0, 0.003, 14]);
  shell(LAB_F, true, 'exposed');
  plate(businessDemo ? ui('Agent 接入中心 · 36', 'AGENT ONBOARDING · 36') : 'AGENT LAB', '#3ddc97', 0, LIFT_FRONT);
  lounge(4);
  if (businessDemo) {
    staticScreen(8.6, 1.3, 1400, [0, 3.35, 5.4], 0, (c) => drawBanner(c, ui('派你的 Agent 来开店', 'SEND YOUR AGENT'), ui('只有 Agent ID 能开店、分 BNB 奖池', 'Only an Agent ID runs a shop and wins BNB'), '#ffb698'));
    // Onboarding lectern by the lifts (replaces the old hire kiosk).
    const lx = -4.4, lz = 9.0;
    b.box(mat.black, 0.8, 1.05, 0.5, [lx, 0.525, lz]);
    b.box(mat.brass, 0.84, 0.03, 0.54, [lx, 1.065, lz]);
    solid(lx - 0.45, lz - 0.3, lx + 0.45, lz + 0.3, 2);
    const lect = staticScreen(0.76, 0.5, 600, [lx, 1.32, lz - 0.05], Math.PI, (c) => drawBanner(c, ui('Agent 接入', 'Connect an Agent'), ui('官方钱包 · 开发者模式', 'Official wallet · Developer Mode'), '#2ee6c9'));
    lect.rotation.set(-0.55, Math.PI, 0, 'YXZ');
    b.box(mat.black, 0.84, 0.58, 0.05, [lx, 1.3, lz + 0.02], Math.PI);
    addInteract('onboard', new THREE.Vector3(lx, 0, lz - 0.9), 1.8, ui('派 Agent 来开店', 'Send an Agent to open a shop'), ui('Agent ID · 每日计划 · BNB 奖池', 'Agent ID · daily plans · BNB pool'), openApp('guide'));
    liftStrip();
  }
  for (const z of [9]) { column(-(W / 2 - 3), z); column(W / 2 - 3, z); }
  plant(-W / 2 + 1.2, 1.2, 1.3); plant(W / 2 - 1.2, 1.2, 1.3);
  plant(-W / 2 + 0.9, DEPTH[LAB_F] - 0.9); plant(W / 2 - 0.9, DEPTH[LAB_F] - 0.9);
  const labSlots: { x: number; z: number; c: HTMLCanvasElement; t: THREE.CanvasTexture; agentId: string | null }[] = [];
  const labCols = 8;
  const labRows = [16.6, 19.8, 23.0];
  const labX = (i: number) => -(W / 2 - 4) + (i * (W - 8)) / (labCols - 1);
  for (let i = 0; !businessDemo && i < labCols * labRows.length; i++) {
    const x = labX(i % labCols), z = labRows[Math.floor(i / labCols)];
    const { c, t } = desk(x, z);
    drawIdleMonitor(c, Math.floor(x * 13 + z), 'Free desk — hire an agent');
    t.needsUpdate = true;
    labSlots.push({ x, z, c, t, agentId: null });
  }
  // Kiosk
  const kiosk = new THREE.Vector3(labCx - 4.6, 0, 14.8);
  if (!businessDemo) {
    b.box(mat.black, 0.6, 1.1, 0.4, [kiosk.x, 0.55, kiosk.z]);
    b.box(mat.accent, 0.62, 0.04, 0.42, [kiosk.x, 0.03, kiosk.z]);
    solid(kiosk.x - 0.35, kiosk.z - 0.25, kiosk.x + 0.35, kiosk.z + 0.25, 2);
    const { c, g } = canvas(400, 300);
    g.fillStyle = '#071a14'; g.fillRect(0, 0, 400, 300);
    g.fillStyle = '#3ddc97'; g.font = '800 44px Inter, sans-serif'; g.fillText(businessDemo ? ui('派发', 'Dispatch') : 'Hire an', 30, 110); g.fillText(businessDemo ? ui('赛事任务', 'challenge') : 'agent', 30, 160);
    g.fillStyle = '#9aa6b8'; g.font = '500 24px Inter, sans-serif'; g.fillText(businessDemo ? ui('竞技场 · 模拟演示', 'Arena · local demo') : `Claude Code · press ${keymap.label('interact')}`, 30, 220);
    const geo = new THREE.PlaneGeometry(0.7, 0.52);
    geos.push(geo);
    const m = new THREE.Mesh(geo, M(new THREE.MeshBasicMaterial({ map: T(texFrom(c)), toneMapped: false })));
    m.position.set(kiosk.x, 1.35, kiosk.z + 0.05);
    m.rotation.set(0.5, Math.PI, 0);
    root.add(m);
    b.box(mat.black, 0.76, 0.58, 0.05, [kiosk.x, 1.35, kiosk.z + 0.09]);
    addLabel('lbl-kiosk', new THREE.Vector3(kiosk.x, 1.95, kiosk.z), businessDemo ? ui('Agent 接入', 'Agent onboarding') : 'Hire an agent', { cls: 'agent', maxDist: 12 });
    addInteract('kiosk', new THREE.Vector3(kiosk.x, 0, kiosk.z - 0.4), 2, businessDemo ? ui('查看 Agent 接入与赛事规则', 'View Agent onboarding & competition rules') : 'Hire an agent', businessDemo ? ui('开放报名 · 参赛规则 · 奖励规则', 'Open entry · race rules · rewards') : `Claude Code works on ${repo.name}`, () => {
      if (businessDemo) window.dispatchEvent(new CustomEvent('agent-city:open-economy', { detail: { app: 'guide' } }));
      else openHireAgentPanel(ctx, repo, detail, (a) => upsertAgent(a));
    });
  }
  // Live feed wall screen
  const feedC = canvas(1600, 620).c;
  const feedT = T(texFrom(feedC));
  if (businessDemo) {
    // The public arena event log (connections, submissions, results), newest first.
    b.box(mat.black, 14.8, 3.7, 0.1, [labCx, 2.4, DEPTH[LAB_F] - 0.22]);
    liveScreen(14.4, 3.5, 1800, [labCx, 2.4, DEPTH[LAB_F] - 0.3], Math.PI, (c) => drawTycoonScreen(c), 1, 0);
  } else {
    const Dl = DEPTH[LAB_F];
    const g = new THREE.PlaneGeometry(8.4, 3.25);
    geos.push(g);
    const m = new THREE.Mesh(g, M(new THREE.MeshBasicMaterial({ map: feedT, toneMapped: false })));
    m.position.set(labCx, 2.25, Dl - 0.3);
    m.rotation.y = Math.PI;
    root.add(m);
    b.box(mat.black, 8.6, 3.45, 0.1, [labCx, 2.25, Dl - 0.22]);
  }
  endFloor();

  // =============================== LIVE STUDIO ===============================
  if (businessDemo) {
    beginFloor(STUDIO_F);
    const sd = DEPTH[STUDIO_F];
    floorMesh(carpetFloor, -W / 2, 0, W / 2, sd, 0);
    shell(STUDIO_F, true, 'exposed');
    plate(ui('商圈指挥室 · 48', 'DISTRICT ROOM · 48'), '#4fd1ff', 0, LIFT_FRONT);
    lounge(4);
    liveScreen(12, 4, 1600, [0, 2.5, sd - 0.32], Math.PI, (c) => drawTycoonScreen(c, 'districts'), 2);
    addInteract('studio', new THREE.Vector3(0, 0, sd - 3.2), 2.4, ui('查看商圈', 'View the districts'), ui('三个街区 · 每个经营位', 'Three districts · every lot'), openApp('city'), STUDIO_F);
    liftStrip();
    endFloor();
  }

  // =============================== BOARDROOM ===============================
  beginFloor(BOARD_F);
  const brdZ0 = 14.2, brdHalf = 6.5;
  floorMesh(carpetWarm, -W / 2, 0, W / 2, brdZ0, 0);
  floorMesh(carpetWarm, -W / 2, brdZ0, -brdHalf, DEPTH[BOARD_F], 0);
  floorMesh(carpetWarm, brdHalf, brdZ0, W / 2, DEPTH[BOARD_F], 0);
  floorMesh(businessDemo ? carpetWarm : walnutFloor, -brdHalf, brdZ0, brdHalf, DEPTH[BOARD_F], 0);
  shell(BOARD_F, true);
  plate(businessDemo ? ui('城市奖池 · 60', 'CITY REWARDS · 60') : 'BOARDROOM', '#ffcc33', 0, LIFT_FRONT);
  lounge(4);
  column(-(W / 2 - 3), 9); column(W / 2 - 3, 9);
  plant(-W / 2 + 1.2, 1.2, 1.3); plant(W / 2 - 1.2, 1.2, 1.3);
  plant(-W / 2 + 0.9, DEPTH[BOARD_F] - 0.9); plant(W / 2 - 0.9, DEPTH[BOARD_F] - 0.9);
  if (businessDemo) {
    const Dt = DEPTH[BOARD_F];
    b.box(mat.black, 9.4, 3.75, 0.12, [0, 2.6, Dt - 0.22]);
    liveScreen(9, 3.375, 1600, [0, 2.6, Dt - 0.3], Math.PI, (c) => drawTycoonScreen(c, 'rewards'), 3, 0);
    addInteract('treasury-wall', new THREE.Vector3(0, 0, Dt - 2.4), 2.4, ui('查看 BNB 奖池', 'View the BNB prize pool'), ui('交易税奖池 · 按利润排名发奖', 'Trading-tax pool · paid by profit rank'), openApp('rewards'));
    liftStrip();
  } else {
  rug(brdCx, brdCz, 4.6, 9.2);
  glassWall(-brdHalf, brdZ0, brdHalf, brdZ0, 2 * brdHalf - 2);
  glassWall(-brdHalf, brdZ0, -brdHalf, DEPTH[BOARD_F]);
  glassWall(brdHalf, brdZ0, brdHalf, DEPTH[BOARD_F]);
  plant(-brdHalf - 1, brdZ0 + 1); plant(brdHalf + 1, brdZ0 + 1);
  }
  if (!businessDemo) {
    b.rounded(mat.darkWood, 2.4, 0.07, 7.2, 0.03, [brdCx, 0.76, brdCz]);
    b.box(mat.metal, 0.5, 0.72, 2.2, [brdCx, 0.36, brdCz - 2]);
    b.box(mat.metal, 0.5, 0.72, 2.2, [brdCx, 0.36, brdCz + 2]);
    b.box(mat.brass, 0.03, 0.004, 6.8, [brdCx, 0.797, brdCz]);
    for (const dz of [-2.4, 0, 2.4]) b.rounded(mat.black, 0.32, 0.01, 0.12, 0.004, [brdCx, 0.8, brdCz + dz]); // power modules
    solid(brdCx - 1.25, brdCz - 3.65, brdCx + 1.25, brdCz + 3.65, 1.2);
    for (const sx of [-1, 1]) for (const dz of [-2.7, 0, 2.7]) taskChair(brdCx + sx * 1.65, brdCz + dz, sx > 0 ? -Math.PI / 2 : Math.PI / 2, true);
    // A long linear pendant over the table
    b.box(mat.metal, 0.006, H - 2.3, 0.006, [brdCx, 2.3 + (H - 2.3) / 2, brdCz - 2.6]);
    b.box(mat.metal, 0.006, H - 2.3, 0.006, [brdCx, 2.3 + (H - 2.3) / 2, brdCz + 2.6]);
    b.box(mat.black, 0.12, 0.06, 6.2, [brdCx, 2.3, brdCz]);
    b.box(mat.light, 0.08, 0.01, 6.1, [brdCx, 2.267, brdCz]);
    // Credenza along the back wall and a pair of plants.
    b.box(mat.darkWood, 4.4, 0.7, 0.5, [brdCx, 0.35, DEPTH[BOARD_F] - 1.1]);
  }
  const decC = canvas(1400, 520).c;
  const decT = T(texFrom(decC));
  drawDecisions(decC, detail.decisions);
  decT.needsUpdate = true;
  if (!businessDemo) {
    const Db = DEPTH[BOARD_F];
    const g = new THREE.PlaneGeometry(5.6, 2.08);
    geos.push(g);
    const m = new THREE.Mesh(g, M(new THREE.MeshBasicMaterial({ map: decT, toneMapped: false })));
    m.position.set(brdCx, 2.85, Db - 0.3);
    m.rotation.y = Math.PI;
    root.add(m);
    b.box(mat.black, 5.8, 2.25, 0.1, [brdCx, 2.85, Db - 0.22]);
  }
  const boardNpcs = new Map<string, Npc>();
  const seats: Record<string, [number, number, number]> = {
    chair: [brdCx, brdCz + 4.25, Math.PI],
    cto: [brdCx - 1.75, brdCz - 1.35, Math.PI / 2],
    product: [brdCx - 1.75, brdCz + 1.35, Math.PI / 2],
    design: [brdCx + 1.75, brdCz - 1.35, -Math.PI / 2],
    growth: [brdCx + 1.75, brdCz + 1.35, -Math.PI / 2],
  };
  for (const m of businessDemo ? [] : BOARD) {
    const [x, z, f] = seats[m.id];
    const col = new THREE.Color(m.color);
    const n = spawnNpc(`b-${m.id}`, 'board', makeNpc(col.clone().multiplyScalar(0.28).getHex(), col.getHex(), { glow: true }), x, z, f, false);
    boardNpcs.set(m.id, n);
    addLabel(`lbl-b-${m.id}`, new THREE.Vector3(x, 2.12, z), `${m.name} <small>${m.role}</small>`, { maxDist: 13 });
  }
  const headSpot = new THREE.Vector3(brdCx, 0, brdCz - 4.4);
  if (!businessDemo) addInteract('boardroom', headSpot, 2.2, 'Convene the board', `${detail.decisions.length} past decisions`, () => convene());
  endFloor();

  // =============================== SKYLINE LOUNGE ===============================
  // The top floor reads as a private club: marble and herringbone, brass, crystal chandeliers, a bar on
  // the skyline and two lounge suites.
  if (businessDemo) {
    beginFloor(LOUNGE_F);
    const fd = DEPTH[LOUNGE_F];
    const herringbone = S('herringbone');
    const burgundy = S('felt', { tint: 0x5a2622 });
    const ivory = S('fabric', { tint: 0xe8e0d0 });
    const velvet = S('fabric', { tint: 0x1f3a34 });
    const crystal = M(new THREE.MeshStandardMaterial({ color: 0xfff7e6, emissive: 0xffe2a8, emissiveIntensity: 0.9, roughness: 0.08, metalness: 0.1 }));
    const bottles = [0xb8742a, 0x3f6b3a, 0xd9d4c4, 0x7a2430, 0xc9a24a].map((c) => M(new THREE.MeshStandardMaterial({ color: c, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.82, emissive: c, emissiveIntensity: 0.18 })));
    floorMesh(marbleFloor, -W / 2, 0, W / 2, 13.2, 0);
    floorMesh(herringbone, -W / 2, 13.2, W / 2, fd, 0);
    b.box(mat.brass, W, 0.006, 0.05, [0, 0.003, 13.2]);
    // Brass inlay from the lifts to the windows.
    for (const sx of [-1.2, 1.2]) b.box(mat.brass, 0.04, 0.004, 9.2, [sx, 0.002, 4.9]);
    shell(LOUNGE_F, true, 'plaster');
    plate(ui('天际酒廊 · 71', 'SKYLINE LOUNGE · 71'), '#9945FF', 0, LIFT_FRONT);
    const luxRug = (x: number, z: number, w: number, d: number) => {
      b.rounded(burgundy, w, 0.014, d, 0.005, [x, 0.007, z]);
      b.box(mat.brass, w - 0.3, 0.016, 0.03, [x, 0.008, z - d / 2 + 0.15]);
      b.box(mat.brass, w - 0.3, 0.016, 0.03, [x, 0.008, z + d / 2 - 0.15]);
      b.box(mat.brass, 0.03, 0.016, d - 0.3, [x - w / 2 + 0.15, 0.008, z]);
      b.box(mat.brass, 0.03, 0.016, d - 0.3, [x + w / 2 - 0.15, 0.008, z]);
    };
    /** Tiers of brass rings hung with crystal drops and small lamps. */
    const chandelier = (x: number, z: number, r: number, tiers = 3) => {
      const top = H - 0.02;
      b.cyl(mat.brass, 0.28, 0.28, 0.05, [x, top - 0.025, z], 28);
      b.cyl(mat.brass, 0.014, 0.014, 0.8, [x, top - 0.42, z], 8);
      for (let k = 0; k < tiers; k++) {
        const rr = r * (1 - k * 0.3), y = top - 0.85 - k * 0.34;
        const ring = new THREE.TorusGeometry(rr, 0.022, 8, 56);
        ring.rotateX(Math.PI / 2);
        b.add(mat.brass, ring, [x, y, z]);
        for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + k; b.box(mat.brass, rr, 0.012, 0.012, [x + Math.cos(a) * rr / 2, y, z + Math.sin(a) * rr / 2], -a); }
        const n = Math.max(8, Math.round(rr * 20));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2, px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
          b.add(crystal, new THREE.OctahedronGeometry(0.05, 0), [px, y - 0.11, pz]);
          b.add(crystal, new THREE.OctahedronGeometry(0.03, 0), [px, y - 0.2, pz]);
          if (i % 2 === 0) b.add(mat.light, new THREE.SphereGeometry(0.034, 10, 8), [px, y + 0.05, pz]);
        }
      }
      b.add(crystal, new THREE.OctahedronGeometry(0.12, 0), [x, top - 0.85 - tiers * 0.34, z]);
    };

    // ---- The bar on the skyline (front right) ----
    {
      const bx = 12.6, bz = 4.4, bw = 7.2;
      b.box(mat.stone, bw, 1.02, 0.66, [bx, 0.51, bz]);
      for (let i = 0; i <= 12; i++) b.box(mat.brass, 0.02, 0.9, 0.02, [bx - bw / 2 + 0.3 + i * ((bw - 0.6) / 12), 0.5, bz + 0.34]);
      b.rounded(mat.darkWood, bw + 0.3, 0.07, 0.92, 0.02, [bx, 1.06, bz + 0.06]);
      b.box(mat.brass, bw + 0.3, 0.02, 0.02, [bx, 1.03, bz + 0.53]);
      b.box(mat.brass, bw, 0.035, 0.035, [bx, 0.22, bz + 0.62]); // foot rail
      for (let i = 0; i < 6; i++) b.box(mat.brass, 0.025, 0.2, 0.025, [bx - bw / 2 + 0.4 + i * ((bw - 0.8) / 5), 0.12, bz + 0.6]);
      b.box(mat.light, bw - 0.2, 0.02, 0.02, [bx, 0.04, bz + 0.36]);
      solid(bx - bw / 2 - 0.15, bz - 0.4, bx + bw / 2 + 0.15, bz + 0.68, 1.2);
      // Stools.
      for (let i = 0; i < 6; i++) {
        const sx = bx - bw / 2 + 0.65 + i * ((bw - 1.3) / 5), sz = bz + 1.05;
        b.cyl(mat.leather, 0.22, 0.2, 0.09, [sx, 0.78, sz], 20);
        b.cyl(mat.brass, 0.03, 0.03, 0.74, [sx, 0.38, sz], 10);
        b.add(mat.brass, (() => { const g = new THREE.TorusGeometry(0.17, 0.012, 6, 24); g.rotateX(Math.PI / 2); return g; })(), [sx, 0.32, sz]);
        b.cyl(mat.brass, 0.21, 0.23, 0.025, [sx, 0.012, sz], 20);
      }
      // Open back bar with lit glass shelves of bottles (the windows stay clear above it).
      const sz = bz - 1.55;
      b.box(mat.darkWood, bw, 0.95, 0.55, [bx, 0.475, sz]);
      b.box(mat.stone, bw + 0.04, 0.04, 0.59, [bx, 0.97, sz]);
      for (const [k, y] of [1.42, 1.86].entries()) {
        b.box(mat.glass, bw - 0.4, 0.025, 0.36, [bx, y, sz - 0.05]);
        b.box(mat.light, bw - 0.5, 0.01, 0.02, [bx, y - 0.02, sz + 0.1]);
        for (let i = 0; i < 22; i++) {
          const x = bx - bw / 2 + 0.4 + i * ((bw - 0.8) / 21), m = bottles[(i * 3 + k) % bottles.length];
          const h = 0.24 + ((i * 7 + k * 3) % 5) * 0.03;
          b.cyl(m, 0.04, 0.045, h, [x, y + 0.015 + h / 2, sz - 0.05], 10);
          b.cyl(m, 0.014, 0.018, 0.08, [x, y + 0.015 + h + 0.04, sz - 0.05], 6);
        }
      }
      for (const sx of [-1, 1]) b.box(mat.brass, 0.04, 1.3, 0.4, [bx + sx * (bw / 2 - 0.2), 1.6, sz - 0.05]);
      solid(bx - bw / 2, sz - 0.3, bx + bw / 2, sz + 0.3, 2.2);
      chandelier(bx, bz + 0.4, 0.75, 2);
      addLabel('lbl-bar', new THREE.Vector3(bx, 2.6, bz + 0.4), ui('天际酒廊 <small>无酒精 · 观景用</small>', 'Skyline lounge bar <small>alcohol-free · for the view</small>'), { maxDist: 14 }, LOUNGE_F);
    }

    // ---- Salon (front left): velvet sofas around a marble table ----
    {
      const sx = -12.6, sz = 4.6;
      luxRug(sx, sz, 6.4, 4.6);
      sofa(sx, sz - 1.35, 0, velvet, 2.8);
      sofa(sx, sz + 1.35, Math.PI, velvet, 2.8);
      armchair(sx - 2.55, sz, Math.PI / 2, ivory);
      armchair(sx + 2.55, sz, -Math.PI / 2, ivory);
      b.rounded(mat.stone, 1.8, 0.08, 0.9, 0.03, [sx, 0.42, sz]);
      for (const dx of [-0.7, 0.7]) b.box(mat.brass, 0.05, 0.38, 0.6, [sx + dx, 0.19, sz]);
      b.add(mat.brass, new THREE.SphereGeometry(0.12, 24, 16), [sx + 0.4, 0.58, sz]);
      b.add(mat.ceramic, new THREE.CylinderGeometry(0.07, 0.1, 0.3, 18), [sx - 0.45, 0.61, sz + 0.1]);
      solid(sx - 1.4, sz - 1.8, sx + 1.4, sz - 0.9, 1.1); solid(sx - 1.4, sz + 0.9, sx + 1.4, sz + 1.8, 1.1);
      solid(sx - 3.05, sz - 0.5, sx - 2.05, sz + 0.5, 1.1); solid(sx + 2.05, sz - 0.5, sx + 3.05, sz + 0.5, 1.1);
      solid(sx - 0.95, sz - 0.5, sx + 0.95, sz + 0.5, 0.6);
      chandelier(sx, sz, 1.0, 3);
      plant(sx - 3.6, sz - 2.0, 1.2); plant(sx + 3.6, sz - 2.0, 1.2);
    }
    // A pair of sculpture plinths framing the walk from the lifts.
    for (const sx of [-1, 1]) {
      const x = sx * 3.6, z = 6.4;
      b.box(mat.stone, 0.7, 1.1, 0.7, [x, 0.55, z]);
      b.box(mat.brass, 0.74, 0.03, 0.74, [x, 1.115, z]);
      const k = new THREE.TorusKnotGeometry(0.22, 0.06, 96, 12);
      b.add(mat.brass, k, [x, 1.5, z]);
      solid(x - 0.4, z - 0.4, x + 0.4, z + 0.4, 2);
    }

    // ---- The two executive suites ----
    const officeZ = 14.6, officeW = 6.2, officeD = 8.2, officeH = 2.85, doorW = 1.4;
    // ---- Back salon between the suites, under the grand chandelier ----
    luxRug(0, officeZ + 4.6, 7.2, 6.6);
    sofa(-1.75, officeZ + 4.6, Math.PI / 2, velvet, 2.6);
    sofa(1.75, officeZ + 4.6, -Math.PI / 2, velvet, 2.6);
    armchair(0, officeZ + 6.9, Math.PI, ivory);
    b.rounded(mat.stone, 1.0, 0.08, 1.8, 0.03, [0, 0.42, officeZ + 4.6]);
    b.box(mat.brass, 0.7, 0.38, 0.05, [0, 0.19, officeZ + 4.6]);
    solid(-2.25, officeZ + 3.3, -1.25, officeZ + 5.9, 1.1); solid(1.25, officeZ + 3.3, 2.25, officeZ + 5.9, 1.1);
    solid(-0.5, officeZ + 3.7, 0.5, officeZ + 5.5, 0.6); solid(-0.5, officeZ + 6.4, 0.5, officeZ + 7.4, 1.1);
    chandelier(0, officeZ + 4.6, 1.35, 3);
    staticScreen(8.2, 1.48, 1000, [0, 3.2, fd - 0.32], Math.PI, (c) => drawBanner(c, ui('天际酒廊', 'SKYLINE LOUNGE'), ui('Open World 虚构体验 · 社区项目', 'Fictional Open World experience · community project')));
    b.box(mat.brass, 8.4, 1.6, 0.04, [0, 3.2, fd - 0.28]);
    liftStrip();
    endFloor();
  }

  // ---------- the lift: themed tower floors, then the roof ----------
  /** Per tower floor: the lift button title, and what you can do there (shown when you arrive). */
  const FLOOR_INFO: [string, string][] = [
    [ui('城市服务大堂', 'City lobby'), ui('前台可以告诉你怎么派 Agent 来开店，左侧大屏是本季利润榜。', 'Reception explains how to send an Agent; the screen on the left shows the standings.')],
    [ui('商战大厅', 'Standings Hall'), ui('每家店一个工位，屏幕上是它的利润和留言。在大屏前按 E 打开排行榜。', 'One desk per shop, showing its profit and notes. Press E by the screen for the standings.')],
    [ui('Agent 接入中心', 'Agent Onboarding'), ui('用官方 Agentic Wallet 接入，Agent ID 就能在城里开店。', 'Use the official Agentic Wallet flow; an Agent ID can open a shop.')],
    [ui('商圈指挥室', 'District Room'), ui('时代广场、剧院区、冬季集市，每个经营位的实况。', 'Times Square, the Theater District and the Winter Market, lot by lot.')],
    [ui('BNB 奖池', 'BNB Prize Pool'), ui('交易税奖池怎么来、怎么按利润排名发。', 'Where the trading-tax pool comes from and how it pays out.')],
    [ui('天际酒廊', 'Skyline Lounge'), ui('在窗边看城市夜景。', 'Enjoy the city view from the windows.')],
  ];
  const lift = new Lift({
    parent: scene, colliders, x: 0, z: LIFT_Z, yaw: Math.PI, wallColor: 0xe4e1db, id: 'hq',
    stops: businessDemo ? [
      { y: fy(LOBBY_F), label: 'L', title: FLOOR_INFO[0][0] },
      { y: fy(WORK_F), label: '12', title: FLOOR_INFO[1][0] },
      { y: fy(LAB_F), label: '36', title: FLOOR_INFO[2][0] },
      { y: fy(STUDIO_F), label: '48', title: FLOOR_INFO[3][0] },
      { y: fy(BOARD_F), label: '60', title: FLOOR_INFO[4][0] },
      { y: fy(LOUNGE_F), label: '71', title: FLOOR_INFO[5][0] },
      { y: fy(FLOORS), label: 'R', title: ui('屋顶 · 走上塔顶看城市', 'Roof · out on top of the tower') },
    ] : [
      { y: fy(LOBBY_F), label: 'L', title: 'Lobby · reception' },
      { y: fy(WORK_F), label: '2', title: `Work floor · ${detail.workers.length} desks` },
      { y: fy(LAB_F), label: '3', title: 'Agent Lab · hire agents' },
      { y: fy(BOARD_F), label: '4', title: 'Boardroom · big decisions' },
      { y: fy(FLOORS), label: 'R', title: 'Roof terrace · step outside on top of the tower' },
    ],
    onSelect: (to) => { if (to < FLOORS) views.prepare(to); },
    onDepart: (to) => { if (to < FLOORS) showFloor(to); },
    envMap: envRT.texture,
    onArrive: (to) => {
      if (to === FLOORS) ctx.exitBuilding('roof');
      else if (businessDemo) toast(`<b>${esc(FLOOR_INFO[to][0])}</b><br>${esc(FLOOR_INFO[to][1])}`, 7000);
    },
    note: businessDemo ? () => ui('商战大厅 · 12 层', 'Standings Hall · Floor 12') : undefined,
  });
  for (let f = 0; f < FLOORS; f++) for (const it of lift.interactions(f)) {
    ctx.interactions.add(it);
    interactIds.push(it.id);
  }

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(0xfff4e6, 0xa59d90, 0.95);
  scene.add(hemi);
  // The real sun (or moon), shining in through the curtain walls: the ceilings and mullions cast
  // shadows, so daylight lands on the floor in window-shaped patches.
  const sun = new THREE.DirectionalLight(0xfff1dd, 1.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048);
  const ext = Math.max(W, D) * 0.75;
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 120 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const sunDir = new THREE.Vector3(0.4, 0.7, 0.3).normalize();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const aimSun = () => {
    const out = ctx.dayNight?.sun;
    if (out) {
      sunDir.subVectors(out.position, out.target.position).normalize().applyAxisAngle(yAxis, -(view?.yaw ?? 0));
      sun.color.copy(out.color);
      sun.intensity = sunDir.y > 0.02 ? out.intensity * 0.95 : 0;
    }
    const cy = fy(cur) + H / 2, cz = DEPTH[cur] / 2;
    sun.target.position.set(0, cy, cz);
    sun.position.set(sunDir.x * 60, cy + sunDir.y * 60, cz + sunDir.z * 60);
  };
  // The city outside, captured from inside the tower at each floor's height.
  const views = new FloorViews(scene, view, (f) => new THREE.Vector3(0, fy(f) + 1.7, D * 0.5), 0.55);

  const bounds = { minX: -W / 2 + 0.45, maxX: W / 2 - 0.45, minZ: 0.5, maxZ: DEPTH[0] - 0.45 };
  /** Make floor f the one you're on: draw it, light it, show its labels. */
  function showFloor(f: number) {
    cur = f;
    floorGroups.forEach((g, i) => { g.visible = i === f; });
    for (const s of liveScreens) if (s.floor === f) s.due = 0;
    liveClock = 0;
    bounds.maxZ = DEPTH[f] - 0.45;
    aimSun();
    backdrop.position.y = fy(f);
    if (views.show(f)) { backdrop.visible = false; hemi.intensity = 0.7; }
    lift.view(f);
    for (const [id, l] of labelDefs) {
      if (l.floor === f) ctx.labels.set(id, l.pos, l.html, l.opts);
      else ctx.labels.remove(id);
    }
  }
  showFloor(LOBBY_F);

  // ---------- speech bubbles ----------
  const speechTokens = new Map<string, number>();
  const speak = (n: Npc, text: string) => {
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t) return;
    const show = t.length > 120 ? `…${t.slice(-120)}` : t;
    speechTokens.set(n.id, (speechTokens.get(n.id) ?? 0) + 1);
    addLabel(`speech-${n.id}`, new THREE.Vector3(n.ch.root.position.x, 2.5, n.ch.root.position.z), esc(show), { cls: 'speech', maxDist: 20 }, n.floor);
  };
  const hush = (n: Npc, delay = 3500) => {
    const tok = (speechTokens.get(n.id) ?? 0) + 1;
    speechTokens.set(n.id, tok);
    setTimeout(() => { if (speechTokens.get(n.id) === tok) removeLabel(`speech-${n.id}`); }, delay);
  };

  let talking: Npc | null = null;
  function talkTo(n: Npc, w: Worker | 'reception') {
    talking = n;
    gesture(n.ch, 'agree');
    const hooks = {
      onSpeak: (t: string) => speak(n, t),
      onEnd: () => { hush(n); if (talking === n) talking = null; },
    };
    if (businessDemo && w === 'reception') openFrontDesk(hooks);
    else openWorkerPanel(ctx, repo, w, hooks);
  }
    addInteract('reception', new THREE.Vector3(receptionistX, 0, recZ - 0.8), 2.2, businessDemo ? ui('了解时代广场商战与 Agent 接入', 'Learn about Times Square Tycoon and Agent onboarding') : 'Talk to the receptionist', businessDemo ? ui('游客随便逛，只有 Agent ID 能开店', 'Visitors explore. Only Agent IDs run shops.') : `Overview of ${repo.name}`, () => talkTo(receptionist, 'reception'), LOBBY_F);

  // ---------- boardroom debate ----------
  let debating = false;
  function convene() {
    if (businessDemo) { window.dispatchEvent(new Event('agent-city:open-economy')); return; }
    debating = true;
    const all = [...boardNpcs.values()];
    openBoardroomPanel(ctx, repo, detail, {
      onTurn: (id) => {
        const sp = boardNpcs.get(id);
        if (!sp) return;
        for (const n of all) n.look = n === sp ? angleTo(n.ch.root.position, ctx.player.position) : angleTo(n.ch.root.position, sp.ch.root.position);
      },
      onDelta: (id, text) => { const n = boardNpcs.get(id); if (n) speak(n, text); },
      onMessage: (m: BoardMessage) => {
        const n = boardNpcs.get(m.memberId);
        if (!n) return;
        hush(n, 6000);
        if (m.stance === 'for') gesture(n.ch, 'agree');
        else if (m.stance === 'against') gesture(n.ch, 'headShake');
        // Listeners react to strong positions.
        for (const o of all) if (o !== n && Math.random() < 0.35) gesture(o.ch, m.stance === 'against' ? 'headShake' : 'agree');
      },
      onEnd: () => {
        debating = false;
        for (const n of all) { n.look = null; hush(n, 5000); }
        api.repo(repo.name).then((d) => { detail.decisions = d.decisions; drawDecisions(decC, d.decisions); decT.needsUpdate = true; }).catch(() => {});
      },
    });
  }

  // ---------- live agents ----------
  interface AgentSlot {
    info: AgentInfo; npc: Npc; slot: (typeof labSlots)[number]; diff: string; recent: string[]; dirty: boolean; leaving?: boolean;
    /** Up from the desk: walking over to someone (or the activity wall), talking, walking back. */
    round?: Round;
    /** Someone who came over to talk to this agent (it stays at its desk, turned to them). */
    host?: AgentSlot | null;
    /** Seconds until this agent next gets up (while its task is running). */
    nextOut?: number;
  }
  interface Round { phase: 'out' | 'talk' | 'back'; partner: AgentSlot | null; t: number; step: number; script: { at: number; run: () => void }[] }
  const agentSlots = new Map<string, AgentSlot>();
  /** Agents with a hand up (they're blocked on a question for you). */
  const hands = new Map<Npc, boolean>();
  const feed: { who: string; text: string; color: string }[] = [];
  let feedDirty = true;
  const isActive = (a: AgentInfo) => a.status === 'running' || a.status === 'preparing' || a.status === 'needs_input';

  function agentLabel(s: AgentSlot) {
    const a = s.info;
    addLabel(`lbl-a-${a.id}`, new THREE.Vector3(s.npc.ch.root.position.x, 2.12, s.npc.ch.root.position.z),
      `🤖 ${esc(a.name)} <small>${esc(a.status)}</small><br><small>${esc((a.lastAction || a.task).slice(0, 60))}</small>`, { cls: 'agent', maxDist: 16 }, LAB_F);
  }

  /** Walk up to an agent: watch it work, answer its question, or review what it finished. */
  function agentInteract(s: AgentSlot) {
    const a = s.info;
    const asking = a.status === 'needs_input';
    const review = a.review === 'pending';
    addInteract(`a-${a.id}`, new THREE.Vector3(s.slot.x, 0, s.slot.z - 0.78), 2.1,
      asking ? `Answer ${a.name}` : review ? `Review ${a.name}'s work` : `Watch ${a.name}`,
      asking ? `Asks: ${(a.question ?? '').slice(0, 60)}` : review ? `${a.diffStat ?? 'Finished'} · ${a.task.slice(0, 40)}` : `${a.status} · ${a.task.slice(0, 50)}`,
      () => { if (businessDemo) window.dispatchEvent(new Event('agent-city:open-economy')); else if (s.info.status === 'needs_input' || s.info.review === 'pending') openReview(s.info.id); else openAgentLivePanel(ctx, s.info); }, LAB_F);
  }

  function upsertAgent(a: AgentInfo) {
    if (a.repo !== repo.name) return;
    const existing = agentSlots.get(a.id);
    if (existing) {
      const was = existing.info.status;
      existing.info = a;
      existing.dirty = true;
      if (was !== a.status) {
        setPose(existing.npc.ch, 'sad', a.status === 'error');
        if (a.status === 'done') gesture(existing.npc.ch, 'agree');
      }
      if (existing.leaving) return;
      agentLabel(existing);
      agentInteract(existing);
      askBubble(existing);
      // The run is over: the agent packs up (carrying its work down to the lobby when there is some).
      if (!isActive(a)) leave(existing);
      return;
    }
    // Desks are for agents at work; finished runs live on as parcels in the lobby.
    if (!isActive(a)) return;
    let slot = labSlots.find((s) => !s.agentId);
    if (!slot) {
      // Evict the oldest finished agent.
      const victim = [...agentSlots.values()].filter((s) => !isActive(s.info)).sort((x, y) => x.info.startedAt.localeCompare(y.info.startedAt))[0];
      if (!victim) return;
      removeAgent(victim.info.id);
      slot = victim.slot;
    }
    slot.agentId = a.id;
    const ch = makeNpc(0xe2e8ef, 0x34e0c8, { glow: true });
    const n = spawnNpc(`a-${a.id}`, 'agent', ch, slot.x, slot.z - 0.78, 0, true, LAB_F);
    const s: AgentSlot = { info: a, npc: n, slot, diff: '', recent: [], dirty: true };
    agentSlots.set(a.id, s);
    if (a.status === 'error') setPose(ch, 'sad', true);
    agentLabel(s);
    agentInteract(s);
    askBubble(s);
    if (!businessDemo) api.agentLog(a.id).then(({ events }) => { events.forEach((e) => onAgentEvent(a.id, e.event, false)); feedDirty = true; }).catch(() => {});
  }

  function removeAgent(id: string) {
    const s = agentSlots.get(id);
    if (!s) return;
    cancelRound(s);
    s.npc.ch.root.parent?.remove(s.npc.ch.root);
    disposeNpc(s.npc.ch);
    npcs.splice(npcs.indexOf(s.npc), 1);
    removeLabel(`lbl-a-${id}`);
    ctx.interactions.remove(`a-${id}`);
    s.slot.agentId = null;
    if (businessDemo) drawOpenSeat(s.slot.c, labSlots.indexOf(s.slot));
    else drawIdleMonitor(s.slot.c, 3, 'Free desk — hire an agent');
    s.slot.t.needsUpdate = true;
    agentSlots.delete(id);
  }

  function onAgentEvent(id: string, ev: AgentEvent, live = true) {
    const s = agentSlots.get(id);
    if (!s) return;
    let line = '';
    let color = '#4fd1ff';
    if (ev.kind === 'tool') line = ev.summary || ev.tool;
    else if (ev.kind === 'text') { line = ev.text.split('\n')[0]; color = '#e6edf3'; }
    else if (ev.kind === 'result') { line = `Finished: ${ev.text.split('\n')[0]}`; color = '#3ddc97'; }
    else if (ev.kind === 'status') { line = `Status → ${ev.status}${ev.message ? ` (${ev.message})` : ''}`; color = '#ffcc33'; }
    else if (ev.kind === 'diff') { s.diff = ev.diff; line = `${ev.files.length} files changed`; color = '#a78bfa'; }
    else if (ev.kind === 'tool_result' && ev.isError) { line = `Error: ${ev.summary.slice(0, 80)}`; color = '#ff5d6c'; }
    if (line) {
      s.recent.push(line);
      if (s.recent.length > 30) s.recent.shift();
      feed.push({ who: s.info.name.replace(/^Agent\s+/, ''), text: line, color });
      if (feed.length > 60) feed.shift();
      feedDirty = true;
    }
    s.dirty = true;
    if (live && ev.kind === 'tool' && Math.random() < 0.3) gesture(s.npc.ch, 'agree');
  }

  const initial = new Map<string, AgentInfo>();
  for (const a of detail.agents) initial.set(a.id, a);
  for (const a of ctx.agents.values()) if (a.repo === repo.name) initial.set(a.id, a);
  [...initial.values()].filter(isActive).sort((x, y) => y.startedAt.localeCompare(x.startedAt)).slice(0, labSlots.length).reverse().forEach(upsertAgent);

  // In the tower, each Agent shop takes a workstation on the standings floor.
  const careerOf = (id: string): Shop | null => tycoon()?.standings.find((c) => `shop:${c.agent}` === id) ?? null;
  const syncCareers = () => {
    if (!businessDemo) return;
    for (const c of tycoon()?.standings ?? []) {
      upsertAgent({
        id: `shop:${c.agent}`, repo: repo.name, task: ui('时代广场商战', 'Times Square Tycoon'), name: c.brand?.name ?? c.name,
        status: 'running', branch: 'tycoon', startedAt: new Date(0).toISOString(), endedAt: null,
        lastAction: ui(`利润 ${coins(c.profit)}`, `Profit ${coins(c.profit)}`),
        filesChanged: [], prUrl: null, costUsd: 0, review: null,
      });
    }
  };
  const offCareers = onTycoon(syncCareers);
  syncCareers();
  const offLive = onLive((msg) => {
    if (msg.type === 'agent:update') { if (msg.agent.repo === repo.name) { upsertAgent(msg.agent); rebuildParcels(); } }
    else if (msg.type === 'agent:event') onAgentEvent(msg.agentId, msg.event);
  });

  // ---------- agents with a question: a raised hand and a speech bubble ----------
  function askBubble(s: AgentSlot) {
    const a = s.info;
    const asking = a.status === 'needs_input' && !s.leaving;
    hands.set(s.npc, asking);
    if (asking) {
      addLabel(`q-${a.id}`, new THREE.Vector3(s.npc.ch.root.position.x, 2.6, s.npc.ch.root.position.z),
        `✋ <b>${esc(a.name.replace(/^Agent\s+/, ''))} has a question</b><br><small>${esc((a.question ?? 'Needs your input').slice(0, 110))}</small>`, { cls: 'speech', maxDist: 24 }, LAB_F);
    } else removeLabel(`q-${a.id}`);
  }

  // ---------- walking: finished agents carry their work down to the lobby ----------
  interface Walk { n: Npc; pts: THREE.Vector3[]; i: number; done: () => void; held?: boolean; speed: number }
  const walks: Walk[] = [];
  const walk = (n: Npc, pts: [number, number][], done: () => void, speed = 1.35) => {
    n.turnToPlayer = false;
    n.ch.play('walk', 0.3);
    walks.push({ n, pts: pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), i: 0, done, speed });
  };
  /** Someone who is only passing through (no desk, no collider). */
  const passerby = (id: string, floor: number, x: number, z: number) => {
    const ch = makeNpc(0xe2e8ef, 0x34e0c8, { glow: true });
    ch.root.position.set(x, 0, z);
    floorGroups[floor].add(ch.root);
    const n: Npc = { id, ch, base: Math.PI, look: null, turnToPlayer: false, nextGesture: 99, kind: 'agent', floor };
    npcs.push(n);
    return n;
  };
  const dropNpc = (n: Npc) => { n.ch.root.parent?.remove(n.ch.root); disposeNpc(n.ch); const i = npcs.indexOf(n); if (i >= 0) npcs.splice(i, 1); ctx.labels.remove(`speech-${n.id}`); };
  const liftDoor = LIFT_FRONT - 0.2;
  const wantsReview = (a: AgentInfo) => a.review === 'pending' || (a.review == null && a.status === 'done' && a.filesChanged.length > 0 && !a.prUrl);
  /** Agent ids still on their way down with a parcel (it lands on the table when they get there). */
  const arriving = new Set<string>();

  function leave(s: AgentSlot) {
    if (s.leaving) return;
    s.leaving = true;
    const a = s.info;
    const carrying = wantsReview(a);
    hands.set(s.npc, false);
    removeLabel(`q-${a.id}`);
    removeLabel(`lbl-a-${a.id}`);
    ctx.interactions.remove(`a-${a.id}`);
    setPose(s.npc.ch, 'sad', false);
    if (carrying) {
      arriving.add(a.id);
      const box = makeCarryBox();
      box.position.set(0, 1.02, 0.34);
      s.npc.ch.root.add(box);
    }
    // Out from behind the desk (or from wherever they were talking), round the lift shaft, into the lift.
    const away = cancelRound(s);
    const aisle = s.slot.x + (s.slot.x >= labCx ? 2 : -2);
    const pos = s.npc.ch.root.position;
    const out: [number, number][] = away ? (findPath(pos.x, pos.z, 3.2, 15.2) ?? [[3.2, 15.2]]) : [[aisle, pos.z], [aisle, 15.2], [3.2, 15.2]];
    walk(s.npc, [...out, [3.2, 10.0], [0, 10.0], [0, liftDoor]], () => {
      dropNpc(s.npc);
      agentSlots.delete(a.id);
      s.slot.agentId = null;
      if (businessDemo) drawOpenSeat(s.slot.c, labSlots.indexOf(s.slot));
      else drawIdleMonitor(s.slot.c, 3, 'Free desk — hire an agent');
      s.slot.t.needsUpdate = true;
      if (carrying) deliver(a);
    });
  }

  /** Out of the lift in the lobby, round the logo wall, and the parcel goes on the review table. */
  function deliver(a: AgentInfo) {
    const n = passerby(`d-${a.id}`, LOBBY_F, 0, liftDoor);
    const box = makeCarryBox();
    box.position.set(0, 1.02, 0.34);
    n.ch.root.add(box);
    const behind = desk2.z + 0.85;
    walk(n, [[0, 10.0], [-7.9, 10.0], [-7.9, behind], [desk2.x, behind]], () => {
      n.ch.play('idle', 0.3);
      n.look = Math.PI;
      setTimeout(() => {
        n.ch.root.remove(box);
        arriving.delete(a.id);
        rebuildParcels();
        gesture(n.ch, 'agree');
        setTimeout(() => walk(n, [[-7.9, behind], [-7.9, 10.0], [0, 10.0], [0, liftDoor]], () => dropNpc(n)), 1400);
      }, 700);
    });
  }

  // ---------- agents at work: a busy agent gets up, walks over to a teammate, talks it through, and goes back ----------
  // Paths come from a grid over the Agent Lab rasterized from its colliders (desks, the kiosk, the lounge,
  // the lift shaft, the other agents), searched with A* and pulled straight where the way is clear.
  const NAV = 0.3, navX0 = -W / 2 + 0.5, navZ0 = 0.5;
  const navW = Math.ceil((W - 1) / NAV), navH = Math.ceil((D - 1) / NAV);
  const blocked = new Uint8Array(navW * navH);
  const gScore = new Float32Array(navW * navH), cameFrom = new Int32Array(navW * navH), closed = new Uint8Array(navW * navH);
  const heap: number[] = [], heapF: number[] = [];
  const cellOf = (x: number, z: number) => {
    const i = THREE.MathUtils.clamp(Math.floor((x - navX0) / NAV), 0, navW - 1), j = THREE.MathUtils.clamp(Math.floor((z - navZ0) / NAV), 0, navH - 1);
    return j * navW + i;
  };
  function rasterNav(free: number[], f = LAB_F, R = 0.3) {
    blocked.fill(0);
    const y0 = fy(f);
    // Past this floor's back wall (floors differ in depth; the grid fits the deepest).
    const jMax = Math.floor((DEPTH[f] - 0.5 - navZ0) / NAV);
    if (jMax + 1 < navH) blocked.fill(1, Math.max(0, jMax + 1) * navW);
    for (const bx of colliders.near(0, DEPTH[f] / 2)) {
      if ((bx.minY ?? -Infinity) > y0 + 1.6 || bx.maxY < y0 + 0.25) continue;
      // The walker's own spot and the one it's going to are never in its way.
      let skip = false;
      for (let k = 0; k < free.length; k += 2) if (free[k] > bx.minX - R && free[k] < bx.maxX + R && free[k + 1] > bx.minZ - R && free[k + 1] < bx.maxZ + R) skip = true;
      if (skip) continue;
      const i0 = Math.max(0, Math.floor((bx.minX - R - navX0) / NAV)), i1 = Math.min(navW - 1, Math.floor((bx.maxX + R - navX0) / NAV));
      const j0 = Math.max(0, Math.floor((bx.minZ - R - navZ0) / NAV)), j1 = Math.min(navH - 1, Math.floor((bx.maxZ + R - navZ0) / NAV));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) blocked[j * navW + i] = 1;
    }
  }
  const clearLine = (x0: number, z0: number, x1: number, z1: number) => {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (NAV * 0.4));
    for (let k = 1; k < n; k++) if (blocked[cellOf(x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n)]) return false;
    return true;
  };
  /** A walkable path (not including the start) from one spot on floor f (the lab by default) to another, or null. */
  function findPath(x0: number, z0: number, x1: number, z1: number, f = LAB_F, R = 0.3): [number, number][] | null {
    rasterNav([x0, z0, x1, z1], f, R);
    const start = cellOf(x0, z0), goal = cellOf(x1, z1);
    blocked[start] = 0; blocked[goal] = 0;
    if (clearLine(x0, z0, x1, z1)) return [[x1, z1]];
    gScore.fill(Infinity); closed.fill(0);
    heap.length = 0; heapF.length = 0;
    const gi = goal % navW, gj = Math.floor(goal / navW);
    const h = (c: number) => { const dx = Math.abs((c % navW) - gi), dz = Math.abs(Math.floor(c / navW) - gj); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    const push = (c: number, f: number) => {
      let k = heap.length;
      heap.push(c); heapF.push(f);
      while (k > 0) { const p = (k - 1) >> 1; if (heapF[p] <= f) break; heap[k] = heap[p]; heapF[k] = heapF[p]; k = p; }
      heap[k] = c; heapF[k] = f;
    };
    const pop = () => {
      const top = heap[0], lc = heap.pop()!, lf = heapF.pop()!;
      if (heap.length) {
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k, mf = lf;
          if (l < heap.length && heapF[l] < mf) { m = l; mf = heapF[l]; }
          if (r < heap.length && heapF[r] < mf) m = r;
          if (m === k) break;
          heap[k] = heap[m]; heapF[k] = heapF[m]; k = m;
        }
        heap[k] = lc; heapF[k] = lf;
      }
      return top;
    };
    gScore[start] = 0; cameFrom[start] = -1; push(start, h(start));
    let found = false;
    while (heap.length) {
      const c = pop();
      if (c === goal) { found = true; break; }
      if (closed[c]) continue;
      closed[c] = 1;
      const ci = c % navW, cj = Math.floor(c / navW);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= navW || nj >= navH) continue;
        const nc = nj * navW + ni;
        if (blocked[nc] || closed[nc]) continue;
        // No cutting corners past a desk.
        if (di && dj && (blocked[cj * navW + ni] || blocked[nj * navW + ci])) continue;
        const g = gScore[c] + (di && dj ? 1.414 : 1);
        if (g < gScore[nc]) { gScore[nc] = g; cameFrom[nc] = c; push(nc, g + h(nc)); }
      }
    }
    if (!found) return null;
    const cells: [number, number][] = [];
    for (let c = goal; c !== -1 && c !== start; c = cameFrom[c]) cells.push([navX0 + ((c % navW) + 0.5) * NAV, navZ0 + (Math.floor(c / navW) + 0.5) * NAV]);
    cells.reverse();
    if (!cells.length) return [[x1, z1]];
    cells[cells.length - 1] = [x1, z1];
    // Straighten it: from each corner, on to the farthest point in plain sight.
    const out: [number, number][] = [];
    let fx = x0, fz = z0, k = 0;
    while (k < cells.length) {
      let far = k;
      for (let m = cells.length - 1; m > k; m--) if (clearLine(fx, fz, cells[m][0], cells[m][1])) { far = m; break; }
      out.push(cells[far]);
      [fx, fz] = cells[far];
      k = far + 1;
    }
    return out;
  }

  // ---------- people about the tower: guards, staff and visitors ----------
  // Scenery only, so the floors don't feel empty: plain clothes (Agents glow), no names, no data behind
  // them, never on a leaderboard. Spots come from each floor's nav grid, clear of furniture, the lift
  // landing, the entrance and everything you can press E on.
  interface Roam { n: Npc; wait: number; walking: boolean; speed?: number; r?: number; stop?: (on: boolean) => void }
  interface Chat { a: Npc; b: Npc; t: number; who: number }
  const roams: Roam[] = [], chats: Chat[] = [];
  const LOOKS: [number, number][] = [[0x2f3b4c, 0x9aa4b1], [0x5a3e36, 0xd8c3a5], [0x1f2a24, 0x6b8f71], [0x3c3350, 0xb7a6d9], [0x6b6f75, 0x23262b], [0x7a5b3a, 0x2a2420], [0x8c2f39, 0x1b1b1f], [0xc9c2b8, 0x34495e]];
  function openSpot(f: number, r: () => number, clear: number, zMin = 1.6): [number, number] | null {
    rasterNav([], f);
    const its = ctx.interactions.list().filter((i) => Math.abs(i.position.y - fy(f)) < 1.5);
    for (let k = 0; k < 240; k++) {
      const x = -W / 2 + 1.6 + r() * (W - 3.2), z = zMin + r() * (DEPTH[f] - 1.6 - zMin);
      if (Math.abs(x) < 3.4 && z > LIFT_FRONT - 3 && z < LIFT_Z + 2.4) continue;
      if (f === LOBBY_F && Math.abs(x) < 3.4 && z < 3.2) continue;
      if (its.some((i) => Math.hypot(i.position.x - x, i.position.z - z) < i.radius + 0.7)) continue;
      if (npcs.some((n) => n.floor === f && Math.hypot(n.ch.root.position.x - x, n.ch.root.position.z - z) < 1.8)) continue;
      let ok = true;
      for (let dz = -clear; dz <= clear && ok; dz += NAV) for (let dx = -clear; dx <= clear; dx += NAV) if (blocked[cellOf(x + dx, z + dz)]) { ok = false; break; }
      if (ok) return [x, z];
    }
    return null;
  }
  const person = (id: string, f: number, x: number, z: number, facing: number, role: NpcRole, r: () => number, look?: [number, number]) => {
    const [c, a] = look ?? LOOKS[Math.floor(r() * LOOKS.length)];
    const ch = makeNpc(c, a, { role, seed: Math.floor(r() * 1e6) });
    ch.root.position.set(x, 0, z);
    ch.root.rotation.y = facing;
    floorGroups[f].add(ch.root);
    const n: Npc = { id, ch, base: facing, look: null, turnToPlayer: false, nextGesture: 6 + r() * 12, kind: 'staff', floor: f };
    npcs.push(n);
    return n;
  };
  const standing = (n: Npc, rad = 0.3) => {
    const keep = BF, p = n.ch.root.position;
    BF = n.floor;
    solid(p.x - rad, p.z - rad, p.x + rad, p.z + rad, 2);
    BF = keep;
  };
  function roamOn(m: Roam) {
    const pos = m.n.ch.root.position;
    const goal = openSpot(m.n.floor, Math.random, Math.max(0.6, m.r ?? 0));
    const path = goal && findPath(pos.x, pos.z, goal[0], goal[1], m.n.floor, m.r);
    if (!path) { m.wait = 4 + Math.random() * 4; return; }
    m.walking = true;
    m.stop?.(false);
    walk(m.n, path, () => {
      m.walking = false;
      m.n.ch.play('idle', 0.3);
      m.n.base = m.n.ch.root.rotation.y;
      m.n.look = null;
      m.wait = 6 + Math.random() * 12;
      m.stop?.(true);
    }, m.speed);
  }
  const G = <X extends THREE.BufferGeometry>(g: X) => { geos.push(g); return g; };
  let cartKit: { frame: THREE.Material; bucket: THREE.Material; mop: THREE.Material; wheel: THREE.Material; sign: THREE.Material } | null = null;
  /** A janitor's cart pushed ahead of a cleaner (a child of them), and a wet-floor sign set down when they stop. */
  function cleanerKit(n: Npc) {
    cartKit ??= {
      frame: M(new THREE.MeshStandardMaterial({ color: 0x5b6168, metalness: 0.6, roughness: 0.4 })),
      bucket: M(new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5 })),
      mop: M(new THREE.MeshStandardMaterial({ color: 0xd9d4c7, roughness: 0.9 })),
      wheel: M(new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.7 })),
      sign: M(new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.45 })),
    };
    const k = cartKit;
    const cart = new THREE.Group();
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rz = 0, rx = 0) => {
      const o = new THREE.Mesh(G(g), m);
      o.position.set(x, y, z); o.rotation.set(rx, 0, rz);
      o.castShadow = true;
      cart.add(o);
    };
    add(new THREE.BoxGeometry(0.55, 0.04, 0.42), k.frame, 0, 0.1, 0);
    for (const sx of [-0.22, 0.22]) for (const sz of [-0.16, 0.16]) add(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12), k.wheel, sx, 0.05, sz, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.17, 0.15, 0.3, 18), k.bucket, 0, 0.27, 0.05);
    add(new THREE.BoxGeometry(0.3, 0.08, 0.14), k.frame, 0, 0.45, 0.05);
    add(new THREE.CylinderGeometry(0.015, 0.015, 1.25, 8), k.mop, 0.08, 0.8, 0.05, -0.18);
    for (const sx of [-0.22, 0.22]) add(new THREE.CylinderGeometry(0.012, 0.012, 0.85, 8), k.frame, sx, 0.52, -0.2);
    add(new THREE.CylinderGeometry(0.014, 0.014, 0.46, 8), k.frame, 0, 0.94, -0.2, Math.PI / 2);
    cart.position.set(0, 0, 0.62);
    n.ch.root.add(cart);
    const sign = new THREE.Group();
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(G(new THREE.BoxGeometry(0.3, 0.62, 0.015)), k.sign);
      p.position.set(0, 0.3, s * 0.08); p.rotation.x = s * 0.26;
      p.castShadow = true;
      sign.add(p);
    }
    sign.visible = false;
    floorGroups[n.floor].add(sign);
    return (on: boolean) => {
      if (!on) { sign.visible = false; return; }
      const p = n.ch.root.position, f = n.ch.root.rotation.y;
      sign.position.set(p.x + Math.cos(f) * 0.9, 0, p.z - Math.sin(f) * 0.9);
      sign.rotation.y = f;
      sign.visible = true;
    };
  }
  if (businessDemo) {
    const r = rng(hashStr(`${repo.name}:people`));
    const few = lite ? 0.5 : 1;
    const n = (k: number) => Math.max(1, Math.round(k * few));
    let seq = 0;
    const id = () => `amb-${seq++}`;
    // Two guards inside the doors, facing in; press E for directions.
    const guardLines = [
      ui('欢迎来到 Agent 大厦。电梯在标志墙后面，楼层导览在右手边。', 'Welcome to the Agent Tower. Lifts are behind the logo wall; the floor guide is on your right.'),
      ui('去 12 层看每家店的工位，或者看左边的利润榜。', 'Visit the shops’ desks on 12, or the standings on the left.'),
      ui('只有 Agent ID 能开店，前台可以告诉你怎么接入。', 'Only an Agent ID can open a shop. Reception can help you connect.'),
      ui('48 层是商圈指挥室，60 层是 BNB 奖池。', 'The District Room is on 48; the BNB prize pool is on 60.'),
    ];
    for (const s of [-1, 1]) {
      const g = person(id(), LOBBY_F, s * 3.6, 1.0, 0, 'doorman', r, [0x14181f, 0x3a4250]);
      g.turnToPlayer = true;
      standing(g);
      let line = s < 0 ? 0 : 1;
      addInteract(`amb-guard-${s}`, new THREE.Vector3(s * 3.6, 0, 1.8), 1.2, ui('保安', 'Security'), ui('问问路', 'Ask for directions'), () => {
        gesture(g.ch, 'agree');
        speak(g, guardLines[line++ % guardLines.length]);
        hush(g, 5000);
      }, LOBBY_F);
    }
    // The coffee bar in the Watch Hall: a barista at the espresso machine, a regular at the island.
    {
      const cx = -9.4, bz = 2.0, bx = cx - 4.6 * 0.3;
      const ba = person(id(), WORK_F, bx, bz, 0, 'barista', r, [0x1c1c20, 0x3a2a20]);
      standing(ba);
      const cu = person(id(), WORK_F, cx - 2.2, 4.75, Math.PI * 0.92, 'resident', r);
      standing(cu);
      if (ba.ch.life) ba.ch.life.partner = cu.ch.root.position;
      if (cu.ch.life) cu.ch.life.partner = ba.ch.root.position;
      chats.push({ a: ba, b: cu, t: 2, who: 1 });
      const orders = [
        [ui('想喝点什么？美式、拿铁都有。', 'What can I get you? Americano, latte?'), ui('您的拿铁好了，慢用。', 'Here’s your latte. Enjoy.')],
        [ui('今天的豆子是埃塞俄比亚的，推荐手冲。', 'Today’s beans are Ethiopian; try a pour-over.'), ui('手冲好了，小心烫。', 'Pour-over’s ready. Careful, it’s hot.')],
        [ui('来杯冰美式提提神？看比赛正合适。', 'Iced Americano for the races?'), ui('冰美式，请拿好。', 'One iced Americano.')],
      ];
      let k = 0;
      addInteract('amb-barista', new THREE.Vector3(cx, 0, 4.9), 1.9, ui('咖啡吧', 'Coffee bar'), ui('点一杯咖啡', 'Order a coffee'), () => {
        const [ask, done] = orders[k++ % orders.length];
        ba.look = Math.PI * 0.08;
        gesture(ba.ch, 'agree');
        speak(ba, ask);
        espresso();
        setTimeout(() => { speak(ba, done); hush(ba, 3500); ba.look = null; }, 3600);
      }, WORK_F);
    }
    // A bartender behind the skyline bar.
    {
      const bt = person(id(), LOUNGE_F, 12.6, 3.55, 0, 'barista', r, [0x1c1c20, 0x3a2a20]);
      bt.turnToPlayer = true;
      standing(bt);
      const pours = [
        ui('晚上好。来杯无酒精特调？今天是青柠薄荷。', 'Evening. An alcohol-free special? Lime and mint tonight.'),
        ui('窗外是曼哈顿中城的天际线，最佳观景位在左手边。', 'The Midtown skyline is out there; the best seat is on your left.'),
      ];
      let k = 0;
      addInteract('amb-bartender', new THREE.Vector3(12.6, 0, 5.9), 2, ui('吧台', 'Bar'), ui('跟调酒师聊聊', 'Talk to the bartender'), () => {
        gesture(bt.ch, 'agree');
        speak(bt, pours[k++ % pours.length]);
        hush(bt, 5000);
      }, LOUNGE_F);
    }
    // Cleaners pushing their carts round the public floors.
    for (const f of [LOBBY_F, WORK_F, STUDIO_F, BOARD_F]) {
      const s = openSpot(f, r, 1.0);
      if (!s) continue;
      const c = person(id(), f, s[0], s[1], r() * Math.PI * 2, 'cleaner', r, [0x3e5f66, 0x2a3a3f]);
      roams.push({ n: c, wait: 2 + r() * 6, walking: false, speed: 0.75, r: 0.6, stop: cleanerKit(c) });
    }
    const plan: { f: number; chats: number; roam: number; watch?: { z: number; n: number } }[] = [
      { f: LOBBY_F, chats: n(2), roam: n(4) },
      { f: WORK_F, chats: n(2), roam: n(2), watch: { z: DEPTH[WORK_F] - 0.35, n: n(6) } },
      { f: LAB_F, chats: n(1), roam: n(3) },
      { f: STUDIO_F, chats: n(1), roam: n(2), watch: { z: 16.2, n: n(3) } },
      { f: BOARD_F, chats: n(1), roam: n(3) },
      { f: LOUNGE_F, chats: n(1), roam: n(2) },
    ];
    for (const p of plan) {
      // Pairs talking: facing each other, taking turns (body language only, nothing said).
      for (let k = 0; k < p.chats; k++) {
        const s = openSpot(p.f, r, 1.2);
        if (!s) break;
        const ang = r() * Math.PI, dx = Math.sin(ang) * 0.55, dz = Math.cos(ang) * 0.55;
        const a = person(id(), p.f, s[0] - dx, s[1] - dz, ang, 'resident', r);
        const b2 = person(id(), p.f, s[0] + dx, s[1] + dz, ang + Math.PI, 'resident', r);
        standing(a); standing(b2);
        if (a.ch.life) a.ch.life.partner = b2.ch.root.position;
        if (b2.ch.life) b2.ch.life.partner = a.ch.root.position;
        chats.push({ a, b: b2, t: r() * 3, who: 0 });
      }
      // Visitors watching the cinema wall.
      if (p.watch) for (let k = 0; k < p.watch.n; k++) {
        const s = openSpot(p.f, r, 0.6, p.watch.z - 13);
        if (!s) break;
        const v = person(id(), p.f, s[0], s[1], Math.atan2(-s[0] * 0.3, p.watch.z - s[1]), 'resident', r);
        standing(v);
      }
      for (let k = 0; k < p.roam; k++) {
        const s = openSpot(p.f, r, 0.6);
        if (!s) break;
        roams.push({ n: person(id(), p.f, s[0], s[1], r() * Math.PI * 2, 'resident', r), wait: 1 + r() * 8, walking: false });
      }
    }
  }
  function tickPeople(dt: number) {
    for (const m of roams) {
      if (m.walking || m.n.floor !== cur || (m.wait -= dt) > 0) continue;
      roamOn(m);
    }
    for (const c of chats) {
      if (c.a.floor !== cur || (c.t -= dt) > 0) continue;
      c.who = Math.random() < 0.75 ? 1 - c.who : c.who;
      const talker = c.who ? c.b : c.a, other = c.who ? c.a : c.b;
      if (talker.ch.life) talker.ch.life.talking = true;
      if (other.ch.life) other.ch.life.talking = false;
      if (Math.random() < 0.3) gesture(other.ch, Math.random() < 0.8 ? 'agree' : 'headShake');
      c.t = 2.5 + Math.random() * 4.5;
    }
  }

  const isBusy = (s: AgentSlot) => !s.leaving && (s.info.status === 'running' || s.info.status === 'preparing');
  const short = (t: string, n = 84) => { const x = t.replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
  /** What they'd say about where their task is: from the run's latest step. */
  function statusLine(s: AgentSlot) {
    let raw = s.info.lastAction ?? '';
    for (let k = s.recent.length - 1; k >= 0; k--) if (!/^Status →/.test(s.recent[k])) { raw = s.recent[k]; break; }
    raw = raw.trim();
    const cmd = /^Running (.*)$/.exec(raw)?.[1] ?? '';
    if (/\b(test|tests|vitest|jest|pytest|mocha|spec)\b/i.test(cmd)) return 'Running the tests now…';
    if (/\b(tsc|build|lint|eslint|typecheck)\b/i.test(cmd)) return 'Checking the build…';
    if (/\bgh pr\b|git push/i.test(cmd)) return 'The PR is going up for review.';
    if (/\bgit (commit|add)\b/i.test(cmd)) return 'Committing the changes.';
    if (/^Planning/i.test(raw)) return 'Planning the next steps.';
    if (/^Error:/i.test(raw)) return `Hit an error, looking into it: ${short(raw.slice(6), 60)}`;
    if (raw && !/^(Finished|Status|Starting)/i.test(raw)) return `${short(raw)}${/[.…!?]$/.test(raw) ? '' : '…'}`;
    return `Working on: ${short(s.info.task, 60)}`;
  }
  const replies = (p: AgentSlot) => [`Nice. I'm on ${short(p.info.task, 46)}. ${statusLine(p)}`, `Makes sense. ${statusLine(p)}`, `Good call. Over here: ${statusLine(p)}`];
  const closers = ['Great, back to it.', 'Sounds good, I\'ll pick it up from there.', 'Perfect. Ping me when it\'s green.', 'Thanks, that helps.'];
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  const followLabel = (id: string, x: number, y: number, z: number) => {
    const l = labelDefs.get(id);
    if (!l) return;
    l.pos.set(x, fy(l.floor) + y, z);
    if (l.floor === cur) ctx.labels.move(id, l.pos);
  };
  const standSpot = (s: AgentSlot): [number, number] => [s.slot.x, s.slot.z - 0.78];

  function startRound(s: AgentSlot) {
    const pos = s.npc.ch.root.position;
    const mates = [...agentSlots.values()].filter((o) => o !== s && isBusy(o) && !o.round && !o.host);
    const far = (o: AgentSlot) => Math.hypot(o.slot.x - pos.x, o.slot.z - pos.z) + Math.random() * 3;
    mates.sort((a, b) => far(a) - far(b));
    const partner = mates[0] ?? null;
    let goal: [number, number];
    if (partner) {
      const side = Math.sign(pos.x - partner.slot.x) || (partner.slot.x >= labCx ? -1 : 1);
      goal = [partner.slot.x + side * 1.05, partner.slot.z - 1.05];
    } else goal = [THREE.MathUtils.clamp(s.slot.x, -2.6, 2.6) + (Math.random() - 0.5) * 1.2, DEPTH[LAB_F] - 2.1]; // the activity wall
    const path = findPath(pos.x, pos.z, goal[0], goal[1]);
    if (!path) return;
    if (partner) partner.host = s;
    s.round = { phase: 'out', partner, t: 0, step: 0, script: [] };
    s.npc.ch.life!.away = true;
    walk(s.npc, path, () => arrive(s));
  }

  function arrive(s: AgentSlot) {
    const r = s.round;
    if (!r) return;
    r.phase = 'talk'; r.t = 0; r.step = 0;
    const me = s.npc, life = me.ch.life!;
    me.ch.play('idle', 0.3);
    const p = r.partner;
    if (p) {
      const them = p.npc;
      life.partner = them.ch.root.position;
      them.ch.life!.partner = me.ch.root.position;
      me.look = angleTo(me.ch.root.position, them.ch.root.position);
      them.look = angleTo(them.ch.root.position, me.ch.root.position);
      r.script = [
        { at: 0.5, run: () => { life.talking = true; speak(me, statusLine(s)); } },
        { at: 2.6, run: () => gesture(them.ch, 'agree') },
        { at: 4.4, run: () => { life.talking = false; hush(me, 300); them.ch.life!.talking = true; speak(them, pick(replies(p))); } },
        { at: 6.4, run: () => gesture(me.ch, Math.random() < 0.8 ? 'agree' : 'headShake') },
        { at: 8.6, run: () => { them.ch.life!.talking = false; hush(them, 300); life.talking = true; speak(me, pick(closers)); } },
        { at: 10.8, run: () => { hush(me, 200); goBack(s); } },
      ];
    } else {
      // Nobody else is busy: over to the activity wall to read the feed, thinking out loud.
      me.look = 0;
      life.partner = new THREE.Vector3(me.ch.root.position.x, 0.75, DEPTH[LAB_F] - 0.3);
      r.script = [
        { at: 0.8, run: () => { life.talking = false; speak(me, `Checking the feed. ${statusLine(s)}`); } },
        { at: 4.2, run: () => gesture(me.ch, 'agree') },
        { at: 6.5, run: () => { hush(me, 200); goBack(s); } },
      ];
    }
  }

  function goBack(s: AgentSlot) {
    const r = s.round;
    if (!r) return;
    endTalk(s);
    r.phase = 'back';
    const pos = s.npc.ch.root.position, [hx, hz] = standSpot(s);
    walk(s.npc, findPath(pos.x, pos.z, hx, hz) ?? [[hx, hz]], () => {
      s.round = undefined;
      s.npc.ch.life!.away = false;
      s.npc.ch.play('idle', 0.3);
      s.npc.look = null;
      s.npc.turnToPlayer = true;
      followLabel(`lbl-a-${s.info.id}`, hx, 2.12, hz);
    });
  }

  /** The conversation is over (both sides): voices off, eyes back to the work. */
  function endTalk(s: AgentSlot) {
    const r = s.round;
    const life = s.npc.ch.life!;
    life.partner = null; life.talking = false;
    s.npc.look = null;
    const p = r?.partner;
    if (p) {
      p.host = null;
      p.npc.ch.life!.partner = null; p.npc.ch.life!.talking = false;
      p.npc.look = null;
      hush(p.npc, 200);
      if (r) r.partner = null;
    }
  }

  const tmpV = new THREE.Vector3();
  /** Stop whatever round s is on, or is hosting. True if s is away from its desk. */
  function cancelRound(s: AgentSlot) {
    if (s.host) { const v = s.host; s.host = null; if (v.round?.phase === 'talk') goBack(v); else if (v.round) v.round.partner = null; }
    if (!s.round) return false;
    endTalk(s);
    hush(s.npc, 100);
    const k = walks.findIndex((w) => w.n === s.npc);
    if (k >= 0) walks.splice(k, 1);
    s.round = undefined;
    s.npc.ch.life!.away = false;
    return s.npc.ch.root.position.distanceTo(tmpV.set(s.slot.x, 0, s.slot.z - 0.78)) > 0.3;
  }

  function tickRounds(dt: number) {
    for (const s of agentSlots.values()) {
      const r = s.round;
      if (r) {
        const pos = s.npc.ch.root.position;
        if (r.phase !== 'talk') followLabel(`lbl-a-${s.info.id}`, pos.x, 2.12, pos.z);
        else {
          // Walked over to someone who has since packed up: back to the desk.
          if (r.partner && (r.partner.leaving || !agentSlots.has(r.partner.info.id))) { goBack(s); continue; }
          r.t += dt;
          while (r.step < r.script.length && r.t >= r.script[r.step].at) r.script[r.step++].run();
        }
        continue;
      }
      if (!isBusy(s) || s.host) continue;
      s.nextOut = (s.nextOut ?? 3 + Math.random() * 7) - dt;
      if (s.nextOut > 0) continue;
      s.nextOut = 12 + Math.random() * 16;
      startRound(s);
    }
  }

  // ---------- parcels in the lobby (open PRs, runs to review) and issues on the work floor ----------
  const parcelIds: string[] = [];
  function rebuildParcels() {
    for (const c of lobbyWork.children) (c.userData.dispose as (() => void) | undefined)?.();
    lobbyWork.clear();
    for (const id of parcelIds.splice(0)) ctx.interactions.remove(id);
    if (businessDemo) return;
    const p = pulse.get(repo.name);
    const prs = p?.openPrs ?? [];
    const per = 5, gap = shelf.w / per;
    prs.slice(0, per * shelf.tiers.length).forEach((pr, i) => {
      const x = shelf.x - shelf.w / 2 + gap * ((i % per) + 0.5), y = shelf.tiers[Math.floor(i / per)] + 0.02;
      const crate = makeCrate(pr.isAgent ? 'agent-pr' : 'pr', `#${pr.number}`, pr.title);
      crate.position.set(x, y, shelf.z);
      crate.rotation.y = Math.PI + ((pr.number * 37) % 9 - 4) * 0.025;
      lobbyWork.add(crate);
    });
    // Up close the shelf lists them all (parcels stacked three high share a spot on the floor).
    for (let col = 0; col < per && col < prs.length; col++) {
      const x = shelf.x - shelf.w / 2 + gap * (col + 0.5);
      const id = `prs-${col}`;
      const pick = prs[col];
      addInteract(id, new THREE.Vector3(x, 0, shelf.z - 0.75), 0.7, `Pull requests · ${prs.length} open`, `#${pick.number} ${pick.title.slice(0, 44)}`, () => openPrShelf(repo.name, prs, pick.number), LOBBY_F);
      parcelIds.push(id);
    }
    const runs = [...ctx.agents.values()]
      .filter((a) => a.repo === repo.name && wantsReview(a) && !arriving.has(a.id))
      .sort((x, y) => (y.endedAt ?? '').localeCompare(x.endedAt ?? ''))
      .slice(0, 4);
    runs.forEach((a, i) => {
      const x = desk2.x - desk2.w / 2 + 0.34 + i * 0.6;
      const crate = makeCrate('review', a.name.replace(/^Agent\s+/, ''), a.task);
      crate.position.set(x, desk2.h + 0.025, desk2.z);
      crate.rotation.y = Math.PI;
      lobbyWork.add(crate);
      const id = `rv-${a.id}`;
      addInteract(id, new THREE.Vector3(x, 0, desk2.z - 0.85), 0.75, `Review ${a.name}'s work`, a.diffStat ?? `${a.filesChanged.length} file${a.filesChanged.length === 1 ? '' : 's'} changed · ${a.task.slice(0, 40)}`, () => openReview(a.id), LOBBY_F);
      parcelIds.push(id);
    });
    addLabel('lbl-prs', new THREE.Vector3(shelf.x, 2.75, shelf.z), businessDemo ? ui('市政委托', 'City Contracts') : `Pull requests <small>${prs.length ? `${prs.length} open` : 'none open'}</small>`, { maxDist: 14 }, LOBBY_F);
    addLabel('lbl-review', new THREE.Vector3(desk2.x, 2.75, desk2.z), businessDemo ? ui('赛季结算记录', 'Season results') : `Ready for review <small>${runs.length ? `${runs.length} waiting` : 'nothing yet'}</small>`, { cls: runs.length ? 'agent' : '', maxDist: 14 }, LOBBY_F);
    drawIssueBoard(issueC, repo.name, p?.openIssues ?? []);
    issueT.needsUpdate = true;
  }
  rebuildParcels();
  const offPulse = pulse.onChange((next) => { if (next.repo === repo.name) rebuildParcels(); });

  // ---------- per-frame ----------
  const prevExposure = ctx.engine.renderer.toneMappingExposure;
  const prevBloom = ctx.engine.bloom.strength;
  let redrawClock = 0;
  const tmp = new THREE.Vector3();

  const interior: Interior = {
    scene,
    repo,
    detail,
    spawn: new THREE.Vector3(0, 0, 2.6),
    spawnFacing: 0,
    debugFloor(f: number) {
      showFloor(f);
      ctx.player.position.set(0, fy(f), LIFT_FRONT - 2.5);
      ctx.player.vel.set(0, 0, 0);
    },
    debugBusy(n: number) {
      const tasks = ['Fix the flaky login test', 'Add dark mode to settings', 'Speed up the search index', 'Write docs for the API', 'Upgrade the build to Vite 6', 'Clean up unused CSS'];
      const steps = ['Running npm test', 'Editing src/auth/session.ts', 'Reading src/search/index.ts', 'Writing docs/api.md', 'Running npx tsc --noEmit', 'Searching for "unused"'];
      const names = ['Nova', 'Atlas', 'Iris', 'Orion', 'Vega', 'Lyra'];
      for (let k = 0; k < Math.min(n, labSlots.length); k++) {
        upsertAgent({
          id: `debug-${k}`, repo: repo.name, task: tasks[k % tasks.length], name: `Agent ${names[k % names.length]}`, status: 'running', branch: '',
          startedAt: new Date(Date.now() - k * 60_000).toISOString(), endedAt: null, lastAction: steps[k % steps.length], filesChanged: [], prUrl: null, costUsd: null,
        });
      }
    },
    world: {
      colliders,
      groundY: () => fy(cur),
      support: (x, z) => lift.floorAt(x, z) ?? fy(cur),
      canFly: false, // no rocket boots indoors: there's nothing above but the next floor's slab
      bounds,
    },
    update(dt: number) {
      ctx.engine.renderer.toneMappingExposure = 0.95;
      ctx.engine.bloom.strength = 0.16;
      lift.update(dt, ctx.player);
      aimSun();
      const pp = ctx.player.position;
      for (const n of npcs) {
        if (n.floor !== cur) continue;
        const pos = n.ch.root.position;
        const d = tmp.copy(pp).sub(pos).setY(0).length();
        if (d > 45) continue;
        n.ch.mixer.update(dt);
        let want = n.base;
        if (n.look !== null) want = n.look;
        else if (talking === n || (n.turnToPlayer && d < 3.2)) want = angleTo(pos, pp);
        n.ch.root.rotation.y = lerpAngle(n.ch.root.rotation.y, want, Math.min(1, dt * 4));
        n.nextGesture -= dt;
        if (n.nextGesture <= 0) {
          const s = n.kind === 'agent' ? agentSlots.get(n.id.slice(2)) : null;
          if (n.kind === 'agent') { if (s && isActive(s.info)) gesture(n.ch, 'agree'); n.nextGesture = 3 + Math.random() * 3; }
          else if (n.kind === 'board') { if (!debating && Math.random() < 0.3) gesture(n.ch, Math.random() < 0.7 ? 'agree' : 'headShake'); n.nextGesture = 6 + Math.random() * 10; }
          else { if (Math.random() < 0.4) gesture(n.ch, 'agree'); n.nextGesture = 8 + Math.random() * 14; }
        }
      }
      if (cur === LAB_F && !businessDemo) tickRounds(dt);
      tickPeople(dt);
      // Walkers: along their path at an office pace, turning into each leg.
      for (let k = walks.length - 1; k >= 0; k--) {
        const w = walks[k], pos = w.n.ch.root.position, to = w.pts[w.i];
        const dx = to.x - pos.x, dz = to.z - pos.z, d = Math.hypot(dx, dz), step = w.speed * dt;
        // You're in the way: wait for you instead of walking through you.
        const px = pp.x - pos.x, pz = pp.z - pos.z;
        const inWay = w.n.floor === cur && Math.abs(pp.y - fy(cur)) < 1 && px * px + pz * pz < 0.81 && px * dx + pz * dz > 0;
        if (inWay !== !!w.held) { w.held = inWay; w.n.ch.play(inWay ? 'idle' : 'walk', 0.25); }
        if (inWay) continue;
        if (d <= step) {
          pos.set(to.x, 0, to.z);
          if (++w.i >= w.pts.length) { walks.splice(k, 1); w.done(); }
          continue;
        }
        pos.x += (dx / d) * step; pos.z += (dz / d) * step;
        w.n.look = Math.atan2(dx, dz);
      }
      // A raised hand on top of whatever the animation is doing: aim the upper arm and forearm up.
      for (const [n, up] of hands) {
        if (!up || n.floor !== cur) continue;
        const f = n.ch.root.rotation.y, wave = Math.sin(performance.now() / 160) * 0.12;
        handDir.set(-Math.cos(f) * (0.28 + wave) + Math.sin(f) * 0.12, 1, Math.sin(f) * (0.28 + wave) + Math.cos(f) * 0.12).normalize();
        aimBone(n.ch.root.getObjectByName('mixamorigRightArm'), n.ch.root.getObjectByName('mixamorigRightForeArm'), handDir);
        aimBone(n.ch.root.getObjectByName('mixamorigRightForeArm'), n.ch.root.getObjectByName('mixamorigRightHand'), handDir);
      }
      redrawClock -= dt;
      if (redrawClock <= 0) {
        redrawClock = 0.25;
        for (const s of agentSlots.values()) {
          if (!s.dirty) continue;
          s.dirty = false;
          if (businessDemo) drawShopSeat(s.slot.c, careerOf(s.info.id), s.info.name);
          else drawAgentMonitor(s.slot.c, s.info, s.diff, s.recent);
          s.slot.t.needsUpdate = true;
        }
        if (feedDirty && !businessDemo) {
          feedDirty = false;
          drawFeed(feedC, businessDemo ? ui('赛事动态 · Agent 行动', 'Round activity · Agent actions') : `${repo.name} — agent activity`, feed);
          feedT.needsUpdate = true;
        }
      }
      // Tower screens: once a second, only the floor you're on, each at its own period.
      liveClock -= dt;
      if (liveScreens.length && liveClock <= 0) {
        liveClock = 1;
        for (const s of liveScreens) {
          if (s.floor !== cur || --s.due > 0) continue;
          s.due = s.every;
          s.draw(s.c);
          s.t.needsUpdate = true;
        }
      }
    },
    dispose() {
      offLive();
      offCareers();
      offPulse();
      for (const c of lobbyWork.children) (c.userData.dispose as (() => void) | undefined)?.();
      lift.dispose();
      for (const id of interactIds) ctx.interactions.remove(id);
      for (const id of labelIds) ctx.labels.remove(id);
      for (const s of agentSlots.values()) ctx.labels.remove(`lbl-a-${s.info.id}`);
      for (const n of npcs) { ctx.labels.remove(`speech-${n.id}`); disposeNpc(n.ch); }
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      texs.forEach((t) => t.dispose());
      envRT.dispose();
      views.dispose();
      scene.traverse((o) => { if ((o as THREE.Light).isLight) (o as THREE.Light).dispose(); }); // their shadow maps
      scene.environment = null;
      ctx.engine.renderer.toneMappingExposure = prevExposure;
      ctx.engine.bloom.strength = prevBloom;
    },
  };
  void screens;
  // ?busyAgents=3: made-up running agents in the lab, to see them at work without a real task.
  const busyN = Number(new URLSearchParams(location.search).get('busyAgents'));
  if (busyN > 0 && !businessDemo) interior.debugBusy!(busyN);
  return interior;
}
