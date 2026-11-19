// Project HQs in the streaming world: every repo moves into a real building near where you started
// (the biggest into the tallest real towers), keeping its real shape and height. Famous landmarks are
// left alone so the city stays recognizable; a project only adds its entrance, signage and logos.
import * as THREE from 'three';
import type { Repo } from '../../../shared/types.ts';
import { loadLogo, logoTexture } from '../city/buildings.ts';
import { towerMarkTexture, buildEntrance, entranceDepth } from '../city/entrance.ts';
import { hashStr } from '../city/layout.ts';
import type { Site } from '../place.ts';
import type { NEdge } from './net.ts';

/** A real building footprint in world coordinates (from a loaded chunk). */
export interface HostFp {
  key: number;
  chunk: string;
  ring: number[];
  area: number;
  cx: number; cz: number;
  base: number; top: number; h: number;
  glass: boolean;
  color: number;
  /** A named place inside (museum, church, attraction…): never taken over. */
  landmark?: boolean;
}

export interface EarthSite extends Site { fp: HostFp }

interface Door { door: THREE.Vector3; out: THREE.Vector3; approach: THREE.Vector3; wallLen: number }

class SegGrid<T> {
  private cells = new Map<string, T[]>();
  constructor(private s = 40) {}
  add(t: T, x0: number, z0: number, x1: number, z1: number) {
    for (let i = Math.floor(x0 / this.s); i <= Math.floor(x1 / this.s); i++) for (let j = Math.floor(z0 / this.s); j <= Math.floor(z1 / this.s); j++) {
      const k = `${i},${j}`; let l = this.cells.get(k); if (!l) this.cells.set(k, (l = [])); l.push(t);
    }
  }
  query(x: number, z: number, r: number) {
    const out = new Set<T>();
    for (let i = Math.floor((x - r) / this.s); i <= Math.floor((x + r) / this.s); i++) for (let j = Math.floor((z - r) / this.s); j <= Math.floor((z + r) / this.s); j++) this.cells.get(`${i},${j}`)?.forEach((t) => out.add(t));
    return out;
  }
}

function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2)) : 0;
  return Math.hypot(x - (ax + ex * t), z - (az + ez * t));
}

export function chooseEarthSites(
  repos: Repo[], fps: HostFp[], edges: NEdge[],
  solid: (x: number, z: number) => boolean, wet: (x: number, z: number) => boolean, ground: (x: number, z: number) => number,
  radius: number,
  /** When set, the Agent Tower must stand on the building at this point (the Burj Khalifa). */
  pin?: { x: number; z: number },
): { sites: EarthSite[]; leftovers: Repo[] } {
  const segs = new SegGrid<{ ax: number; az: number; bx: number; bz: number; w: number; drive: boolean }>();
  for (const e of edges) for (let i = 0; i + 3 < e.pts.length; i += 2) {
    const ax = e.pts[i], az = e.pts[i + 1], bx = e.pts[i + 2], bz = e.pts[i + 3];
    segs.add({ ax, az, bx, bz, w: e.width, drive: e.drive }, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
  }
  const nearestStreet = (x: number, z: number, r: number) => {
    let best = Infinity;
    for (const s of segs.query(x, z, r)) best = Math.min(best, segDist(x, z, s.ax, s.az, s.bx, s.bz) - s.w / 2 + (s.drive ? 0 : 2));
    return best;
  };
  const findDoor = (f: HostFp, minLen: number, preferLong = false, maxStreet = 28): Door | null => {
    const r = f.ring, n = r.length / 2;
    let best: Door | null = null, bestScore = Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < minLen) continue;
      const ox = -(bz - az) / len, oz = (bx - ax) / len;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const px = mx + ox * 2.4, pz = mz + oz * 2.4;
      if (solid(px, pz) || wet(px, pz) || solid(mx + ox * 0.6, mz + oz * 0.6)) continue;
      const d = nearestStreet(mx + ox * 3, mz + oz * 3, 30);
      if (d > maxStreet) continue;
      // A headquarters wants its longest sidewalk wall, not the short end closest to the curb.
      const score = preferLong ? (d < 14 ? 0 : 1000) - len + d * 0.2 : d - Math.min(len, 30) * 0.15;
      if (score < bestScore) {
        bestScore = score;
        const gy = ground(px, pz);
        best = { door: new THREE.Vector3(mx, gy, mz), out: new THREE.Vector3(ox, 0, oz), approach: new THREE.Vector3(px, gy, pz), wallLen: len };
      }
    }
    return best;
  };
  // Last resort for the pinned tower: the longest wall, even when the plaza has no curb nearby.
  const forceDoor = (f: HostFp): Door => {
    const r = f.ring, n = r.length / 2;
    let ax = r[0], az = r[1], bx = r[2] ?? r[0], bz = r[3] ?? r[1], best = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const len = Math.hypot(r[j * 2] - r[i * 2], r[j * 2 + 1] - r[i * 2 + 1]);
      if (len > best) { best = len; ax = r[i * 2]; az = r[i * 2 + 1]; bx = r[j * 2]; bz = r[j * 2 + 1]; }
    }
    const len = Math.max(best, 1);
    const ox = -(bz - az) / len, oz = (bx - ax) / len;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const gy = ground(mx + ox * 2.4, mz + oz * 2.4);
    return {
      door: new THREE.Vector3(mx, gy, mz), out: new THREE.Vector3(ox, 0, oz),
      approach: new THREE.Vector3(mx + ox * 2.4, gy, mz + oz * 2.4), wallLen: len,
    };
  };

  // Supertalls (300 m+) are the skyline everyone knows; they stay themselves too.
  const usable = fps.filter((f) => f.area >= 60 && !f.landmark && f.h < 300 && Math.hypot(f.cx, f.cz) < radius * 0.9);
  const dist0 = (f: HostFp, x = 0, z = 0) => Math.hypot(f.cx - x, f.cz - z);
  const sorted = [...repos].sort((a, b) => b.score - a.score);
  const sites: EarthSite[] = [];
  const taken = new Set<HostFp>();
  const spaced = (d: Door) => sites.every((s) => s.door.distanceTo(d.door) > 14);
  const claim = (repo: Repo, pool: HostFp[], minLen = repo.tier === 'small' ? 3.5 : 6, preferLong = false) => {
    for (const f of pool) {
      if (taken.has(f)) continue;
      const door = findDoor(f, minLen, preferLong);
      if (!door || !spaced(door)) continue;
      taken.add(f);
      sites.push(makeSite(repo, f, door));
      return true;
    }
    return false;
  };
  const tallPool = usable.filter((f) => dist0(f) < radius * 0.7).sort((a, b) => (b.h - dist0(b) * 0.3) - (a.h - dist0(a) * 0.3));
  const big = sorted.filter((r) => r.tier === 'landmark' || r.tier === 'tower');
  const rest = sorted.filter((r) => r.tier === 'midrise' || r.tier === 'small');
  const leftovers: Repo[] = [];
  for (const repo of big) {
    // Headquarters: a real street wall with room for a two-storey lobby, not the tallest glass needle.
    if (repo.fullName === 'agent-city/agent-tower') {
      if (pin) {
        // The nearest footprint is often a plaza shop. The headquarters takes the tallest tower at the pin.
        const around = fps
          .filter((f) => f.area >= 80 && Math.hypot(f.cx - pin.x, f.cz - pin.z) < 140)
          .sort((a, b) => b.h - a.h || Math.hypot(a.cx - pin.x, a.cz - pin.z) - Math.hypot(b.cx - pin.x, b.cz - pin.z));
        const claimHere = () => {
          for (const f of around) {
            if (taken.has(f)) continue;
            const door = findDoor(f, 4, true, 90) ?? findDoor(f, 4, true, 400) ?? forceDoor(f);
            door.door.y += 0.22;
            door.approach.y += 0.22;
            taken.add(f);
            sites.push(makeSite(repo, f, door));
            return true;
          }
          return false;
        };
        if (claimHere()) continue;
      }
      // The old pick was the tallest glass needle, a few meters wide, so the lobby sat in a slot.
      // A headquarters needs a real street wall: long frontage, a full block of floor area, still near the square.
      const presence = (f: HostFp, minWall: number) => {
        const door = findDoor(f, minWall, true);
        if (!door) return null;
        return door.wallLen * 3 + Math.min(f.h, 200) * 0.35 + Math.min(f.area, 4000) * 0.01 + (f.glass ? 18 : 0) - dist0(f) * 0.08;
      };
      const grand = (minWall: number, minH: number, minArea: number, reach: number) => usable
        .filter((f) => f.h >= minH && f.area >= minArea && dist0(f) < reach && presence(f, minWall) !== null)
        .sort((a, b) => presence(b, minWall)! - presence(a, minWall)!);
      if (claim(repo, grand(20, 40, 800, radius * 0.75), 20, true)) continue;
      if (claim(repo, grand(16, 30, 400, radius * 0.9), 16, true)) continue;
    }
    const minH = repo.tier === 'landmark' ? 45 : 25;
    if (claim(repo, tallPool.filter((f) => f.h >= minH).slice(0, 80))) continue;
    // The tall ones nearby are spoken for: the nearest decent real building instead.
    if (!claim(repo, usable.filter((f) => f.h >= 15).sort((a, b) => dist0(a) - dist0(b)).slice(0, 400))) leftovers.push(repo);
  }
  const hub = sites[0]?.fp ?? null;
  const hx = hub?.cx ?? 0, hz = hub?.cz ?? 0;
  for (const repo of rest) {
    const [lo, hi] = repo.tier === 'midrise' ? [12, 70] : [3, 22];
    const pool = usable.filter((f) => f.h >= lo && f.h <= hi && (repo.tier === 'small' ? f.area < 1500 : f.area > 150)).sort((a, b) => dist0(a, hx, hz) - dist0(b, hx, hz));
    if (!claim(repo, pool.slice(0, 160))) leftovers.push(repo);
  }

  const rank = new Map(sorted.map((r, i) => [r.name, i]));
  sites.sort((a, b) => rank.get(a.repo.name)! - rank.get(b.repo.name)!);
  return { sites, leftovers };
}

function makeSite(repo: Repo, fp: HostFp, d: Door): EarthSite {
  // Stand just outside the glass lobby pavilion, not inside it.
  const approach = d.door.clone().addScaledVector(d.out, entranceDepth(repo.tier) + 1.4);
  approach.y = d.approach.y;
  return {
    repo, fp, door: d.door, doorOut: d.out, approach,
    top: new THREE.Vector3(fp.cx, fp.top, fp.cz),
    center: { x: fp.cx, z: fp.cz }, height: fp.h,
    footprint: fp.ring,
  };
}

// ---------------------------------------------------------------------------------------------

/** The HQ itself: the real building, untouched, with the project's logo high on its walls and a front door. */
export async function buildEarthRepo(site: EarthSite): Promise<THREE.Group> {
  const { repo, fp } = site;
  const towerDemo = repo.name === 'AGENT CITY TOWER';
  const group = new THREE.Group();
  group.name = `repo:${repo.name}`;
  const H = fp.top;
  const r = fp.ring, n = r.length / 2;

  const logoTextureForSite = towerDemo
    ? towerMarkTexture()
    : logoTexture(site, await loadLogo(repo.name, repo.hasLogo));
  logoTextureForSite.colorSpace = THREE.SRGBColorSpace;
  const logoMat = new THREE.MeshBasicMaterial({ map: logoTextureForSite, transparent: true, toneMapped: false });
  const plane = new THREE.PlaneGeometry(1, 1);
  const walls: { mx: number; mz: number; ox: number; oz: number; len: number }[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len >= 4) walls.push({ mx: (ax + bx) / 2, mz: (az + bz) / 2, ox: -(bz - az) / len, oz: (bx - ax) / len, len });
  }
  const out = site.doorOut;
  // The generic initials tile is intentionally skipped for the Agent City tower. Its true brand
  // mark belongs on the entrance fascia; the enormous square tile obscures the real facade.
  if (!towerDemo && fp.h > 22 && walls.length) {
    const score = (w: typeof walls[0]) => (w.ox * out.x + w.oz * out.z) * Math.min(w.len, 30);
    const front = [...walls].sort((a, b) => score(b) - score(a))[0];
    const back = [...walls].sort((a, b) => score(a) - score(b))[0];
    for (const w of front === back ? [front] : [front, back]) {
      const s = Math.min(w.len * 0.6, 22, fp.h * 0.3);
      if (s < 3.5) continue;
      const m = new THREE.Mesh(plane, logoMat);
      m.position.set(w.mx + w.ox * 0.35, H - s / 2 - 2.6, w.mz + w.oz * 0.35);
      m.rotation.y = Math.atan2(w.ox, w.oz);
      m.scale.setScalar(s);
      group.add(m);
    }
  }
  // The Agent City tower: its gold mark set into the crown on the street face and the face opposite, readable from
  // blocks away; mounted flush on the facade with no billboard behind it.
  if (towerDemo) {
    const up = new THREE.Vector3(0, 1, 0);
    for (const side of [out, out.clone().negate()]) {
      // The street face is rarely square to the door direction: aim at the flattest face nearby.
      for (let s = Math.min(28, fp.h * 0.16); s >= 8; s *= 0.88) {
        let geo: THREE.BufferGeometry | null = null, flat = Infinity;
        for (let a = -45; a <= 45; a += 5) for (const shift of [0, -0.25, 0.25, -0.5, 0.5]) {
          const g = facadeDecal(r, fp.cx, fp.cz, side.clone().applyAxisAngle(up, THREE.MathUtils.degToRad(a)), s, H - s / 2 - 4, shift * s);
          if (g && g.userData.relief < flat - 0.05) { geo?.dispose(); geo = g; flat = g.userData.relief; } else g?.dispose();
        }
        if (!geo) continue;
        const m = new THREE.Mesh(geo, logoMat);
        m.name = 'tower-crown';
        group.add(m);
        break;
      }
    }
  }

  // Entrance: a glass lobby pavilion with doors, canopy, letters and a logo (city/entrance.ts).
  const logoTex = logoMat.map!;
  group.add(buildEntrance({
    door: site.door, out, wallLen: wallLenAt(fp, site), maxH: fp.top - site.door.y, tier: repo.tier,
    name: repo.name, brand: repo.brandColor || '#6b7a8f', logo: logoTex, seed: hashStr(repo.name),
  }));
  return group;
}

/**
 * A square decal wrapped onto the real footprint, seen from outside along `dir`: every column is
 * projected onto the nearest wall so it follows faceted or curved facades instead of floating off them.
 * Returns null when the facade under it bends too much to read as one face.
 */
function facadeDecal(ring: number[], cx: number, cz: number, dir: THREE.Vector3, size: number, y: number, shift = 0, lift = 0.3) {
  const n = ring.length / 2, cols = 32;
  const rx = dir.z, rz = -dir.x; // viewer's right
  const pos: number[] = [], uv: number[] = [], depth: number[] = [];
  for (let i = 0; i <= cols; i++) {
    const u = i / cols, off = shift + (u - 0.5) * size;
    const ox = cx + rx * off + dir.x * 2000, oz = cz + rz * off + dir.z * 2000;
    let best = Infinity;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const ax = ring[k * 2], az = ring[k * 2 + 1], ex = ring[j * 2] - ax, ez = ring[j * 2 + 1] - az;
      // Ray o - dir·t against segment a + e·s.
      const den = -dir.x * ez + dir.z * ex;
      if (Math.abs(den) < 1e-9) continue;
      const qx = ax - ox, qz = az - oz;
      const t = (qx * ez - qz * ex) / den;
      const sg = (qx * -dir.z + qz * dir.x) / den;
      if (t > 0 && sg >= 0 && sg <= 1 && t < best) best = t;
    }
    if (!Number.isFinite(best)) return null;
    depth.push(best);
    const px = ox - dir.x * (best - lift), pz = oz - dir.z * (best - lift);
    pos.push(px, y - size / 2, pz, px, y + size / 2, pz);
    uv.push(u, 0, u, 1);
  }
  const relief = Math.max(...depth) - Math.min(...depth);
  if (relief > size * 0.12) return null;
  const idx: number[] = [];
  for (let i = 0; i < cols; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.relief = relief;
  return g;
}

function wallLenAt(fp: HostFp, site: Site) {
  const r = fp.ring, n = r.length / 2;
  let best = 6, bd = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const d = segDist(site.door.x, site.door.z, r[i * 2], r[i * 2 + 1], r[j * 2], r[j * 2 + 1]);
    if (d < bd) { bd = d; best = Math.hypot(r[j * 2] - r[i * 2], r[j * 2 + 1] - r[i * 2 + 1]); }
  }
  return best;
}
