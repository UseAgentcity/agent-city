// Inside an Agent's shop: the room is laid out for the shop's trade under the Agent's brand (not the brand
// the map lists for the building), with the owner's screen facing the door, brand-coloured light, and as
// many customers browsing as yesterday's trade supports.
import * as THREE from 'three';
import { Crowd } from '../earth/crowd.ts';
import { rawCanvases, t } from '../i18n.ts';
import type { GenericInterior, RoomInteraction } from '../rooms/index.ts';
import type { Poi } from '../rooms/stores.ts';
import { catName, coins, districtName, eventName, priceName, shopOf, tierName, tokensShort, tycoon, upgradeName, type CatId, type Lot, type UpgradeId } from './tycoon.ts';

/** The map class that lays the room out for each trade. */
const TRADE_POI: Record<CatId, { cls: string; sub: string }> = {
  coffee: { cls: 'cafe', sub: 'cafe' },
  gifts: { cls: 'shop', sub: 'gift' },
  dining: { cls: 'restaurant', sub: 'restaurant' },
  apparel: { cls: 'clothing_store', sub: 'clothes' },
  theatre: { cls: 'bar', sub: 'bar' }, // a theatre lobby with its bar
  bar: { cls: 'bar', sub: 'pub' },
  stall: { cls: 'shop', sub: 'gift' },
};
/** The point of interest an Agent's shop presents itself as: its brand and its trade. */
export function shopPoi(lot: Lot): Poi {
  const shop = shopOf(lot.owner);
  return { name: shop?.brand?.name ?? t(`招租中的${catName(lot.cat)}店面`, `${catName(lot.cat)} for lease`), ...TRADE_POI[lot.cat] };
}

const W = 1600, H = 900;
const FONT = 'Inter, "PingFang SC", "Microsoft YaHei", Arial, sans-serif';
function fit(g: CanvasRenderingContext2D, text: string, weight: number, px: number, max: number) {
  g.font = `${weight} ${px}px ${FONT}`;
  while (g.measureText(text).width > max && px > 18) { px -= 2; g.font = `${weight} ${px}px ${FONT}`; }
}
/** The owner's screen: who runs the shop and how it is doing, from the public city snapshot. */
function drawOwnerScreen(c: HTMLCanvasElement, lot: Lot) {
  rawCanvases.add(c);
  const g = c.getContext('2d')!;
  const shop = shopOf(lot.owner);
  const color = shop?.brand?.color ?? '#f0b90b';
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0b0e14'); bg.addColorStop(1, '#141922');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = color; g.fillRect(0, 0, W, 14);
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  if (!shop) {
    g.fillStyle = '#f0b90b'; fit(g, t('招租 · FOR LEASE', 'FOR LEASE'), 900, 120, W - 120); g.fillText(t('招租 · FOR LEASE', 'FOR LEASE'), 60, 220);
    g.fillStyle = '#c9d1dc'; g.font = `600 44px ${FONT}`;
    g.fillText(`${catName(lot.cat)} · ${tierName(lot.tier)} · ${districtName(lot.district)}`, 60, 320, W - 120);
    g.fillText(lot.leaseReserve ? t(`季度租约 ${tokensShort(lot.leaseReserve)} 代币起 · 日常租金 ${coins(lot.reserve)} 城市币`, `Season lease from ${tokensShort(lot.leaseReserve)} tokens · daily rent ${coins(lot.reserve)} coins`) : t('免费摊位', 'Free stall'), 60, 400, W - 120);
    g.fillStyle = '#f4f1e8'; g.font = `800 56px ${FONT}`;
    g.fillText(t('派你的 Agent 来这里开店', 'Send your Agent to open here'), 60, 560, W - 120);
    g.fillStyle = '#8d96a5'; g.font = `500 32px ${FONT}`;
    g.fillText(t('只有持有币安 Agent ID 的 Agent 能租店。按 E 看怎么接入。', 'Only an Agent with a Binance Agent ID can lease. Press E to see how.'), 60, 640, W - 120);
    return;
  }
  // Brand and owner.
  g.fillStyle = '#ffffff'; g.shadowColor = color; g.shadowBlur = 30;
  fit(g, shop.brand?.name ?? shop.name, 900, 110, 980); g.fillText(shop.brand?.name ?? shop.name, 60, 160);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,255,255,.75)'; g.font = `600 36px ${FONT}`;
  g.fillText(`${catName(lot.cat)} · ${districtName(lot.district)}${shop.brand?.slogan ? ` · 「${shop.brand.slogan}」` : ''}`, 62, 220, 980);
  g.textAlign = 'right'; g.fillStyle = color; g.font = `800 40px ${FONT}`;
  g.fillText(shop.name, W - 60, 110, 520);
  g.fillStyle = '#8d96a5'; g.font = `600 28px ${FONT}`;
  g.fillText(t('由 Agent 经营', 'Run by an Agent'), W - 60, 156);
  g.fillText(`${t('今日', 'Today')} · ${eventName(tycoon()?.event)}`, W - 60, 200, 520);
  g.textAlign = 'left';
  // Stat tiles.
  const d = shop.today;
  const tiles: [string, string, string?][] = [
    [t('综合分', 'Season score'), String(shop.score), shop.scoreParts ? t(`利润 ${shop.scoreParts.profit} · 成交 ${shop.scoreParts.traffic} · 口碑 ${shop.scoreParts.rep}`, `profit ${shop.scoreParts.profit} · trade ${shop.scoreParts.traffic} · rep ${shop.scoreParts.rep}`) : ''],
    [t('昨天的客人', 'Customers yesterday'), d ? `${d.served} / ${d.customers}` : '—', d && d.customers > d.served ? t(`缺货流失 ${d.customers - d.served} 位`, `${d.customers - d.served} turned away`) : t('成交 / 进店', 'served / came in')],
    [t('定价', 'Price'), priceName(shop.price), t(`口碑 ${shop.rep.toFixed(2)}`, `reputation ${shop.rep.toFixed(2)}`)],
    [t('本季利润', 'Season profit'), coins(shop.profit), t(`库存 ${shop.inventory}`, `${shop.inventory} in stock`)],
  ];
  tiles.forEach(([k, v, sub], i) => {
    const x = 60 + i * 380, y = 270;
    g.fillStyle = 'rgba(255,255,255,.05)'; g.beginPath(); g.roundRect(x, y, 350, 220, 22); g.fill();
    g.fillStyle = '#8d96a5'; g.font = `600 28px ${FONT}`; g.fillText(k, x + 26, y + 50, 300);
    g.fillStyle = i === 0 ? color : '#f4f1e8'; fit(g, v, 900, 76, 300); g.fillText(v, x + 26, y + 140);
    g.fillStyle = '#8d96a5'; g.font = `500 22px ${FONT}`; g.fillText(sub ?? '', x + 26, y + 190, 300);
  });
  // Owner's note.
  if (shop.memo) {
    g.fillStyle = 'rgba(255,255,255,.06)'; g.beginPath(); g.roundRect(60, 525, 1060, 110, 22); g.fill();
    g.fillStyle = '#f4f1e8'; fit(g, `💬 ${shop.memo}`, 600, 40, 1000); g.fillText(`💬 ${shop.memo}`, 90, 592);
  }
  // Revenue by day.
  const hist = shop.history;
  const max = Math.max(1, ...hist.map((h) => h.revenue));
  g.fillStyle = '#8d96a5'; g.font = `600 26px ${FONT}`; g.fillText(t('每日营业额', 'Daily revenue'), 1160, 545);
  hist.forEach((h, i) => {
    const bh = Math.round((h.revenue / max) * 160);
    g.fillStyle = color; g.fillRect(1160 + i * 52, 800 - bh, 36, bh);
    g.fillStyle = '#5b6170'; g.font = `500 20px ${FONT}`; g.fillText(String(h.day), 1168 + i * 52, 830);
  });
  // Tokens and upgrades.
  const up = (Object.keys(shop.upgrades) as UpgradeId[]).filter((k) => shop.upgrades[k]).map((k) => `${upgradeName(k)} ${shop.upgrades[k]}`);
  g.fillStyle = '#c9d1dc'; g.font = `600 30px ${FONT}`;
  g.fillText(t(`本季花费 ${tokensShort(shop.tokensSpent)} 代币`, `${tokensShort(shop.tokensSpent)} tokens spent this season`) + (up.length ? ` · ${up.join(' · ')}` : ''), 60, 710, 1060);
  if (shop.bestAd) { g.fillStyle = color; g.font = `800 30px ${FONT}`; g.fillText(t('★ 本季最佳广告', '★ Best ad this season'), 60, 760); }
  g.fillStyle = '#5b6170'; g.font = `500 22px ${FONT}`;
  g.fillText(t('数据来自城市公开快照 · 按 E 在手机里看详情', 'From the public city snapshot · press E for details on the phone'), 60, 860);
}

/**
 * Dresses an interior built for a lot: the owner's screen facing the door (with an E interaction), a strip
 * of brand-coloured light over it, and browsing customers. Returns per-frame update and dispose.
 */
export function decorateShopInterior(it: GenericInterior, lot: Lot, openLot: (id: string) => void) {
  const group = new THREE.Group();
  group.name = 'tycoon-interior';
  it.scene.add(group);
  const fwd = new THREE.Vector3(Math.sin(it.spawnFacing), 0, Math.cos(it.spawnFacing));
  const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
  const at = (ahead: number, side: number, y: number) => it.spawn.clone().addScaledVector(fwd, ahead).addScaledVector(right, side).setY(it.spawn.y + y);

  // The owner's screen, hung facing the door a few steps in.
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.575), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  // High enough to read over your own head from the third-person camera at the door.
  screen.position.copy(at(4.6, 0, 2.6));
  screen.rotation.y = it.spawnFacing + Math.PI;
  group.add(screen);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.92, 1.7, 0.06), new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.4, metalness: 0.6 }));
  frame.position.copy(screen.position).addScaledVector(fwd, 0.035);
  frame.rotation.y = screen.rotation.y;
  group.add(frame);
  // Brand light: a glowing strip over the screen and a soft coloured light on the room.
  const color = new THREE.Color(shopOf(lot.owner)?.brand?.color ?? '#f0b90b');
  const strip = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.05, 0.08), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  strip.position.copy(screen.position).setY(screen.position.y + 0.9);
  strip.rotation.y = screen.rotation.y;
  group.add(strip);
  const glow = new THREE.PointLight(color, 2.5, 8, 2);
  glow.position.copy(at(3.8, 0, 2.2));
  group.add(glow);
  let key = '';
  const redraw = () => {
    const s = shopOf(lot.owner);
    const k = `${lot.owner}|${s?.today?.served}|${s?.score}|${s?.memo}|${s?.price}|${s?.brand?.name}|${document.documentElement.lang}`;
    if (k === key) return;
    key = k;
    drawOwnerScreen(canvas, lot);
    tex.needsUpdate = true;
  };
  redraw();

  // Customers browsing: up to six, scaled to yesterday's trade against the best shop in the same trade.
  const crowd = new Crowd(6);
  group.add(crowd.group);
  const city = tycoon();
  const shop = shopOf(lot.owner);
  const best = Math.max(1, ...(city?.standings ?? []).filter((s) => s.cat === lot.cat).map((s) => s.today?.served ?? 0));
  const n = shop?.today?.served ? Math.max(1, Math.round((shop.today.served / best) * 6)) : 0;
  const spots: [number, number][] = [[2.2, -1.4], [2.8, 1.3], [1.6, 1.8], [3.3, -0.4], [1.4, -2.1], [3.0, 2.2]];
  crowd.members.forEach((m, i) => {
    m.visible = i < n; m.fade = 1; m.speed = 0; m.pose = 'stand';
    const p = at(spots[i][0], spots[i][1], 0);
    m.pos.copy(p);
    m.yaw = it.spawnFacing + (Math.random() - 0.5) * 2.2;
    m.carry = i === 1;
  });

  // E at the screen opens the shop on the phone.
  const interaction: RoomInteraction = {
    id: `tycoon:screen:${lot.id}`, position: at(2.8, 0, 0), radius: 2.2,
    label: shop ? t(`${shop.brand?.name ?? shop.name} 的经营数据`, `${shop.brand?.name ?? shop.name}: the numbers`) : t('这间店在招租', 'This shop is for lease'),
    sub: shop ? t(`店主 ${shop.name} · 由 Agent 经营`, `Owner ${shop.name} · run by an Agent`) : t('派你的 Agent 来开店', 'Send your Agent to open here'),
    action: () => openLot(lot.id),
  };
  const base = it.interactions.bind(it);
  it.interactions = () => (it.floor === 0 ? [...base(), interaction] : base());
  it.onInteractionsChanged?.();

  let tick = 0;
  return {
    update(dt: number) {
      crowd.update(dt);
      tick -= dt;
      if (tick <= 0) { tick = 1; redraw(); }
    },
    dispose() {
      it.scene.remove(group);
      tex.dispose();
      screen.geometry.dispose();
    },
  };
}
