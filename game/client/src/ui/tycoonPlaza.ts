// The Broadway pedestrian plazas, furnished: red bistro tables and chairs, planters, and people sitting with a
// coffee watching the screens. Placed at runtime on open plaza only: well clear of car lanes and building fronts,
// off the raised sidewalks, away from shop signs, queues and carts, and leaving the spawn point free.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Crowd } from '../earth/crowd.ts';
import type { EarthApi } from '../earth/index.ts';

/** Plaza areas to furnish (centre, radius in metres): the bowtie between 43rd and 47th. */
const AREAS = [
  { lat: 40.75845, lon: -73.9854, r: 55 },
  { lat: 40.7576, lon: -73.9859, r: 45 },
  { lat: 40.7589, lon: -73.98505, r: 30 },
];
const MAX_SETS = 28;

function chairGeometry() {
  const parts = [
    new THREE.BoxGeometry(0.42, 0.04, 0.42).translate(0, 0.46, 0), // seat
    new THREE.BoxGeometry(0.42, 0.42, 0.04).translate(0, 0.69, -0.2), // back
    ...[[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]].map(([x, z]) => new THREE.CylinderGeometry(0.015, 0.015, 0.46, 6).translate(x, 0.23, z)),
  ];
  return mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
}
function tableGeometry() {
  const parts = [
    new THREE.CylinderGeometry(0.34, 0.34, 0.03, 20).translate(0, 0.72, 0),
    new THREE.CylinderGeometry(0.03, 0.03, 0.72, 8).translate(0, 0.36, 0),
    new THREE.CylinderGeometry(0.22, 0.24, 0.03, 16).translate(0, 0.015, 0),
  ];
  return mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
}

export function installPlaza(group: THREE.Group, earth: EarthApi, ground: (x: number, z: number) => number, avoid: () => { x: number; z: number; r: number }[]) {
  const red = new THREE.MeshStandardMaterial({ color: 0xc8202c, roughness: 0.45, metalness: 0.4 });
  const chairs = new THREE.InstancedMesh(chairGeometry(), red, MAX_SETS * 4);
  const tables = new THREE.InstancedMesh(tableGeometry(), red, MAX_SETS);
  const planterBox = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.6, 1.4).translate(0, 0.3, 0), new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.8 }), MAX_SETS);
  const shrub = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.62, 1).translate(0, 0.95, 0), new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 0.9, flatShading: true }), MAX_SETS);
  // frustumCulled off: the instances are spread over the plaza, far from the geometry's own bounds at the origin.
  for (const m of [chairs, tables, planterBox, shrub]) { m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; group.add(m); }
  const sitters = new Crowd(40);
  group.add(sitters.group);
  for (const m of sitters.members) { m.visible = false; m.pose = 'sit'; m.speed = 0; m.fade = 0; }
  let placed = false, tries = 0, retry = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  const set = (mesh: THREE.InstancedMesh, x: number, y: number, z: number, yaw: number, s = 1) => {
    m4.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, yaw), one.clone().multiplyScalar(s));
    mesh.setMatrixAt(mesh.count++, m4);
  };

  /** True when (x, z) is open plaza: not a lane, not a building front, not a raised sidewalk. */
  const open = (x: number, z: number) => earth.laneDistance(x, z, 25) > 3.5 && !earth.buildingNear(x, z, 6);

  function place() {
    const spots: { x: number; z: number }[] = [];
    const keepOut = avoid();
    search: for (const a of AREAS) {
      const c = earth.frame.toLocal(a.lat, a.lon);
      for (let dx = -a.r; dx <= a.r; dx += 3) for (let dz = -a.r; dz <= a.r; dz += 3) {
        const x = c.x + dx, z = c.z + dz;
        if (Math.hypot(dx, dz) > a.r) continue;
        // The whole set (table, chairs, a little room) must be open plaza.
        if (![[0, 0], [1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]].every(([ox, oz]) => open(x + ox, z + oz))) continue;
        if (keepOut.some((k) => Math.hypot(k.x - x, k.z - z) < k.r)) continue;
        if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 6.5)) continue;
        spots.push({ x, z });
        if (spots.length >= MAX_SETS) break search; // across all areas: the meshes hold MAX_SETS sets
      }
    }
    if (!spots.length) return false;
    let sit = 0;
    spots.forEach((s, i) => {
      const y = ground(s.x, s.z);
      if (i % 4 === 3) { set(planterBox, s.x, y, s.z, 0); set(shrub, s.x, y, s.z, i); return; }
      const turn = (i * 1.7) % (Math.PI * 2);
      set(tables, s.x, y, s.z, turn);
      const n = i % 3 === 0 ? 2 : 3;
      for (let k = 0; k < n; k++) {
        const a = turn + (k / n) * Math.PI * 2 + 0.3;
        const cx = s.x + Math.sin(a) * 0.75, cz = s.z + Math.cos(a) * 0.75;
        const face = Math.atan2(s.x - cx, s.z - cz); // the chair faces the table
        set(chairs, cx, y, cz, face);
        // Someone sits at about half the chairs.
        if ((i + k) % 2 === 0 && sit < sitters.members.length) {
          const m = sitters.members[sit++];
          m.pos.set(cx, ground(cx, cz), cz); m.yaw = face; m.visible = true; m.fade = 1; m.scale = 0.95 + ((i * 7 + k) % 5) * 0.03;
        }
      }
    });
    for (const m of [chairs, tables, planterBox, shrub]) m.instanceMatrix.needsUpdate = true;
    return true;
  }

  return {
    update(dt: number) {
      if (!placed) {
        // Wait for the map tiles (lanes and buildings) around the plaza, then furnish it once.
        retry -= dt;
        if (retry > 0) return;
        retry = 2;
        if (++tries > 2) placed = place(); // a couple of polls so the nearby tiles are in
      }
      sitters.update(dt);
    },
  };
}
