// Today's city event, visible in the city: a downpour brings real rain, opening night (and Broadway letting out)
// sends searchlights sweeping the sky over the theatres, a tourist wave fills the sidewalks and a slow day empties
// them. Weather the player picked by hand in Settings is never overridden; event rain gives way to the live weather
// when the event ends.
import * as THREE from 'three';
import type { DayNight } from '../engine.ts';
import type { EarthApi } from '../earth/index.ts';
import { lotFrontOf } from './tycoonWorld.ts';
import { onTycoon, tycoon } from './tycoon.ts';

const CROWD: Record<string, number> = { tourists: 1.45, 'market-weekend': 1.15, premiere: 1.1, 'broadway-out': 1.1, slow: 0.6, rain: 0.75 };

export function installCityEvents(scene: THREE.Scene, earth: EarthApi, dayNight: DayNight, ground: (x: number, z: number) => number) {
  const group = new THREE.Group();
  group.name = 'city-events';
  scene.add(group);
  // Searchlights: tall additive cones from in front of the theatres, sweeping slowly.
  const beamGeo = new THREE.CylinderGeometry(0.35, 7, 260, 20, 1, true).translate(0, 130, 0);
  const beams: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; phase: number; x: number; z: number }[] = [];
  let beamsFor = '';
  let rainByEvent = false;
  let event: string | null = null;

  function placeBeams() {
    const city = tycoon();
    if (!city) return;
    const theatres = city.lots.filter((l) => l.cat === 'theatre' && !l.locked);
    const key = theatres.map((l) => l.id).join(',');
    if (key === beamsFor && beams.length) return;
    for (const b of beams) group.remove(b.mesh);
    beams.length = 0;
    for (const lot of theatres) {
      const f = lotFrontOf(earth, lot);
      if (!f) continue;
      // Two lights per theatre, on the sidewalk either side of the door.
      for (const side of [-1, 1]) {
        const x = f.x + f.nx * 2.5 + f.tx * side * 3, z = f.z + f.nz * 2.5 + f.tz * side * 3;
        const mat = new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
        const mesh = new THREE.Mesh(beamGeo, mat);
        mesh.position.set(x, ground(x, z), z);
        mesh.frustumCulled = false;
        mesh.renderOrder = 2;
        group.add(mesh);
        beams.push({ mesh, mat, phase: beams.length * 1.3, x, z });
      }
    }
    beamsFor = beams.length ? key : '';
  }

  function apply() {
    const city = tycoon();
    const id = city?.season.settling ? null : city?.event?.id ?? null;
    if (id === event) return;
    event = id;
    earth.setCrowdLevel(CROWD[id ?? ''] ?? 1);
    const w = dayNight.weather;
    if (id === 'rain' && (w.mode === 'live' || rainByEvent)) {
      dayNight.setWeather('rain', 0.85);
      rainByEvent = true;
    } else if (id !== 'rain' && rainByEvent) {
      // Only undo rain we made; if the player has since picked weather by hand, leave it.
      if (w.mode === 'manual' && w.kind === 'rain') w.live();
      rainByEvent = false;
    }
  }
  onTycoon(apply);
  apply();

  let t = 0;
  return {
    update(dt: number, visible: boolean) {
      group.visible = visible;
      if (!visible) return;
      t += dt;
      const show = event === 'premiere' || event === 'broadway-out';
      if (show) placeBeams();
      // Searchlights read at dusk and night; by day they are a faint haze.
      const night = THREE.MathUtils.clamp(dayNight.night, 0, 1);
      const target = show ? 0.05 + 0.22 * night : 0;
      for (const b of beams) {
        b.mat.opacity = THREE.MathUtils.damp(b.mat.opacity, target, 2, dt);
        b.mesh.visible = b.mat.opacity > 0.003;
        // Each light sweeps in its own slow figure, leaning 12-28 degrees off vertical.
        const lean = 0.2 + 0.14 * Math.sin(t * 0.31 + b.phase);
        const turn = t * 0.23 + b.phase * 2.1;
        b.mesh.rotation.set(lean * Math.cos(turn), 0, lean * Math.sin(turn));
      }
    },
  };
}
