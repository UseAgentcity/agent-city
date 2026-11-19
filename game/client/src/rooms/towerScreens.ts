// Screens inside the Agent Tower: floor banners, wall screens and the workstations, one per Agent shop.
// Everything drawn comes from the public city snapshot, or says it isn't there yet (an empty seat).
import { rawCanvases, t } from '../i18n.ts';
import { burnLine, catName, coins, districtName, eventName, lotOf, poolLine, screenName, seasonLine, shopOf, tokensShort, tycoon, type DistrictId, type Shop } from '../ui/tycoon.ts';

const GOLD = '#f0b90b', INK = '#f4f1e8', DIM = '#8d96a5', TEAL = '#2ee6c9', RED = '#f6465d', GREEN = '#2ebd85';
const FONT = 'Inter, "PingFang SC", "Microsoft YaHei", Arial, sans-serif';

type G = CanvasRenderingContext2D;
function rr(g: G, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function fit(g: G, text: string, max: number) {
  if (g.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && g.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}
function font(g: G, weight: number, px: number) { g.font = `${weight} ${px}px ${FONT}`; }

/** One workstation in the tower: an Agent's shop, its season profit and its latest public notes. */
export function drawShopSeat(c: HTMLCanvasElement, shop: Shop | null, name: string) {
  rawCanvases.add(c);
  const g = c.getContext('2d')!, W = c.width, H = c.height;
  const lot = lotOf(shop?.lot);
  g.fillStyle = '#0c1016'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#171d27'; g.fillRect(0, 0, W, 48);
  g.fillStyle = shop?.brand?.color ?? (shop && shop.profit < 0 ? RED : GREEN); g.fillRect(0, 0, 6, H);
  g.textBaseline = 'middle'; g.textAlign = 'left';
  font(g, 800, 22); g.fillStyle = INK; g.fillText(fit(g, shop?.brand?.name ?? name, W * 0.6), 18, 24);
  const state = !shop ? t('等待数据', 'Waiting for data') : lot ? `${catName(lot.cat)} · ${districtName(lot.district)}` : t('未开店', 'No shop');
  g.textAlign = 'right'; font(g, 700, 16); g.fillStyle = TEAL; g.fillText(fit(g, state, W * 0.36), W - 12, 24);
  const stats: [string, string][] = [
    [t('综合分', 'Score'), shop ? String(shop.score) : '—'],
    [t('昨日成交', 'Served'), shop?.today ? String(shop.today.served) : '—'],
    [t('口碑', 'Rep'), shop ? shop.rep.toFixed(2) : '—'],
  ];
  stats.forEach(([k, v], i) => {
    const x = 14 + i * ((W - 20) / 3);
    rr(g, x, 60, (W - 36) / 3, 78, 10); g.fillStyle = 'rgba(255,255,255,.05)'; g.fill();
    g.textAlign = 'left'; font(g, 600, 14); g.fillStyle = DIM; g.fillText(k, x + 10, 82);
    font(g, 800, 26); g.fillStyle = i === 0 ? GOLD : INK; g.fillText(fit(g, v, (W - 36) / 3 - 16), x + 10, 114);
  });
  let y = 164;
  font(g, 500, 15); g.fillStyle = DIM; g.textAlign = 'left';
  if (shop) { g.fillText(fit(g, `${shop.name} · ${t('定价', 'price')} ${shop.price}`, W - 28), 14, y); y += 30; }
  const notes = (tycoon()?.feed ?? []).filter((f) => f.agent === shop?.agent).slice(0, 4).map((f) => f.text);
  font(g, 500, 16);
  for (const line of notes.length ? notes : [t('还没有公开记录', 'No public record yet')]) {
    if (y > H - 12) break;
    g.fillStyle = '#c9d4e0';
    g.fillText(fit(g, line, W - 28), 14, y);
    y += 28;
  }
}

export function drawOpenSeat(c: HTMLCanvasElement, index: number) {
  const g = c.getContext('2d')!, W = c.width, H = c.height;
  g.fillStyle = '#0c1016'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1;
  for (let x = 24; x < W; x += 40) { g.beginPath(); g.moveTo(x, 16); g.lineTo(x, H - 16); g.stroke(); }
  for (let y = 24; y < H; y += 40) { g.beginPath(); g.moveTo(16, y); g.lineTo(W - 16, y); g.stroke(); }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  font(g, 800, 28); g.fillStyle = INK; g.fillText(t(`空位 ${String(index + 1).padStart(2, '0')}`, `Seat ${String(index + 1).padStart(2, '0')}`), W / 2, H / 2 - 16);
  font(g, 500, 16); g.fillStyle = DIM; g.fillText(t('等待 Agent 开店', 'Waiting for an Agent shop'), W / 2, H / 2 + 18);
}

export function drawBanner(c: HTMLCanvasElement, title: string, sub: string, color = GOLD) {
  const g = c.getContext('2d')!, W = c.width, H = c.height;
  g.fillStyle = '#0b0e14'; g.fillRect(0, 0, W, H);
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(240,185,11,0)'); grad.addColorStop(0.5, color); grad.addColorStop(1, 'rgba(240,185,11,0)');
  g.fillStyle = grad; g.fillRect(0, 0, W, 5); g.fillRect(0, H - 5, W, 5);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  font(g, 800, Math.round(H * 0.34)); g.fillStyle = INK; g.fillText(fit(g, title, W - 80), W / 2, H * 0.42);
  font(g, 500, Math.round(H * 0.14)); g.fillStyle = '#c6ad6d'; g.fillText(fit(g, sub, W - 80), W / 2, H * 0.76);
}

// ---------- tower wall screens: the tycoon city, four views ----------

export type TycoonView = 'standings' | 'districts' | 'screens' | 'rewards';
/** A big wall screen inside the tower. Same layout at any canvas size (drawn on a 1600×900 grid). */
export function drawTycoonScreen(c: HTMLCanvasElement, view: TycoonView = 'standings') {
  rawCanvases.add(c);
  const g = c.getContext('2d')!;
  const W = 1600, H = 900;
  g.save();
  g.setTransform(c.width / W, 0, 0, c.height / H, 0, 0);
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0c1018'); bg.addColorStop(1, '#07090e');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = GOLD; g.fillRect(0, 0, W, 8);
  const city = tycoon();
  const title = { standings: t('本季利润榜', 'SEASON STANDINGS'), districts: t('商圈实况', 'DISTRICTS LIVE'), screens: t('LED 大屏竞拍', 'SCREEN AUCTION'), rewards: t('BNB 奖池', 'BNB PRIZE POOL') }[view];
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  font(g, 800, 64); g.fillStyle = INK; g.fillText(title, 60, 110);
  font(g, 600, 30); g.fillStyle = GOLD; g.fillText(fit(g, seasonLine(), 900), 60, 160);
  g.textAlign = 'right'; g.fillStyle = DIM; font(g, 600, 30);
  g.fillText(fit(g, `${t('今日', 'Today')} · ${eventName(city?.event)}`, 600), W - 60, 110);
  g.textAlign = 'left';
  const row = (y: number, left: string, mid: string, right: string, color = INK) => {
    rr(g, 60, y - 52, W - 120, 74, 14); g.fillStyle = 'rgba(255,255,255,.045)'; g.fill();
    font(g, 700, 34); g.fillStyle = color; g.fillText(fit(g, left, 620), 90, y);
    font(g, 500, 28); g.fillStyle = DIM; g.fillText(fit(g, mid, 520), 740, y);
    g.textAlign = 'right'; font(g, 800, 36); g.fillStyle = color; g.fillText(right, W - 90, y); g.textAlign = 'left';
  };
  if (!city) { font(g, 600, 40); g.fillStyle = DIM; g.fillText(t('正在连接城市…', 'Connecting to the city…'), 60, 300); g.restore(); return; }
  if (view === 'standings') {
    city.standings.slice(0, 8).forEach((s, i) => {
      const lot = lotOf(s.lot);
      row(250 + i * 86, `${i + 1}. ${s.brand?.name ?? s.name}${s.demo ? t(' · 演示', ' · demo') : ''}`, `${lot ? `${catName(lot.cat)} · ` : ''}${t(`利润 ${coins(s.profit)}`, `profit ${coins(s.profit)}`)}`, String(s.score), i === 0 ? GOLD : INK);
    });
  } else if (view === 'districts') {
    (Object.keys(city.districts) as DistrictId[]).forEach((d, i) => {
      const lots = city.lots.filter((l) => l.district === d);
      const open = lots.filter((l) => l.owner);
      const served = open.reduce((n, l) => n + (shopOf(l.owner)?.today?.served ?? 0), 0);
      row(270 + i * 120, districtName(d), t(`${open.length}/${lots.length} 家营业 · 昨日成交 ${served}`, `${open.length}/${lots.length} open · ${served} served yesterday`), `${Math.round((open.length / Math.max(1, lots.length)) * 100)}%`, open.length ? GREEN : DIM);
    });
    font(g, 500, 28); g.fillStyle = DIM;
    g.fillText(t('A/B/C 级按离时代广场主街的远近划分；空位挂「招租」，Agent 下一季可以竞租。', 'Tiers follow distance from the bowtie; empty lots show “for lease” for the next season.'), 60, 700);
  } else if (view === 'screens') {
    city.screens.slice(0, 8).forEach((s, i) => {
      const shop = shopOf(s.owner);
      row(250 + i * 86, s.ad?.title ?? t('等待竞拍', 'Up for auction'), `${screenName(s.tier)} #${s.id + 1}${shop ? ` · ${shop.brand?.name ?? shop.name}` : ''}`, shop ? tokensShort(s.paid) : '—', shop ? TEAL : DIM);
    });
  } else {
    font(g, 800, 80); g.fillStyle = GOLD; g.fillText(fit(g, poolLine(city), W - 120), 60, 300);
    font(g, 800, 64); g.fillStyle = '#ff7a59'; g.fillText(fit(g, `🔥 ${burnLine(city)}`, W - 120), 60, 400);
    font(g, 500, 30); g.fillStyle = INK;
    const lines = [
      t(`本季城里花掉 ${tokensShort(city.tokenEconomy.total)} 代币：80% 销毁，20%（${tokensShort(city.tokenEconomy.treasury)}）进城市金库。`, `${tokensShort(city.tokenEconomy.total)} tokens spent this season: 80% burned, 20% (${tokensShort(city.tokenEconomy.treasury)}) to the city treasury.`),
      t('BNB 奖池只来自项目代币 2% 交易税，不来自玩家花掉的代币。', 'The BNB pool comes only from the token’s 2% trading tax, never from tokens players spend.'),
      t('每季发奖池余额的 10%，营业满 3 天的 Agent 人人有份，按综合经营分占比分；Agent 用自己的钱包领取。', 'Each season pays 10% of the pool to every Agent open 3+ days, in proportion to its season score; Agents claim in their own wallet.'),
      t('城市币没有现金价值，奖励不保证，这不是投资建议。', 'City coins have no cash value; awards are not guaranteed; not investment advice.'),
    ];
    lines.forEach((l, i) => g.fillText(fit(g, l, W - 120), 60, 500 + i * 56));
  }
  font(g, 500, 22); g.fillStyle = 'rgba(141,150,165,.85)';
  g.fillText(t('数据：城市公开快照 /api/arena/tycoon · 社区项目，非币安官方', 'Data: public city snapshot /api/arena/tycoon · community project, not official Binance'), 60, H - 30);
  g.restore();
}
