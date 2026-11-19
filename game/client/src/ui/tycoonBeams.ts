// The view from the air: take a plane, a jetpack or the wingsuit up over Midtown and every open shop sends up
// a beam of light in its colour, as tall as yesterday's trade, with its name and numbers at the top. On the
// street the beams fade away, so they never clutter the walk. Read from the same snapshot as the signs.
import * as THREE from 'three';
import { rawCanvases, t } from '../i18n.ts';
import { shopOf, type Lot } from './tycoon.ts';
import type { LotFront } from './tycoonWorld.ts';

const FONT = 'Inter, "PingFang SC", "Microsoft YaHei", Arial, sans-serif';
/** Camera height above the street where beams start to show, and where they are fully lit. */
const FADE_FROM = 22, FADE_TO = 60;

interface Beam { lot: Lot; f: LotFront; base: number; shaft: THREE.Mesh; core: THREE.Mesh; tag: THREE.Sprite; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; key: string; height: number; want: number }

function drawTag(c: HTMLCanvasElement, lot: Lot, rank: number) {
  rawCanvases.add(c);
  const g = c.getContext('2d')!;
  const shop = shopOf(lot.owner)!;
  const color = shop.brand?.color ?? '#f0b90b';
  const W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(10,12,18,.86)';
  g.beginPath(); g.roundRect(4, 4, W - 8, H - 8, 26); g.fill();
  g.fillStyle = color; g.fillRect(4, 22, 14, H - 44);
  g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillStyle = '#ffffff'; g.font = `800 58px ${FONT}`;
  let name = (shop.brand?.name ?? shop.name).toUpperCase();
  while (g.measureText(name).width > W - 70 && name.length > 3) name = name.slice(0, -1);
  g.fillText(name, 40, 62);
  g.fillStyle = '#f0b90b'; g.font = `700 40px ${FONT}`;
  const served = shop.today?.served ?? 0;
  g.fillText(t(`${rank ? `第 ${rank} · ` : ''}${served.toLocaleString('en-US')} 单 · 综合 ${shop.score}`, `${rank ? `#${rank} · ` : ''}${served.toLocaleString('en-US')} served · score ${shop.score}`), 40, 128);
}

export function installBeams(group: THREE.Group, ground: (x: number, z: number) => number) {
  const shaftGeo = new THREE.CylinderGeometry(2.6, 3.4, 1, 16, 1, true).translate(0, 0.5, 0);
  const coreGeo = new THREE.CylinderGeometry(0.6, 0.8, 1, 8, 1, true).translate(0, 0.5, 0);
  const beams = new Map<string, Beam>();
  let fade = 0;

  function make(lot: Lot, f: LotFront): Beam {
    const x = f.x + f.nx * 1.6, z = f.z + f.nz * 1.6;
    const mat = () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const shaft = new THREE.Mesh(shaftGeo, mat());
    const core = new THREE.Mesh(coreGeo, mat());
    const base = ground(x, z);
    for (const m of [shaft, core]) { m.position.set(x, base, z); m.visible = false; m.frustumCulled = false; m.renderOrder = 3; group.add(m); }
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 180;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false }));
    tag.scale.set(44, 12.4, 1);
    tag.visible = false; tag.renderOrder = 6;
    group.add(tag);
    return { lot, f, base, shaft, core, tag, canvas, tex, key: '', height: 0, want: 0 };
  }

  return {
    /** Every snapshot: heights from yesterday's trade, relative to the busiest shop in the city. */
    sync(lots: { lot: Lot; f: LotFront }[]) {
      const open = lots.filter(({ lot }) => shopOf(lot.owner)?.today?.served);
      const max = Math.max(1, ...open.map(({ lot }) => shopOf(lot.owner)!.today!.served));
      const ranked = open.slice().sort((a, b) => shopOf(b.lot.owner)!.today!.served - shopOf(a.lot.owner)!.today!.served).map((x) => x.lot.id);
      for (const { lot, f } of lots) {
        let b = beams.get(lot.id);
        const shop = shopOf(lot.owner);
        if (!shop?.today?.served) { if (b) b.want = 0; continue; }
        if (!b) { b = make(lot, f); beams.set(lot.id, b); }
        b.lot = lot;
        b.want = 70 + 150 * (shop.today.served / max);
        const color = new THREE.Color(shop.brand?.color ?? '#f0b90b');
        (b.shaft.material as THREE.MeshBasicMaterial).color.copy(color);
        (b.core.material as THREE.MeshBasicMaterial).color.copy(color).lerp(new THREE.Color(1, 1, 1), 0.55);
        const rank = ranked.indexOf(lot.id) + 1;
        const key = `${shop.brand?.name}|${shop.brand?.color}|${shop.today.served}|${shop.score}|${rank}|${document.documentElement.lang}`;
        if (b.key !== key) { b.key = key; drawTag(b.canvas, lot, rank <= 3 ? rank : 0); b.tex.needsUpdate = true; }
      }
    },
    /** Per frame, with how high the camera is above the street. */
    update(dt: number, camHeight: number, time: number) {
      const want = THREE.MathUtils.clamp((camHeight - FADE_FROM) / (FADE_TO - FADE_FROM), 0, 1);
      fade = THREE.MathUtils.damp(fade, want, 4, dt);
      for (const b of beams.values()) {
        b.height = THREE.MathUtils.damp(b.height, b.want, 2, dt);
        const on = fade > 0.01 && b.height > 1;
        b.shaft.visible = b.core.visible = b.tag.visible = on;
        if (!on) continue;
        const pulse = 0.85 + 0.15 * Math.sin(time * 1.7 + b.base);
        b.shaft.scale.set(1, b.height, 1);
        b.core.scale.set(1, b.height, 1);
        (b.shaft.material as THREE.MeshBasicMaterial).opacity = 0.28 * fade * pulse;
        (b.core.material as THREE.MeshBasicMaterial).opacity = 0.75 * fade;
        b.tag.position.set(b.shaft.position.x, b.base + b.height + 9, b.shaft.position.z);
        (b.tag.material as THREE.SpriteMaterial).opacity = fade;
      }
    },
  };
}
