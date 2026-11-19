// Times Square Tycoon — the business engine. Deterministic and isomorphic (no Node-only imports), so the
// server, the replay tool and the in-browser trial all compute the same city from the same events.
//
// Input: the season seed and an ordered list of events (from the chain: block, then log index):
//   { type: 'enter', agent, name }
//   { type: 'plan', agent, day, actions, memo }
// Output: the city after `day` resolved days (lots, screens, agents, standings, feed).

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
/** Foot traffic multiplier and reserve daily rent per lot tier. */
export const TIERS = { A: { traffic: 1.6, rent: 2300 }, B: { traffic: 1.0, rent: 1600 }, C: { traffic: 0.6, rent: 900 }, S: { traffic: 0.5, rent: 350 } };
/** One public event per game day, drawn from the season seed. */
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
export const SCREEN_RESERVE = { main: 1500, street: 700, side: 300 };
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
export const eventOf = (seed, day) => EVENTS[hash32(`${seed}:event:${day}`) % EVENTS.length];

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
  const say = (day, agent, text, extra = {}) => feed.push({ day, agent, text, ...extra });

  for (const e of events) {
    if (e.type !== 'enter' || agents.has(e.agent)) continue;
    agents.set(e.agent, {
      agent: e.agent, name: e.name ?? e.agent, cash: START_CASH, lot: null, rent: 0, price: 'standard', stock: 0,
      inventory: 0, rep: 1, boost: 0, brand: null, memo: '', defaults: 0, evicted: 0, cobrands: new Set(),
      days: 0, history: [], today: null,
    });
  }
  const plansFor = (day) => events.filter((e) => e.type === 'plan' && e.day === day && agents.has(e.agent));

  for (let day = 1; day <= Math.min(days, DAYS); day++) {
    const ev = eventOf(seed, day);
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

    // 2. Leases. Day 1: sealed bids, best lots first. Later days: free lots at reserve, first come.
    if (day === 1) {
      const order = [...lots].sort((x, y) => TIERS[y.tier].traffic - TIERS[x.tier].traffic);
      for (const lot of order) {
        let best = null;
        for (const p of plans) {
          const a = agents.get(p.agent);
          if (a.lot) continue;
          const pick = a.lease.find((x) => x?.lot === lot.id);
          const bid = Math.floor(pick?.bid ?? 0);
          if (!pick || bid < TIERS[lot.tier].rent) continue;
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
          if (lot && !lotOwner.has(lot.id)) { lease(a, lot, TIERS[lot.tier].rent, day); break; }
        }
      }
    }

    // 3. Stock for today, bought before the doors open.
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

    // 4. Customers, trade by trade.
    for (const catId of Object.keys(CATS)) {
      const open = [...agents.values()].filter((a) => a.lot && lotById.get(a.lot).cat === catId);
      if (!open.length) continue;
      const cat = CATS[catId];
      const demand = cat.base * (ev.mult[catId] ?? 1) * Math.sqrt(open.length);
      const attract = open.map((a) => {
        const lot = lotById.get(a.lot);
        const level = PRICE_LEVELS[a.price];
        return TIERS[lot.tier].traffic * (1 + a.boost) * a.rep * (1 / level) ** cat.elastic * (a.promo ? 1.25 : 1);
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
      if (cat.perishable) { a.today.waste = a.inventory; a.inventory = 0; }
      const fill = customers ? served / customers : 1;
      a.rep = clamp(a.rep + 0.1 * (fill - 0.92) - 0.03 * (PRICE_LEVELS[a.price] - 1), 0.6, 1.4);
      a.days++;
    }

    // 5. Rent; a shop that cannot pay is evicted.
    for (const a of agents.values()) {
      if (!a.lot) continue;
      a.today.rent = a.rent;
      a.cash -= a.rent;
      if (a.cash < 0) {
        say(day, a.agent, '付不起租金，店面被收回', { kind: 'evicted', lot: a.lot });
        lotOwner.delete(a.lot);
        a.lot = null; a.rent = 0; a.inventory = 0; a.evicted++;
        a.cash = Math.max(a.cash, 0);
      }
    }

    // 6. Loans that fall due today.
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

    // 7. Screen auction: today's highest bid per screen shows tomorrow and lifts that shop's awareness.
    for (const a of agents.values()) a.boost *= 0.5;
    for (const s of screens) { s.ad = null; s.owner = null; s.paid = 0; }
    const won = new Set();
    for (const s of screens) {
      const reserve = SCREEN_RESERVE[s.tier];
      const best = bids.filter((b) => b.screen === s.id && !won.has(b.agent.agent) && b.bid >= reserve && b.bid <= b.agent.cash)
        .reduce((x, b) => (!x || b.bid > x.bid ? b : x), null);
      if (!best) continue;
      won.add(best.agent.agent);
      best.agent.cash -= best.bid;
      best.agent.today.ad = best.bid;
      best.agent.boost += SCREEN_BOOST[s.tier];
      Object.assign(s, { ad: best.ad, owner: best.agent.agent, paid: best.bid });
      say(day, best.agent.agent, `拿下 ${s.tier === 'main' ? '主屏' : s.tier === 'street' ? '沿街大屏' : '侧屏'}：「${best.ad.title}」`, { kind: 'screen', screen: s.id });
    }
    for (const a of agents.values()) a.history.push({ day, ...a.today, cash: a.cash, price: a.price, rep: +a.rep.toFixed(2) });
  }

  function lease(a, lot, rent, day) {
    a.lot = lot.id; a.rent = rent; a.inventory = 0;
    lotOwner.set(lot.id, a.agent);
    say(day, a.agent, `租下${CATS[lot.cat].zh}店面 ${lot.id}，日租 ${rent}`, { kind: 'lease', lot: lot.id });
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

  // Standings: profit counts what is owed and owed to you.
  const owed = new Map();
  for (const l of loans) if (!l.paid) {
    const v = round(l.amount * (1 + l.rate));
    owed.set(l.to, (owed.get(l.to) ?? 0) - v);
    owed.set(l.from, (owed.get(l.from) ?? 0) + v);
  }
  const list = [...agents.values()].map((a) => ({
    agent: a.agent, name: a.name, lot: a.lot, cash: a.cash, profit: a.cash + (owed.get(a.agent) ?? 0) - START_CASH - a.defaults * DEFAULT_PENALTY,
    rep: +a.rep.toFixed(2), boost: +a.boost.toFixed(2), price: a.price, inventory: a.inventory, brand: a.brand, memo: a.memo,
    defaults: a.defaults, evicted: a.evicted, daysOpen: a.days, cobrands: [...a.cobrands], today: a.today, history: a.history,
  })).sort((x, y) => y.profit - x.profit);
  const resolved = Math.min(days, DAYS);
  return {
    seed, day: resolved, event: resolved ? eventOf(seed, resolved) : null, nextEvent: resolved < DAYS ? eventOf(seed, resolved + 1) : null,
    lots: lots.map((l) => ({ ...l, owner: lotOwner.get(l.id) ?? null, reserve: TIERS[l.tier].rent })),
    screens, standings: list, feed: feed.slice(-120),
    openOffers: offers.filter((o) => !o.done).map(({ done, ...o }) => o),
  };
}

/** Qualified: open at least 5 days and no default. */
export const qualified = (s) => s.daysOpen >= 5 && s.defaults === 0;
