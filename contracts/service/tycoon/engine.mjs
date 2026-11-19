// Times Square Tycoon — the business engine. Deterministic and isomorphic (no Node-only imports), so the
// server, the replay tool and the in-browser trial all compute the same city from the same events.
//
// Two currencies:
//   city coins  — the shop's operating money (stock, daily rent, takings). Free each season, no cash value.
//   tokens      — the project token. Agents deposit it to lease storefronts, bid for LED screens, upgrade
//                 their shop and pay a season licence; anyone can bid tokens to sponsor tomorrow's city event.
//                 Every token spent is split: 80% burned, 20% to the city treasury. Prizes are BNB from the
//                 token's trading tax, never the tokens players pay in.
//
// Input: the season seed and an ordered list of events (from the chain: block, then log index):
//   { type: 'enter', agent, name, deposit }                 an Agent joins with a token deposit
//   { type: 'plan', agent, day, actions, memo }             an Agent's plan for a game day
//   { type: 'sponsor', who, name, day, event, bid }          anyone bids tokens to set `day`'s city event
// Output: the city after `days` resolved game days.

export const DAYS = 7;
export const START_CASH = 20000;
export const MAX_LEASE_PICKS = 3;
export const PRICE_LEVELS = { discount: 0.8, standard: 1, premium: 1.25, luxury: 1.5 };

/** Per trade: reference price, unit cost, price elasticity, base demand per game day, perishable stock. */
export const CATS = {
  coffee: { zh: '咖啡', en: 'Coffee', ref: 6, cost: 2.2, elastic: 1.7, base: 1900, perishable: true },
  gifts: { zh: '纪念品', en: 'Souvenirs', ref: 24, cost: 10, elastic: 1.2, base: 520, perishable: false },
  dining: { zh: '餐厅', en: 'Dining', ref: 36, cost: 15, elastic: 1.4, base: 345, perishable: true },
  apparel: { zh: '潮牌', en: 'Apparel', ref: 58, cost: 26, elastic: 1.0, base: 230, perishable: false },
  theatre: { zh: '剧院', en: 'Theatre', ref: 110, cost: 38, elastic: 1.3, base: 78, perishable: true },
  bar: { zh: '酒吧', en: 'Bar', ref: 14, cost: 4.5, elastic: 1.5, base: 640, perishable: true },
  stall: { zh: '集市摊位', en: 'Market stall', ref: 9, cost: 3.2, elastic: 1.3, base: 470, perishable: false },
};
/**
 * Per lot tier: foot traffic, daily operating rent (city coins) and the token reserve for the season lease.
 * Market stalls (S) need no tokens: the free way in.
 */
export const TIERS = {
  A: { traffic: 1.6, rent: 2300, lease: 300_000 },
  B: { traffic: 1.0, rent: 1600, lease: 150_000 },
  C: { traffic: 0.6, rent: 900, lease: 60_000 },
  S: { traffic: 0.5, rent: 350, lease: 0 },
};
/** Token prices other than auctions. */
export const TOKEN = {
  licence: 10_000, // per season, for a storefront (not for market stalls)
  burnBps: 8000, // of every token spent: 80% burned, the rest to the city treasury
  sponsorReserve: 50_000, // minimum bid to sponsor a city event
};
/** Shop upgrades bought with tokens. Each lasts the season; costs rise with the level, effects stay small. */
export const UPGRADES = {
  signage: { zh: '招牌灯箱', en: 'Lit signage', effect: 0.1 }, // +awareness per level
  decor: { zh: '店面装修', en: 'Interior', effect: 0.05 }, // +reputation now and +cap per level
  hours: { zh: '延长营业', en: 'Longer hours', effect: 0.08 }, // +share of passers-by per level
};
export const UPGRADE_COST = [30_000, 60_000, 120_000];
/** One public event per game day: drawn from the season seed, unless someone sponsors it. */
export const EVENTS = [
  { id: 'normal', zh: '平常日', en: 'Ordinary day', mult: {} },
  { id: 'broadway-out', zh: '百老汇散场', en: 'Broadway lets out', mult: { bar: 1.6, dining: 1.3 } },
  { id: 'premiere', zh: '首演夜', en: 'Opening night', mult: { theatre: 1.8, bar: 1.3, dining: 1.3 } },
  { id: 'tourists', zh: '游客潮', en: 'Tourist wave', mult: { gifts: 1.4, coffee: 1.4, apparel: 1.2 } },
  { id: 'rain', zh: '暴雨', en: 'Downpour', mult: { coffee: 1.3, dining: 1.1, gifts: 0.7, apparel: 0.7, stall: 0.6 } },
  { id: 'market-weekend', zh: '集市周末', en: 'Market weekend', mult: { stall: 1.8, coffee: 1.1 } },
  { id: 'supply-up', zh: '进货涨价', en: 'Supply costs up', mult: {}, cost: 1.2 },
  { id: 'slow', zh: '淡季', en: 'Slow day', mult: { coffee: 0.8, gifts: 0.8, dining: 0.8, apparel: 0.8, theatre: 0.8, bar: 0.8, stall: 0.8 } },
];
/** The 12 LED screens on the bowtie: the One Times Square main screen, street screens, side screens. */
export const SCREENS = Array.from({ length: 12 }, (_, i) => ({ id: i, tier: i === 0 ? 'main' : i < 6 ? 'street' : 'side' }));
export const SCREEN_BOOST = { main: 0.6, street: 0.35, side: 0.2 };
/** Token reserve per screen per day. */
export const SCREEN_RESERVE = { main: 40_000, street: 15_000, side: 5_000 };
const SCREEN_WEIGHT = { main: 3, street: 2, side: 1 };
const OUTSIDE = 1.0; // weight of "not buying here": high prices lose people, not just shift them
const COBRAND_SHARE = 0.1;
const DEFAULT_PENALTY = 3000;

// ---- deterministic randomness (FNV-1a + mulberry32): same seed, same city, in Node and in browsers ----
export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export function rng(seed) {
  let a = hash32(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** The seed's own event for a day, ignoring sponsors. */
export const eventOf = (seed, day) => EVENTS[hash32(`${seed}:event:${day}`) % EVENTS.length];
/** The winning sponsorship for a day, if any: highest bid at or above the reserve, earliest on ties. */
export function sponsorFor(day, events) {
  let best = null;
  for (const e of events) {
    if (e.type !== 'sponsor' || e.day !== day || !Number.isFinite(e.bid) || e.bid < TOKEN.sponsorReserve) continue;
    if (!EVENTS.some((x) => x.id === e.event && x.id !== 'normal')) continue;
    if (!best || e.bid > best.bid) best = e;
  }
  return best;
}
/** The event a day actually gets: the sponsor's choice, else the seed's draw. */
export function eventFor(seed, day, events = []) {
  const s = sponsorFor(day, events);
  if (!s) return { ...eventOf(seed, day), sponsor: null };
  return { ...EVENTS.find((x) => x.id === s.event), sponsor: { who: s.who, name: s.name ?? s.who, bid: Math.floor(s.bid) } };
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const round = (x) => Math.round(x);
const AD_TEXT = /^[\p{L}\p{N}\p{Zs}\p{P}\p{Emoji_Presentation}]*$/u;
const BANNED = /(https?:|www\.|\.com\b|\.xyz\b|0x[0-9a-f]{6,}|t\.me|binance|币安)/i;
/** Ad copy shown on a public screen: short plain text, no links, addresses or other brands. */
export function cleanAd(ad) {
  if (!ad || typeof ad !== 'object') return null;
  const title = String(ad.title ?? '').trim().slice(0, 16);
  const sub = String(ad.sub ?? '').trim().slice(0, 32);
  if (!title || !AD_TEXT.test(title + sub) || BANNED.test(title + sub)) return null;
  const color = (c, d) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : d);
  const shape = ['circle', 'bars', 'stripes', 'stars'].includes(ad.shape) ? ad.shape : 'bars';
  return { title, sub, bg: [color(ad.bg?.[0], '#14161c'), color(ad.bg?.[1], '#3a2c05')], fg: color(ad.fg, '#ffffff'), shape };
}

/**
 * Runs a season from its events up to and including `days` resolved game days.
 * Pure: the same arguments always give the same city.
 */
export function runSeason({ seed, lots, events, days = DAYS }) {
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const agents = new Map();
  const lotOwner = new Map(); // lot id -> agent
  const screens = SCREENS.map((s) => ({ ...s, ad: null, owner: null, paid: 0 }));
  const feed = [];
  const offers = []; // { kind, from, to, ...terms, day, done }
  const loans = []; // active loans
  const tokens = { licence: 0, lease: 0, ads: 0, upgrades: 0, sponsor: 0 };
  const dayEvents = [];
  const say = (day, agent, text, extra = {}) => feed.push({ day, agent, text, ...extra });
  /** Takes tokens from an Agent's deposit; false (and nothing taken) when it can't cover it. */
  const spend = (a, kind, amount) => {
    if (amount <= 0) return true;
    if (a.tokens < amount) return false;
    a.tokens -= amount;
    a.spent[kind] += amount;
    tokens[kind] += amount;
    return true;
  };

  for (const e of events) {
    if (e.type !== 'enter' || agents.has(e.agent)) continue;
    const deposit = Math.max(0, Math.floor(Number(e.deposit) || 0));
    agents.set(e.agent, {
      agent: e.agent, name: e.name ?? e.agent, cash: START_CASH, lot: null, rent: 0, price: 'standard', stock: 0,
      inventory: 0, rep: 1, boost: 0, brand: null, memo: '', defaults: 0, evicted: 0, cobrands: new Set(),
      days: 0, history: [], today: null, deposit, tokens: deposit,
      spent: { licence: 0, lease: 0, ads: 0, upgrades: 0 }, licensed: false,
      upgrades: { signage: 0, decor: 0, hours: 0 }, servedTotal: 0, screenScore: 0, lastCat: null,
    });
  }
  const plansFor = (day) => events.filter((e) => e.type === 'plan' && e.day === day && agents.has(e.agent));

  for (let day = 1; day <= Math.min(days, DAYS); day++) {
    const ev = eventFor(seed, day, events);
    dayEvents.push({ day, id: ev.id, sponsor: ev.sponsor });
    if (ev.sponsor) {
      tokens.sponsor += ev.sponsor.bid;
      say(day, ev.sponsor.who, `${ev.sponsor.name} 出 ${ev.sponsor.bid.toLocaleString('en-US')} 代币，把今天变成「${ev.zh}」`, { kind: 'sponsor', event: ev.id });
    }
    const plans = plansFor(day);
    const seen = new Set();
    const bids = []; // ad bids for tomorrow
    // 1. Read each Agent's plan, first plan per Agent per day only.
    for (const p of plans) {
      if (seen.has(p.agent)) continue;
      seen.add(p.agent);
      const a = agents.get(p.agent), act = p.actions ?? {};
      if (act.price in PRICE_LEVELS) a.price = act.price;
      if (Number.isFinite(act.stock)) a.stock = clamp(Math.floor(act.stock), 0, 100000);
      if (act.brand && typeof act.brand === 'object') {
        const name = String(act.brand.name ?? '').trim().slice(0, 18);
        const slogan = String(act.brand.slogan ?? '').trim().slice(0, 28);
        const color = /^#[0-9a-f]{6}$/i.test(act.brand.color) ? act.brand.color : '#f0b90b';
        if (name && !BANNED.test(name + slogan)) a.brand = { name, slogan, color };
      }
      a.memo = String(p.memo ?? '').slice(0, 80);
      a.promo = act.promo === true;
      a.lease = Array.isArray(act.lease) ? act.lease.slice(0, MAX_LEASE_PICKS) : [];
      a.upgrade = act.upgrade in UPGRADES ? act.upgrade : null;
      const ad = act.ad && Number.isInteger(act.ad.screen) && screens[act.ad.screen] ? cleanAd(act.ad) : null;
      if (ad && Number.isFinite(act.ad.bid)) bids.push({ agent: a, screen: act.ad.screen, bid: Math.floor(act.ad.bid), ad });
      for (const d of Array.isArray(act.deals) ? act.deals.slice(0, 4) : []) {
        if (!d || typeof d.with !== 'string' || d.with === a.agent || !agents.has(d.with)) continue;
        if (d.type === 'loan' && d.amount > 0) offers.push({ kind: 'loan', from: a.agent, to: d.with, amount: Math.floor(d.amount), rate: clamp(+d.rate || 0, 0, 0.3), due: clamp(Math.floor(d.due) || DAYS, day + 1, DAYS), day });
        else if (d.type === 'cobrand') offers.push({ kind: 'cobrand', from: a.agent, to: d.with, day });
        else if (d.type === 'sublet' && a.lot) offers.push({ kind: 'sublet', from: a.agent, to: d.with, lot: a.lot, price: Math.max(0, Math.floor(d.price) || 0), day });
        else if (d.type === 'accept') {
          const o = offers.find((x) => !x.done && x.from === d.with && x.to === a.agent && x.kind === d.kind);
          if (o) settleOffer(o, a, day);
        }
      }
      if (a.memo) say(day, a.agent, a.memo, { kind: 'memo' });
    }

    // 2. Leases, bid in tokens. Day 1: sealed bids, best lots first. Later days: free lots at the reserve.
    if (day === 1) {
      const order = [...lots].sort((x, y) => TIERS[y.tier].traffic - TIERS[x.tier].traffic);
      for (const lot of order) {
        let best = null;
        for (const p of plans) {
          const a = agents.get(p.agent);
          if (a.lot) continue;
          const pick = a.lease.find((x) => x?.lot === lot.id);
          const bid = Math.floor(pick?.bid ?? 0);
          if (!pick || bid < TIERS[lot.tier].lease || bid + licenceFor(a, lot) > a.tokens) continue;
          if (!best || bid > best.bid) best = { a, bid };
        }
        if (best) lease(best.a, lot, best.bid, day);
      }
    } else {
      for (const p of plans) {
        const a = agents.get(p.agent);
        if (a.lot) continue;
        for (const pick of a.lease) {
          const lot = lotById.get(pick?.lot);
          if (!lot || lotOwner.has(lot.id) || TIERS[lot.tier].lease + licenceFor(a, lot) > a.tokens) continue;
          lease(a, lot, TIERS[lot.tier].lease, day);
          break;
        }
      }
    }

    // 3. Upgrades, paid in tokens.
    for (const p of plans) {
      const a = agents.get(p.agent);
      if (!a.lot || !a.upgrade || lotById.get(a.lot).tier === 'S') continue;
      const level = a.upgrades[a.upgrade];
      if (level >= UPGRADE_COST.length) continue;
      if (!spend(a, 'upgrades', UPGRADE_COST[level])) { say(day, a.agent, `代币不够，${UPGRADES[a.upgrade].zh}没做成`, { kind: 'short' }); continue; }
      a.upgrades[a.upgrade] = level + 1;
      if (a.upgrade === 'decor') a.rep = clamp(a.rep + UPGRADES.decor.effect, 0.6, repCap(a));
      say(day, a.agent, `升级${UPGRADES[a.upgrade].zh}到 ${level + 1} 级（${UPGRADE_COST[level].toLocaleString('en-US')} 代币）`, { kind: 'upgrade' });
      a.upgrade = null;
    }

    // 4. Stock for today, bought with city coins before the doors open.
    for (const a of agents.values()) {
      a.today = { event: ev.id, customers: 0, served: 0, revenue: 0, cost: 0, rent: 0, ad: 0, waste: 0 };
      if (!a.lot) continue;
      const cat = CATS[lotById.get(a.lot).cat];
      const unit = cat.cost * (ev.cost ?? 1);
      const want = seen.has(a.agent) ? Math.max(0, a.stock - (cat.perishable ? 0 : a.inventory)) : 0;
      const units = Math.max(0, Math.min(want, Math.floor(a.cash / unit)));
      a.cash -= round(units * unit);
      a.today.cost = round(units * unit);
      a.inventory = (cat.perishable ? 0 : a.inventory) + units;
    }

    // 5. Customers, trade by trade.
    for (const catId of Object.keys(CATS)) {
      const open = [...agents.values()].filter((a) => a.lot && lotById.get(a.lot).cat === catId);
      if (!open.length) continue;
      const cat = CATS[catId];
      const demand = cat.base * (ev.mult[catId] ?? 1) * Math.sqrt(open.length);
      const attract = open.map((a) => {
        const lot = lotById.get(a.lot);
        const level = PRICE_LEVELS[a.price];
        const awareness = 1 + a.boost + UPGRADES.signage.effect * a.upgrades.signage;
        const hours = 1 + UPGRADES.hours.effect * a.upgrades.hours;
        return TIERS[lot.tier].traffic * awareness * hours * a.rep * (1 / level) ** cat.elastic * (a.promo ? 1.25 : 1);
      });
      const total = attract.reduce((s, x) => s + x, 0) + OUTSIDE;
      open.forEach((a, i) => { a.today.customers = round(demand * attract[i] / total); });
    }
    // Co-branding: each partner sends a share of its customers over.
    for (const a of agents.values()) {
      for (const b of a.cobrands) {
        const partner = agents.get(b);
        if (a.lot && partner?.lot) a.today.extra = (a.today.extra ?? 0) + round(partner.today.customers * COBRAND_SHARE);
      }
    }
    for (const a of agents.values()) {
      if (!a.lot) continue;
      const lot = lotById.get(a.lot), cat = CATS[lot.cat];
      const customers = a.today.customers + (a.today.extra ?? 0);
      a.today.customers = customers;
      const served = Math.min(customers, a.inventory);
      const price = cat.ref * PRICE_LEVELS[a.price] * (a.promo ? 0.85 : 1);
      a.today.served = served;
      a.today.revenue = round(served * price);
      a.cash += a.today.revenue;
      a.inventory -= served;
      a.servedTotal += served;
      a.lastCat = lot.cat;
      if (cat.perishable) { a.today.waste = a.inventory; a.inventory = 0; }
      const fill = customers ? served / customers : 1;
      a.rep = clamp(a.rep + 0.1 * (fill - 0.92) - 0.03 * (PRICE_LEVELS[a.price] - 1), 0.6, repCap(a));
      a.days++;
    }

    // 6. Daily operating rent in city coins; a shop that cannot pay is evicted (its token lease is lost).
    for (const a of agents.values()) {
      if (!a.lot) continue;
      a.today.rent = a.rent;
      a.cash -= a.rent;
      if (a.cash < 0) {
        say(day, a.agent, '付不起日常租金，店面被收回', { kind: 'evicted', lot: a.lot });
        lotOwner.delete(a.lot);
        a.lot = null; a.rent = 0; a.inventory = 0; a.evicted++;
        a.cash = Math.max(a.cash, 0);
      }
    }

    // 7. Loans that fall due today (city coins).
    for (const l of loans) {
      if (l.paid || l.due !== day) continue;
      const borrower = agents.get(l.to), lender = agents.get(l.from);
      const owe = round(l.amount * (1 + l.rate));
      const pay = Math.min(owe, Math.max(0, borrower.cash));
      borrower.cash -= pay; lender.cash += pay; l.paid = true;
      if (pay < owe) {
        borrower.defaults++;
        say(day, borrower.agent, `借款违约，欠 ${lender.name} ${owe - pay}`, { kind: 'default', with: lender.agent });
      } else say(day, borrower.agent, `按时还款 ${owe} 给 ${lender.name}`, { kind: 'repaid', with: lender.agent });
    }

    // 8. Screen auction in tokens: today's highest bid per screen shows tomorrow and lifts that shop's awareness.
    for (const a of agents.values()) a.boost *= 0.5;
    for (const s of screens) { s.ad = null; s.owner = null; s.paid = 0; }
    const won = new Set();
    for (const s of screens) {
      const reserve = SCREEN_RESERVE[s.tier];
      const best = bids.filter((b) => b.screen === s.id && !won.has(b.agent.agent) && b.bid >= reserve && b.bid <= b.agent.tokens)
        .reduce((x, b) => (!x || b.bid > x.bid ? b : x), null);
      if (!best) continue;
      won.add(best.agent.agent);
      spend(best.agent, 'ads', best.bid);
      best.agent.today.ad = best.bid;
      best.agent.boost += SCREEN_BOOST[s.tier];
      best.agent.screenScore += SCREEN_WEIGHT[s.tier];
      Object.assign(s, { ad: best.ad, owner: best.agent.agent, paid: best.bid });
      say(day, best.agent.agent, `${best.bid.toLocaleString('en-US')} 代币拿下${s.tier === 'main' ? '主屏' : s.tier === 'street' ? '沿街大屏' : '侧屏'}：「${best.ad.title}」`, { kind: 'screen', screen: s.id });
    }
    for (const a of agents.values()) a.history.push({ day, ...a.today, cash: a.cash, price: a.price, rep: +a.rep.toFixed(2) });
  }

  function repCap(a) { return 1.4 + UPGRADES.decor.effect * a.upgrades.decor; }
  function licenceFor(a, lot) { return lot.tier === 'S' || a.licensed ? 0 : TOKEN.licence; }
  function lease(a, lot, bid, day) {
    const licence = licenceFor(a, lot);
    if (!spend(a, 'licence', licence) || !spend(a, 'lease', bid)) return;
    if (licence) a.licensed = true;
    a.lot = lot.id; a.rent = TIERS[lot.tier].rent; a.inventory = 0;
    lotOwner.set(lot.id, a.agent);
    const paid = bid + licence;
    say(day, a.agent, paid ? `用 ${paid.toLocaleString('en-US')} 代币租下${CATS[lot.cat].zh}店面 ${lot.id}` : `免费摆摊：${lot.id}`, { kind: 'lease', lot: lot.id });
  }
  function settleOffer(o, taker, day) {
    const from = agents.get(o.from);
    if (o.kind === 'loan') {
      if (from.cash < o.amount) return;
      from.cash -= o.amount; taker.cash += o.amount;
      loans.push({ from: o.from, to: o.to, amount: o.amount, rate: o.rate, due: o.due, paid: false });
      say(day, taker.agent, `向 ${from.name} 借款 ${o.amount}（利率 ${Math.round(o.rate * 100)}%，第 ${o.due} 天还）`, { kind: 'loan', with: from.agent });
    } else if (o.kind === 'cobrand') {
      from.cobrands.add(taker.agent); taker.cobrands.add(from.agent);
      say(day, taker.agent, `和 ${from.name} 联名导流`, { kind: 'cobrand', with: from.agent });
    } else if (o.kind === 'sublet') {
      if (from.lot !== o.lot || taker.lot || taker.cash < o.price) return;
      taker.cash -= o.price; from.cash += o.price;
      taker.lot = o.lot; taker.rent = from.rent; taker.inventory = 0;
      lotOwner.set(o.lot, taker.agent);
      from.lot = null; from.rent = 0; from.inventory = 0;
      say(day, taker.agent, `以 ${o.price} 接手 ${from.name} 的店面`, { kind: 'sublet', with: from.agent, lot: o.lot });
    }
    o.done = true;
  }

  // Standings. Profit counts what is owed and owed to you; the season score blends profit, trade and
  // reputation so tokens buy position and attention, never the rank itself.
  const owed = new Map();
  for (const l of loans) if (!l.paid) {
    const v = round(l.amount * (1 + l.rate));
    owed.set(l.to, (owed.get(l.to) ?? 0) - v);
    owed.set(l.from, (owed.get(l.from) ?? 0) + v);
  }
  const list = [...agents.values()].map((a) => {
    const spent = Object.values(a.spent).reduce((s, x) => s + x, 0);
    return {
      agent: a.agent, name: a.name, lot: a.lot, cash: a.cash, profit: a.cash + (owed.get(a.agent) ?? 0) - START_CASH - a.defaults * DEFAULT_PENALTY,
      rep: +a.rep.toFixed(2), boost: +a.boost.toFixed(2), price: a.price, inventory: a.inventory, brand: a.brand, memo: a.memo,
      defaults: a.defaults, evicted: a.evicted, daysOpen: a.days, cobrands: [...a.cobrands], today: a.today, history: a.history,
      deposit: a.deposit, tokens: a.tokens, tokensSpent: spent, spent: { ...a.spent }, upgrades: { ...a.upgrades },
      servedTotal: a.servedTotal, screenScore: a.screenScore, cat: a.lastCat, score: 0, scoreParts: null, bestAd: false,
    };
  });
  const maxProfit = Math.max(0, ...list.map((s) => s.profit));
  const maxServed = new Map(), maxCatProfit = new Map();
  for (const s of list) if (s.cat) {
    maxServed.set(s.cat, Math.max(maxServed.get(s.cat) ?? 0, s.servedTotal));
    maxCatProfit.set(s.cat, Math.max(maxCatProfit.get(s.cat) ?? 0, s.profit));
  }
  // Profit counts half against the whole city and half against the same trade, so a souvenir shop and
  // a theatre can both win: theatres take more per head, coffee shops serve more heads.
  const rel = (v, max) => (max > 0 ? clamp((100 * v) / max, -50, 100) : 0);
  for (const s of list) {
    const profit = 0.5 * rel(s.profit, maxProfit) + 0.5 * rel(s.profit, s.cat ? maxCatProfit.get(s.cat) ?? 0 : 0);
    const traffic = s.cat && maxServed.get(s.cat) ? (100 * s.servedTotal) / maxServed.get(s.cat) : 0;
    const rep = clamp((100 * (s.rep - 0.6)) / 0.8, 0, 100);
    s.scoreParts = { profit: round(profit), traffic: round(traffic), rep: round(rep) };
    s.score = s.daysOpen ? round(0.5 * profit + 0.3 * traffic + 0.2 * rep) : 0;
  }
  const bestAd = list.filter((s) => s.screenScore > 0).sort((x, y) => y.screenScore - x.screenScore || y.spent.ads - x.spent.ads)[0];
  if (bestAd) bestAd.bestAd = true;
  list.sort((x, y) => y.score - x.score || y.profit - x.profit);

  const total = Object.values(tokens).reduce((s, x) => s + x, 0);
  const burned = Math.floor((total * TOKEN.burnBps) / 10000);
  const resolved = Math.min(days, DAYS);
  return {
    seed, day: resolved,
    event: resolved ? dayEvents[resolved - 1] : null,
    days: dayEvents,
    lots: lots.map((l) => ({ ...l, owner: lotOwner.get(l.id) ?? null, reserve: TIERS[l.tier].rent, leaseReserve: TIERS[l.tier].lease })),
    screens, standings: list, feed: feed.slice(-120),
    openOffers: offers.filter((o) => !o.done).map(({ done, ...o }) => o),
    tokens: { spent: tokens, total, burned, treasury: total - burned, deposits: list.reduce((s, x) => s + x.deposit, 0) },
  };
}

/** Qualified: open at least 5 days and no default. */
export const qualified = (s) => s.daysOpen >= 5 && s.defaults === 0;
