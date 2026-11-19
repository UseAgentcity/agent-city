// Fireworks over the bowtie for a season's close: rockets climb from the plazas and burst into gold and the
// champion's colours. One shared particle buffer, so a whole show is a single draw call.
import * as THREE from 'three';

const N = 1600; // particles in the pool
const BURST = 140; // sparks per shell

export function installFireworks(scene: THREE.Object3D) {
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3), life = new Float32Array(N), max = new Float32Array(N);
  const base = new Float32Array(N * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 3.2, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, sizeAttenuation: true });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 4;
  scene.add(points);
  let next = 0, timer = 0;
  interface Rocket { x: number; y: number; z: number; vy: number; top: number; color: THREE.Color }
  const rockets: Rocket[] = [];
  const spark = (x: number, y: number, z: number, vx: number, vy: number, vz: number, c: THREE.Color, t: number) => {
    const i = next++ % N;
    pos.set([x, y, z], i * 3); vel.set([vx, vy, vz], i * 3);
    base.set([c.r, c.g, c.b], i * 3); col.set([c.r, c.g, c.b], i * 3);
    life[i] = t; max[i] = t;
  };

  return {
    /**
     * Per frame. `show`: whether a show is on; `at`: where to centre it (the plaza); `colors`: the shells' colours.
     */
    update(dt: number, show: boolean, at: { x: number; y: number; z: number }, colors: string[]) {
      if (show) {
        timer -= dt;
        if (timer <= 0) {
          timer = 0.6 + Math.random() * 1.1;
          const c = new THREE.Color(colors[Math.floor(Math.random() * colors.length)] ?? '#f0b90b');
          rockets.push({ x: at.x + (Math.random() - 0.5) * 120, y: at.y + 2, z: at.z + (Math.random() - 0.5) * 120, vy: 70 + Math.random() * 25, top: at.y + 110 + Math.random() * 70, color: c });
        }
      }
      for (let r = rockets.length - 1; r >= 0; r--) {
        const k = rockets[r];
        k.y += k.vy * dt;
        // A faint trail on the way up.
        spark(k.x, k.y, k.z, (Math.random() - 0.5) * 2, -6, (Math.random() - 0.5) * 2, new THREE.Color(1, 0.8, 0.5).multiplyScalar(0.5), 0.5);
        if (k.y < k.top) continue;
        // Burst: a sphere of sparks, some in gold for every shell.
        const gold = new THREE.Color('#f0b90b');
        for (let s = 0; s < BURST; s++) {
          const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r2 = Math.sqrt(1 - u * u);
          const speed = 24 + Math.random() * 10;
          spark(k.x, k.y, k.z, r2 * Math.cos(a) * speed, u * speed + 4, r2 * Math.sin(a) * speed, s % 4 === 0 ? gold : k.color, 1.8 + Math.random() * 0.8);
        }
        rockets.splice(r, 1);
      }
      let any = false;
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) { col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0; continue; }
        any = true;
        life[i] -= dt;
        const j = i * 3;
        vel[j] *= 1 - 1.2 * dt; vel[j + 2] *= 1 - 1.2 * dt; // air drag
        vel[j + 1] = vel[j + 1] * (1 - 1.2 * dt) - 9.8 * dt;
        pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
        const f = Math.max(0, life[i] / max[i]);
        const flick = 0.75 + 0.25 * Math.sin(life[i] * 40 + i);
        col[j] = base[j] * f * flick; col[j + 1] = base[j + 1] * f * flick; col[j + 2] = base[j + 2] * f * flick;
      }
      points.visible = any || rockets.length > 0;
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  };
}
