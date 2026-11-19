// Couriers at work: for every shop that took delivery orders yesterday, a scooter with a delivery box in the
// courier Agent's colour rides along the sidewalk to the door, waits for the order, and rides off the other way.
// Busier shops get more pickups. It stays on the sidewalk line in front of the shop, so it never cuts through a
// building. A small shared pool of scooters, reused.
import * as THREE from 'three';
import { shopOf, tycoon, type Lot } from './tycoon.ts';
import type { LotFront } from './tycoonWorld.ts';

const POOL = 8;
const RUN = 16; // metres along the sidewalk on each side of the door

interface Trip { on: boolean; root: THREE.Group; box: THREE.MeshStandardMaterial; t: number; from: THREE.Vector3; door: THREE.Vector3; to: THREE.Vector3; yawIn: number; yawOut: number }

function buildScooter(): { root: THREE.Group; box: THREE.MeshStandardMaterial } {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1f25, roughness: 0.7 });
  const shell = new THREE.MeshStandardMaterial({ color: 0xeef0f4, roughness: 0.4, metalness: 0.1 });
  const box = new THREE.MeshStandardMaterial({ color: 0x22c3ee, roughness: 0.5 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
    const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.rotation.x = rx; mesh.castShadow = true; g.add(mesh); return mesh;
  };
  for (const z of [-0.45, 0.45]) add(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 16).rotateZ(Math.PI / 2), dark, 0, 0.2, z);
  add(new THREE.BoxGeometry(0.3, 0.12, 1.0), shell, 0, 0.32, 0); // deck
  add(new THREE.BoxGeometry(0.06, 0.8, 0.06), dark, 0, 0.75, 0.42, -0.2); // stem
  add(new THREE.BoxGeometry(0.5, 0.05, 0.05), dark, 0, 1.12, 0.5); // handlebar
  add(new THREE.BoxGeometry(0.42, 0.38, 0.42), box, 0, 0.6, -0.38); // delivery box
  // The rider: a simple robot courier.
  add(new THREE.CylinderGeometry(0.15, 0.19, 0.55, 12), box, 0, 0.92, -0.02);
  add(new THREE.BoxGeometry(0.3, 0.26, 0.28), shell, 0, 1.36, 0.02);
  add(new THREE.BoxGeometry(0.24, 0.08, 0.02), new THREE.MeshBasicMaterial({ color: 0x0b0d12 }), 0, 1.37, 0.17);
  g.visible = false;
  return { root: g, box };
}

/** A small box truck for supplier deliveries: cab, cargo box in the supplier's colour, four wheels. */
function buildVan(): { root: THREE.Group; box: THREE.MeshStandardMaterial } {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1f25, roughness: 0.7 });
  const cab = new THREE.MeshStandardMaterial({ color: 0xeef0f4, roughness: 0.35, metalness: 0.2 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.1, metalness: 0.6 });
  const box = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.6 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh); return mesh;
  };
  add(new THREE.BoxGeometry(1.9, 2.0, 3.2), box, 0, 1.55, -0.7); // cargo box
  add(new THREE.BoxGeometry(1.85, 1.5, 1.5), cab, 0, 1.25, 1.65); // cab
  add(new THREE.BoxGeometry(1.7, 0.6, 0.05), glass, 0, 1.6, 2.41); // windscreen
  for (const [x, z] of [[-0.85, 1.6], [0.85, 1.6], [-0.85, -1.4], [0.85, -1.4]]) add(new THREE.CylinderGeometry(0.38, 0.38, 0.28, 16).rotateZ(Math.PI / 2), dark, x, 0.38, z);
  g.visible = false;
  return { root: g, box };
}

const ease = (k: number) => k * k * (3 - 2 * k);

export function installCouriers(group: THREE.Group, ground: (x: number, z: number) => number) {
  const trips: Trip[] = Array.from({ length: POOL }, () => {
    const { root, box } = buildScooter();
    group.add(root);
    return { on: false, root, box, t: 0, from: new THREE.Vector3(), door: new THREE.Vector3(), to: new THREE.Vector3(), yawIn: 0, yawOut: 0 };
  });
  interface Stop { lot: Lot; f: LotFront; every: number; timer: number; color: string }
  const stops = new Map<string, Stop>();
  // Supplier vans: fewer, slower, parking at the curb in front of the shops they stock.
  interface Van { on: boolean; root: THREE.Group; box: THREE.MeshStandardMaterial; t: number; from: THREE.Vector3; stop: THREE.Vector3; to: THREE.Vector3; yaw: number }
  const vans: Van[] = Array.from({ length: 3 }, () => {
    const { root, box } = buildVan();
    group.add(root);
    return { on: false, root, box, t: 0, from: new THREE.Vector3(), stop: new THREE.Vector3(), to: new THREE.Vector3(), yaw: 0 };
  });
  const vanStops = new Map<string, Stop>();
  function startVan(s: Stop) {
    const v = vans.find((x) => !x.on);
    if (!v) return;
    const { f } = s;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const at = (along: number) => new THREE.Vector3(f.x + f.tx * along + f.nx * 4.2, 0, f.z + f.tz * along + f.nz * 4.2);
    v.from.copy(at(-dir * 30)); v.stop.copy(at(0)); v.to.copy(at(dir * 30));
    v.yaw = Math.atan2(v.to.x - v.from.x, v.to.z - v.from.z);
    v.box.color.set(s.color);
    v.t = 0; v.on = true; v.root.visible = true;
  }

  function start(s: Stop) {
    const trip = trips.find((x) => !x.on);
    if (!trip) return;
    const { f } = s;
    const side = Math.random() < 0.5 ? 1 : -1;
    const out = 2.4; // the curb side of the sidewalk
    const p = (along: number, off: number) => new THREE.Vector3(f.x + f.tx * along + f.nx * off, 0, f.z + f.tz * along + f.nz * off);
    trip.from.copy(p(side * RUN, out));
    trip.door.copy(p(0, 1.6));
    trip.to.copy(p(-side * RUN, out));
    trip.yawIn = Math.atan2(trip.door.x - trip.from.x, trip.door.z - trip.from.z);
    trip.yawOut = Math.atan2(trip.to.x - trip.door.x, trip.to.z - trip.door.z);
    trip.box.color.set(s.color);
    trip.t = 0; trip.on = true; trip.root.visible = true;
  }

  return {
    /** Every snapshot: which shops get pickups, how often, in whose colours. */
    sync(lots: { lot: Lot; f: LotFront }[]) {
      const city = tycoon();
      const seen = new Set<string>();
      for (const { lot, f } of lots) {
        const today = shopOf(lot.owner)?.today;
        if (!today?.delivered || !today.courier) continue;
        seen.add(lot.id);
        const courier = city?.standings.find((s) => (s.brand?.name ?? s.name) === today.courier);
        const every = Math.max(6, 60 - today.delivered / 6); // seconds between pickups
        const s = stops.get(lot.id);
        if (s) { s.every = every; s.color = courier?.brand?.color ?? '#22c3ee'; s.f = f; }
        else stops.set(lot.id, { lot, f, every, timer: Math.random() * every, color: courier?.brand?.color ?? '#22c3ee' });
      }
      for (const id of stops.keys()) if (!seen.has(id)) stops.delete(id);
      const stocked = new Set<string>();
      for (const { lot, f } of lots) {
        const today = shopOf(lot.owner)?.today;
        if (!today?.supplier) continue;
        stocked.add(lot.id);
        const sup = city?.standings.find((s) => (s.brand?.name ?? s.name) === today.supplier);
        const color = sup?.brand?.color ?? '#8b5a2b';
        const s = vanStops.get(lot.id);
        if (s) { s.color = color; s.f = f; } else vanStops.set(lot.id, { lot, f, every: 75, timer: 5 + Math.random() * 60, color });
      }
      for (const id of vanStops.keys()) if (!stocked.has(id)) vanStops.delete(id);
    },
    update(dt: number, near: (x: number, z: number) => boolean) {
      for (const s of stops.values()) {
        s.timer -= dt;
        if (s.timer > 0) continue;
        s.timer = s.every * (0.8 + Math.random() * 0.4);
        if (near(s.f.x, s.f.z)) start(s); // only where someone could see it
      }
      for (const s of vanStops.values()) {
        s.timer -= dt;
        if (s.timer > 0) continue;
        s.timer = s.every * (0.8 + Math.random() * 0.4);
        if (near(s.f.x, s.f.z)) startVan(s);
      }
      for (const v of vans) {
        if (!v.on) continue;
        v.t += dt;
        // 4 s in, 5 s unloading at the curb, 4 s out.
        const p = new THREE.Vector3();
        if (v.t < 4) p.lerpVectors(v.from, v.stop, ease(v.t / 4));
        else if (v.t < 9) p.copy(v.stop);
        else if (v.t < 13) p.lerpVectors(v.stop, v.to, ease((v.t - 9) / 4));
        else { v.on = false; v.root.visible = false; continue; }
        v.root.position.set(p.x, ground(p.x, p.z), p.z);
        v.root.rotation.y = v.yaw;
      }
      for (const trip of trips) {
        if (!trip.on) continue;
        trip.t += dt;
        // 3 s in, 2 s at the door, 3 s out.
        const p = new THREE.Vector3();
        let yaw: number;
        if (trip.t < 3) { p.lerpVectors(trip.from, trip.door, ease(trip.t / 3)); yaw = trip.yawIn; }
        else if (trip.t < 5) {
          const turn = Math.atan2(Math.sin(trip.yawOut - trip.yawIn), Math.cos(trip.yawOut - trip.yawIn)); // the short way round
          p.copy(trip.door); yaw = trip.yawIn + turn * ease((trip.t - 3) / 2);
        }
        else if (trip.t < 8) { p.lerpVectors(trip.door, trip.to, ease((trip.t - 5) / 3)); yaw = trip.yawOut; }
        else { trip.on = false; trip.root.visible = false; continue; }
        trip.root.position.set(p.x, ground(p.x, p.z), p.z);
        trip.root.rotation.y = yaw;
      }
    },
  };
}
