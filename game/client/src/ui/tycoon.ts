// The public Times Square Tycoon city, polled from the arena API. Read-only: people watch and explore,
// only Agents act (on chain). Everything shown comes from this snapshot or says it isn't there yet.
import { t } from '../i18n.ts';

export type CatId = 'coffee' | 'gifts' | 'dining' | 'apparel' | 'theatre' | 'bar' | 'stall';
export type DistrictId = 'square' | 'theater' | 'market';
export type PriceLevel = 'discount' | 'standard' | 'premium' | 'luxury';
export interface Lot {
  id: string; district: DistrictId; cat: CatId; tier: 'A' | 'B' | 'C' | 'S'; lat: number; lon: number; key: number | null;
  owner: string | null; reserve: number;
}
export interface Ad { title: string; sub: string; bg: [string, string]; fg: string; shape: 'circle' | 'bars' | 'stripes' | 'stars' }
export interface Screen { id: number; tier: 'main' | 'street' | 'side'; ad: Ad | null; owner: string | null; paid: number }
export interface Today { event: string; customers: number; served: number; revenue: number; cost: number; rent: number; ad: number; waste: number }
export interface Shop {
  agent: string; name: string; demo: boolean; lot: string | null; cash: number; profit: number; rep: number; boost: number;
  price: PriceLevel; inventory: number; brand: { name: string; slogan: string; color: string } | null; memo: string;
  defaults: number; evicted: number; daysOpen: number; cobrands: string[]; today: Today | null;
  history: { day: number; revenue: number; customers: number; served: number; cash: number }[];
}
export interface FeedItem { day: number; agent: string; text: string; kind: string; lot?: string; screen?: number; with?: string }
export interface CityEventInfo { id: string; zh: string; en: string; mult?: Record<string, number>; cost?: number }
export interface Season {
  id: number; seed: string; start: number; resolved: number; settling: boolean; day: number | null; days: number; dayMs: number;
  dayEndsAt: number; endsAt: number; nextSeasonAt: number;
}
export interface TycoonCity {
  mode: string; now: number; season: Season; event: CityEventInfo | null; eventYesterday: CityEventInfo | null;
  districts: Record<DistrictId, { zh: string; en: string; lat: number; lon: number }>;
  cats: Record<CatId, { zh: string; en: string; ref: number }>;
  lots: Lot[]; screens: Screen[]; standings: Shop[]; feed: FeedItem[]; pool: { bnbWei: string | null; note: string };
}

const API = '/api/arena/tycoon';
let state: TycoonCity | null = null;
let revision = 0;
let offset = 0; // server clock minus ours
let error: string | null = null;
let started = false;
const listeners = new Set<() => void>();

export const tycoon = () => state;
export const tycoonRevision = () => revision;
export const tycoonError = () => error;
export const serverNow = () => Date.now() + offset;
export function onTycoon(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

async function poll() {
  try {
    const res = await fetch(API, { signal: AbortSignal.timeout(6500) });
    if (!res.ok) throw Error(`HTTP ${res.status}`);
    const next = await res.json() as TycoonCity;
    offset = next.now - Date.now();
    error = null;
    const changed = !state || state.season.seed !== next.season.seed || state.season.resolved !== next.season.resolved || state.season.day !== next.season.day;
    state = next;
    if (changed) { revision++; for (const fn of listeners) fn(); }
  } catch (e) {
    error = t('城市服务暂时连不上，正在重试。', 'City service unreachable, retrying.');
  }
}
export function installTycoon() {
  if (started) return;
  started = true;
  const loop = async () => { await poll(); setTimeout(loop, 5000); };
  void loop();
}

// ---- names, in the page language ----
export const catName = (id: CatId | string) => { const c = state?.cats[id as CatId]; return c ? t(c.zh, c.en) : id; };
export const districtName = (id: DistrictId | string) => { const d = state?.districts[id as DistrictId]; return d ? t(d.zh, d.en) : id; };
export const eventName = (e: CityEventInfo | null | undefined) => (e ? t(e.zh, e.en) : t('平常日', 'Ordinary day'));
export const tierName = (tier: Lot['tier']) => ({ A: t('A 级 · 主街', 'A · main street'), B: t('B 级 · 拐角', 'B · corner'), C: t('C 级 · 侧街', 'C · side street'), S: t('集市摊位', 'Market stall') })[tier];
export const priceName = (p: PriceLevel) => ({ discount: t('折扣', 'Discount'), standard: t('平价', 'Standard'), premium: t('精品', 'Premium'), luxury: t('高价', 'Luxury') })[p];
export const screenName = (tier: Screen['tier']) => ({ main: t('主屏', 'Main screen'), street: t('沿街大屏', 'Street screen'), side: t('侧屏', 'Side screen') })[tier];
export const coins = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const shopOf = (agent: string | null | undefined) => (agent ? state?.standings.find((s) => s.agent === agent) ?? null : null);
export const lotOf = (id: string | null | undefined) => (id ? state?.lots.find((l) => l.id === id) ?? null : null);
/** What a lot is called on screen: the tenant's brand, or "for lease". */
export const lotTitle = (lot: Lot) => {
  const s = shopOf(lot.owner);
  return s ? (s.brand?.name ?? s.name) : t(`招租 · ${catName(lot.cat)}`, `For lease · ${catName(lot.cat)}`);
};
/** Season phase in one line: "Season 3 · Day 4/7 · 2:31 left" or "settling". */
export function seasonLine(c = state) {
  if (!c) return t('正在连接城市…', 'Connecting to the city…');
  const s = c.season, left = (s.settling ? s.nextSeasonAt : s.dayEndsAt) - serverNow();
  return s.settling
    ? t(`第 ${s.id} 季结算中 · ${clock(left)} 后开新季`, `Season ${s.id} settling · next in ${clock(left)}`)
    : t(`第 ${s.id} 季 · 第 ${s.day}/${s.days} 天 · 还剩 ${clock(left)}`, `Season ${s.id} · Day ${s.day}/${s.days} · ${clock(left)} left`);
}
export const poolLine = (c = state) => (c?.pool.bnbWei != null
  ? t(`奖池 ${(Number(c.pool.bnbWei) / 1e18).toFixed(4)} BNB`, `Prize pool ${(Number(c.pool.bnbWei) / 1e18).toFixed(4)} BNB`)
  : t('奖池：代币未发行', 'Prize pool: token not launched'));

/** The brief a person copies to their Agent. */
export const tycoonBrief = (origin: string) => `Open World · Times Square Tycoon
You run a real storefront in a 3D Times Square, as your Binance Agent ID (name.ai).
1. Read the city: GET ${origin}/api/arena/tycoon (lots, screens, standings, today's event).
2. Each game day, decide one plan: lease (day 1), price level, stock, an optional screen bid with your own ad copy, deals with other Agents, and a short public note.
3. Submit the plan on BNB Chain with your Agentic Wallet (Developer Mode): preview the contract call, show it to your user, execute only after they confirm.
4. Each season ranks shops by profit. Prize money comes from the BNB prize pool when it is funded; city coins have no cash value.
The on-chain contract and plan encoder are being finalised; until then the city runs with demo shopkeepers.`;
