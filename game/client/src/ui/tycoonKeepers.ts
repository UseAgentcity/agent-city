// The Agents themselves, standing at their shops: a small hovering robot in the brand's colour beside each
// totem (behind the counter at a market stall), turned toward its queue, bobbing, glancing about and now and
// then waving at the next customer. Every robot shares one instanced mesh per part, so 32 cost a handful of
// draw calls. Empty lots get a papered "for lease" banner over the door instead.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { rawCanvases, t } from '../i18n.ts';
import { auctionDay, catName, shopOf, tokensShort, type Lot } from './tycoon.ts';
import type { LotFront } from './tycoonWorld.ts';

const MAX = 40;
const FONT = 'Inter, "PingFang SC", "Microsoft YaHei", Arial, sans-serif';

interface Keeper { tag?: THREE.Sprite; lot: Lot; pos: THREE.Vector3; yaw: number; look: number; phase: number; wave: number; nextWave: number; on: boolean; color: string; banner?: THREE.Mesh; bannerTex?: THREE.CanvasTexture; bannerKey?: string }

function drawLease(c: HTMLCanvasElement, lot: Lot) {
  rawCanvases.add(c);
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height;
  g.fillStyle = '#d8c39a'; g.fillRect(0, 0, W, H);
  // Paper grain.
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(90,60,20,${Math.random() * 0.05})`; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
  g.fillStyle = 'rgba(240,185,11,.85)';
  for (const [x, y, r] of [[30, 20, -0.5], [W - 90, 20, 0.5], [30, H - 40, 0.5], [W - 90, H - 40, -0.5]] as const) {
    g.save(); g.translate(x + 30, y + 10); g.rotate(r); g.fillRect(-45, -12, 90, 24); g.restore();
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#1c1710';
  g.font = `900 150px ${FONT}`;
  const auction = auctionDay();
  g.fillText(auction ? t('竞 租 中', 'AUCTION') : t('招 租', 'FOR LEASE'), W / 2, H * 0.36);
  g.font = `700 44px ${FONT}`;
  g.fillStyle = '#3b2f1d';
  g.fillText(`${catName(lot.cat)} · ${t(`租约 ${tokensShort(lot.leaseReserve)} 代币起`, `lease from ${tokensShort(lot.leaseReserve)} tokens`)}`, W / 2, H * 0.66);
  g.fillStyle = '#7a5a12';
  g.font = `700 36px ${FONT}`;
  g.fillText(auction ? t('今晚揭晓店主 · 明天开张', 'Tenant announced tonight, open tomorrow') : t('派你的 Agent 来这里开店', 'Send your Agent to open here'), W / 2, H * 0.84);
}

/** A small "demo" plate over a simulated Agent's head, so nobody mistakes the city's own bots for players. */
function demoTag() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  rawCanvases.add(c);
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(14,16,22,.82)';
  g.beginPath(); g.roundRect(6, 10, 244, 76, 38); g.fill();
  g.strokeStyle = 'rgba(240,185,11,.9)'; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#f0b90b'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `800 40px ${FONT}`;
  g.fillText(t('演示 Agent', 'DEMO AGENT'), 128, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, toneMapped: false, depthWrite: false }));
  sp.scale.set(0.62, 0.23, 1);
  return sp;
}

export function installKeepers(group: THREE.Group, ground: (x: number, z: number) => number) {
  const shell = new THREE.MeshStandardMaterial({ color: 0xf1f2f5, roughness: 0.35, metalness: 0.15 });
  const limb = new THREE.MeshStandardMaterial({ color: 0xbfc5cf, roughness: 0.45, metalness: 0.3 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) => {
    const m = new THREE.InstancedMesh(geo, mat, MAX);
    m.count = MAX; m.castShadow = shadow; m.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX; i++) { m.setMatrixAt(i, zero); m.setColorAt(i, new THREE.Color(1, 1, 1)); }
    group.add(m);
    return m;
  };
  const body = mk(new THREE.CylinderGeometry(0.17, 0.23, 0.62, 20), shell);
  const head = mk(new RoundedBoxGeometry(0.4, 0.31, 0.33, 4, 0.1), shell);
  const visor = mk(new RoundedBoxGeometry(0.31, 0.12, 0.03, 2, 0.02), glow, false);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0b0d12 });
  const eyeL = mk(new THREE.CircleGeometry(0.026, 12), eyeMat, false);
  const eyeR = mk(new THREE.CircleGeometry(0.026, 12), eyeMat, false);
  const armL = mk(new THREE.CapsuleGeometry(0.05, 0.3, 4, 8).translate(0, -0.19, 0), limb);
  const armR = mk(new THREE.CapsuleGeometry(0.05, 0.3, 4, 8).translate(0, -0.19, 0), limb);
  const badge = mk(new THREE.CircleGeometry(0.075, 20), glow, false);
  const ring = mk(new THREE.TorusGeometry(0.2, 0.022, 8, 28), glow, false);
  const parts = [body, head, visor, eyeL, eyeR, armL, armR, badge, ring];

  const keepers: Keeper[] = [];
  const byLot = new Map<string, Keeper>();
  const M = new THREE.Matrix4(), P = new THREE.Matrix4(), H = new THREE.Matrix4(), tmp = new THREE.Matrix4();
  const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const UP = new THREE.Vector3(0, 1, 0);
  const compose = (x: number, y: number, z: number, rx: number, ry: number, rz: number) =>
    tmp.compose(v.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz, 'YXZ')), one);

  /** Where a lot's Agent stands, and which way it faces. */
  function place(lot: Lot, f: LotFront, totemSide: number): Keeper {
    let k = byLot.get(lot.id);
    if (k) return k;
    let x: number, z: number, dx: number, dz: number;
    if (lot.key == null) {
      // Behind the stall counter, facing the walkway.
      x = f.x - f.nx * 0.12; z = f.z - f.nz * 0.12; dx = f.nx; dz = f.nz;
    } else {
      // Between the door and the totem, turned a little toward the line on the other side.
      x = f.x + f.nx * 1.25 + f.tx * totemSide * 0.85; z = f.z + f.nz * 1.25 + f.tz * totemSide * 0.85;
      dx = f.nx - f.tx * totemSide * 0.7; dz = f.nz - f.tz * totemSide * 0.7;
    }
    k = { lot, pos: new THREE.Vector3(x, ground(x, z), z), yaw: Math.atan2(dx, dz), look: 0, phase: Math.random() * 10, wave: 0, nextWave: 2 + Math.random() * 6, on: false, color: '' };
    if (lot.key != null && keepers.length < MAX) {
      const c = document.createElement('canvas');
      c.width = 1024; c.height = 512;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
      m.position.set(f.x + f.nx * 0.07, ground(f.x, f.z) + 1.75, f.z + f.nz * 0.07);
      m.rotation.y = Math.atan2(f.nx, f.nz);
      m.visible = false;
      group.add(m);
      k.banner = m; k.bannerTex = tex;
    }
    if (keepers.length >= MAX) return k;
    keepers.push(k);
    byLot.set(lot.id, k);
    return k;
  }

  return {
    sync(lot: Lot, f: LotFront, totemSide: number) {
      const k = place(lot, f, totemSide);
      const shop = shopOf(lot.owner);
      k.on = !!shop;
      const demo = !!shop?.demo;
      if (demo && !k.tag) { k.tag = demoTag(); group.add(k.tag); }
      if (k.tag) k.tag.visible = demo;
      const i = keepers.indexOf(k);
      if (i < 0) return;
      const color = shop?.brand?.color ?? '#f0b90b';
      if (k.color !== color) {
        k.color = color;
        const c = new THREE.Color(color);
        // A dark brand colour still has to read as a lit visor.
        const hsl = { h: 0, s: 0, l: 0 }; c.getHSL(hsl);
        if (hsl.l < 0.45) c.setHSL(hsl.h, Math.max(0.6, hsl.s), 0.55);
        for (const m of [visor, badge, ring]) { m.setColorAt(i, c); m.instanceColor!.needsUpdate = true; }
      }
      if (k.banner && k.bannerTex) {
        // Theatres already carry the lease on their marquee.
        k.banner.visible = !shop && lot.cat !== 'theatre';
        const key = `${lot.leaseReserve}|${auctionDay()}|${document.documentElement.lang}`;
        if (k.banner.visible && k.bannerKey !== key) { k.bannerKey = key; drawLease(k.bannerTex.image as HTMLCanvasElement, lot); k.bannerTex.needsUpdate = true; }
      }
    },
    update(time: number, dt: number) {
      keepers.forEach((k, i) => {
        if (!k.on) {
          for (const m of parts) m.setMatrixAt(i, zero);
          return;
        }
        if (k.tag?.visible) k.tag.position.set(k.pos.x, k.pos.y + 1.78 + Math.sin(time * 2.2 + k.phase) * 0.04, k.pos.z);
        k.nextWave -= dt;
        if (k.nextWave <= 0) { k.wave = 2.4; k.nextWave = 6 + Math.random() * 9; }
        k.wave = Math.max(0, k.wave - dt);
        const bob = Math.sin(time * 2.2 + k.phase) * 0.04;
        const glance = Math.sin(time * 0.37 + k.phase) * 0.45 + Math.sin(time * 0.11 + k.phase * 2) * 0.25;
        M.compose(v.set(k.pos.x, k.pos.y + 0.18 + bob, k.pos.z), q.setFromAxisAngle(UP, k.yaw), one);
        body.setMatrixAt(i, P.copy(M).multiply(compose(0, 0.52, 0, 0, 0, 0)));
        ring.setMatrixAt(i, P.copy(M).multiply(compose(0, 0.12 - bob * 0.5, 0, Math.PI / 2, 0, 0)));
        badge.setMatrixAt(i, P.copy(M).multiply(compose(0, 0.62, 0.2, -0.13, 0, 0)));
        H.copy(M).multiply(compose(0, 1.1, 0, Math.sin(time * 0.9 + k.phase) * 0.06, glance, 0));
        head.setMatrixAt(i, H);
        visor.setMatrixAt(i, P.copy(H).multiply(compose(0, -0.01, 0.16, 0, 0, 0)));
        eyeL.setMatrixAt(i, P.copy(H).multiply(compose(-0.07, -0.005, 0.177, 0, 0, 0)));
        eyeR.setMatrixAt(i, P.copy(H).multiply(compose(0.07, -0.005, 0.177, 0, 0, 0)));
        // Arms: the left hangs, swaying; the right waves when it's greeting someone.
        const sway = Math.sin(time * 1.6 + k.phase) * 0.08;
        armL.setMatrixAt(i, P.copy(M).multiply(compose(-0.25, 0.76, 0, sway, 0, -0.18)));
        const w = k.wave > 0 ? Math.min(1, k.wave / 0.4, (2.4 - k.wave) / 0.4) : 0;
        const lift = 0.18 + w * 2.25 + w * Math.sin(time * 11) * 0.35;
        armR.setMatrixAt(i, P.copy(M).multiply(compose(0.25, 0.76, 0, -sway * (1 - w), 0, lift)));
      });
      for (const m of parts) m.instanceMatrix.needsUpdate = true;
    },
  };
}
