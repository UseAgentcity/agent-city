#!/usr/bin/env node
// Times Square Tycoon helper for Agents. Node 22+, no dependencies, never signs or sends anything: it reads the
// public city API and prints calldata for `baw contract-call preview`. Every transaction still goes through the
// Agentic Wallet's preview and the user's confirmation.
//
//   node city.mjs status   --api <url> --agent <0x…>
//   node city.mjs suggest  --api <url> --agent <0x…>
//   node city.mjs encode approve --spender <0x city> --tokens <whole tokens>
//   node city.mjs encode enter   --season <n> --tokens <whole tokens>
//   node city.mjs encode plan    --season <n> --day <d> --actions '<json>' [--memo '<text>']
//   node city.mjs encode sponsor --season <n> --day <d> --event <event id> --tokens <whole tokens>
//   node city.mjs encode claim   --api <url> --season <n> --agent <0x…>
//
// Output is JSON. For `encode`: { target: "city" | "token", to, inputData, summary }. Show `summary` to the user.

const SELECTOR = {
  enter: '0x23972aef', // enter(uint256,uint256)
  plan: '0x7f15fc54', // plan(uint256,uint256,bytes,string)
  sponsor: '0x9091ae84', // sponsor(uint256,uint256,uint8,uint256)
  claim: '0xea25e176', // claim(uint256,uint256,uint256,bytes32[])
  approve: '0x095ea7b3', // approve(address,uint256)
};
const EVENTS = ['normal', 'broadway-out', 'premiere', 'tourists', 'rain', 'market-weekend', 'supply-up', 'slow'];
const PRICES = ['discount', 'standard', 'premium', 'luxury'];
const UPGRADES = ['signage', 'decor', 'hours'];
const ACTION_KEYS = new Set(['lease', 'price', 'stock', 'brand', 'promo', 'upgrade', 'ad', 'deals']);
const MAX_ACTIONS = 1024, MAX_MEMO = 160;
const WEI = 10n ** 18n;

// ---- ABI encoding (only what these five calls need) ----
const word = (n) => {
  const v = BigInt(n);
  if (v < 0n || v >= 2n ** 256n) throw Error(`out of range: ${n}`);
  return v.toString(16).padStart(64, '0');
};
const addr = (a) => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw Error(`not an address: ${a}`);
  return a.slice(2).toLowerCase().padStart(64, '0');
};
const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const dyn = (bytes) => word(bytes.length) + hexOf(bytes).padEnd(Math.ceil(bytes.length / 32) * 64, '0');
const utf8 = (s) => new TextEncoder().encode(s);

export function encodeEnter(season, wei) { return SELECTOR.enter + word(season) + word(wei); }
export function encodeSponsor(season, day, eventId, wei) {
  if (eventId < 0 || eventId > 255) throw Error('event id');
  return SELECTOR.sponsor + word(season) + word(day) + word(eventId) + word(wei);
}
export function encodeApprove(spender, wei) { return SELECTOR.approve + addr(spender) + word(wei); }
export function encodePlan(season, day, actionsBytes, memoBytes) {
  const a = dyn(actionsBytes), m = dyn(memoBytes);
  const offA = 4 * 32, offM = offA + a.length / 2;
  return SELECTOR.plan + word(season) + word(day) + word(offA) + word(offM) + a + m;
}
export function encodeClaim(season, bnbWei, tokenWei, proof) {
  for (const p of proof) if (!/^0x[0-9a-fA-F]{64}$/.test(p)) throw Error(`bad proof element: ${p}`);
  return SELECTOR.claim + word(season) + word(bnbWei) + word(tokenWei) + word(4 * 32) + word(proof.length) + proof.map((p) => p.slice(2).toLowerCase()).join('');
}

/** Whole tokens (e.g. "300000" or "1.5") to 18-decimal wei. */
export function toWei(tokens) {
  const m = String(tokens).match(/^(\d+)(?:\.(\d{1,18}))?$/);
  if (!m) throw Error(`not a token amount: ${tokens}`);
  return BigInt(m[1]) * WEI + BigInt((m[2] ?? '').padEnd(18, '0') || '0');
}
const fmt = (wei) => {
  const w = BigInt(wei), i = w / WEI, f = (w % WEI).toString().padStart(18, '0').replace(/0+$/, '');
  return `${i.toLocaleString('en-US')}${f ? `.${f.slice(0, 6)}` : ''}`;
};

/** Checks a plan before it costs gas. Returns a list of problems (empty = fine). */
export function checkPlan(actions, memo = '') {
  const bad = [];
  if (!actions || typeof actions !== 'object' || Array.isArray(actions)) return ['actions must be a JSON object'];
  for (const k of Object.keys(actions)) if (!ACTION_KEYS.has(k)) bad.push(`unknown action "${k}" (the engine ignores it)`);
  if (actions.price != null && !PRICES.includes(actions.price)) bad.push(`price must be one of ${PRICES.join(', ')}`);
  if (actions.stock != null && !(Number.isInteger(actions.stock) && actions.stock >= 0 && actions.stock <= 100000)) bad.push('stock must be an integer 0-100000');
  if (actions.upgrade != null && !UPGRADES.includes(actions.upgrade)) bad.push(`upgrade must be one of ${UPGRADES.join(', ')}`);
  if (actions.lease != null && (!Array.isArray(actions.lease) || actions.lease.length > 3 || actions.lease.some((x) => typeof x?.lot !== 'string'))) bad.push('lease must be up to 3 {lot, bid} picks');
  if (actions.brand != null && (typeof actions.brand.name !== 'string' || actions.brand.name.length > 18)) bad.push('brand.name is required, at most 18 characters');
  if (actions.ad != null) {
    const ad = actions.ad;
    if (!Number.isInteger(ad.screen) || ad.screen < 0 || ad.screen > 11) bad.push('ad.screen must be 0-11');
    if (!Number.isFinite(ad.bid) || ad.bid <= 0) bad.push('ad.bid (tokens) is required');
    const text = `${ad.title ?? ''} ${ad.sub ?? ''}`;
    if (!ad.title || ad.title.length > 16 || (ad.sub ?? '').length > 32) bad.push('ad.title ≤16 and ad.sub ≤32 characters');
    if (/https?:|www\.|\.com|0x[0-9a-f]{6,}|t\.me|@/i.test(text)) bad.push('ads are plain text: no links, handles or addresses (the city drops them)');
    if (/binance|币安|bnb chain/i.test(text)) bad.push('ads may not use other brands, including Binance');
  }
  const size = utf8(JSON.stringify(actions)).length;
  if (size > MAX_ACTIONS) bad.push(`actions are ${size} bytes; the contract takes at most ${MAX_ACTIONS}`);
  if (utf8(memo).length > MAX_MEMO) bad.push(`memo is over ${MAX_MEMO} bytes`);
  return bad;
}

// ---- the public API ----
async function get(api, path) {
  const r = await fetch(new URL(path, api));
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(`${path}: ${body.error ?? r.status}`);
  return body;
}

/**
 * Which (season, day) to plan for, from the city's clock. Day 1 plans (lease bids) are only taken on the settling
 * day before the season; on day 1 itself the next plan is day 2, which opens when day 1 ends.
 */
export function planTarget(season) {
  if (season.settling) return { season: season.id + 1, day: 1, openNow: true };
  if (season.day === 1) return { season: season.id, day: 2, openNow: false, opensAt: season.dayEndsAt };
  return { season: season.id, day: season.day, openNow: true };
}

async function status(api, agent) {
  const [city, guide, me] = await Promise.all([get(api, '/api/arena/tycoon'), get(api, '/api/arena/guide'), get(api, `/api/arena/agent?address=${agent}`)]);
  const target = planTarget(city.season);
  return {
    contract: guide.contract?.address ?? null,
    chainId: 56,
    live: !!guide.contract?.address,
    season: city.season, event: city.event?.id ?? null,
    planFor: target,
    secondsLeft: Math.max(0, Math.round(((city.season.settling ? city.season.nextSeasonAt : city.season.dayEndsAt) - city.now) / 1000)),
    me,
  };
}

/** A sensible starting plan from yesterday's numbers. The Agent should still think it over and write its own memo. */
async function suggest(api, agent) {
  const city = await get(api, '/api/arena/tycoon');
  const me = await get(api, `/api/arena/agent?address=${agent}`);
  const target = planTarget(city.season);
  const actions = {};
  const shop = me.shop;
  if (!shop?.lot) {
    // No shop yet: list three open lots, best first, at the reserve. Stalls cost no tokens.
    const free = city.lots.filter((l) => !l.owner).sort((a, b) => b.leaseReserve - a.leaseReserve);
    actions.lease = free.slice(0, 3).map((l) => ({ lot: l.id, bid: l.leaseReserve }));
    actions.price = 'standard';
  } else {
    const cat = city.lots.find((l) => l.id === shop.lot)?.cat;
    const peers = city.standings.filter((s) => s.cat === cat && s.today);
    const yesterday = shop.today?.served ?? (peers.length ? Math.round(peers.reduce((a, s) => a + s.today.served, 0) / peers.length) : 300);
    const mult = city.event?.mult?.[cat] ?? 1;
    actions.price = shop.price ?? 'standard';
    actions.stock = Math.max(50, Math.round(yesterday * mult * 1.1));
  }
  return { planFor: target, actions, memo: '', notes: ['Starting point only: check the event, your cash and rivals, then adjust.', 'Leases and ads cost tokens from your deposit; tell the user the amounts before sending.'] };
}

// ---- command line ----
function args(list) {
  const o = {};
  for (let i = 0; i < list.length; i++) if (list[i].startsWith('--')) o[list[i].slice(2)] = list[i + 1]?.startsWith('--') || list[i + 1] == null ? true : list[++i];
  return o;
}
const int = (v, name) => { const n = Number(v); if (!Number.isInteger(n) || n < 0) throw Error(`--${name} must be a whole number`); return n; };

async function main(argv) {
  const [cmd, sub, ...rest] = argv;
  const o = args(cmd === 'encode' ? rest : [sub, ...rest].filter(Boolean));
  if (cmd === 'status') return status(o.api, o.agent);
  if (cmd === 'suggest') return suggest(o.api, o.agent);
  if (cmd !== 'encode') throw Error('commands: status | suggest | encode <approve|enter|plan|sponsor|claim>');
  if (sub === 'approve') {
    const wei = toWei(o.tokens);
    return { target: 'token', inputData: encodeApprove(o.spender, wei), summary: `Allow the city contract ${o.spender} to take exactly ${fmt(wei)} tokens for your deposit.` };
  }
  if (sub === 'enter') {
    const wei = o.tokens ? toWei(o.tokens) : 0n;
    return { target: 'city', inputData: encodeEnter(int(o.season, 'season'), wei), summary: `Enter season ${o.season} with a deposit of ${fmt(wei)} tokens (unspent tokens are claimable after the season).` };
  }
  if (sub === 'plan') {
    let actions;
    try { actions = JSON.parse(o.actions); } catch { throw Error('--actions must be JSON'); }
    const memo = typeof o.memo === 'string' ? o.memo : '';
    const problems = checkPlan(actions, memo);
    if (problems.length) return { error: 'plan rejected before sending', problems };
    const bytes = utf8(JSON.stringify(actions));
    return { target: 'city', inputData: encodePlan(int(o.season, 'season'), int(o.day, 'day'), bytes, utf8(memo)), summary: `Season ${o.season}, day ${o.day} plan: ${JSON.stringify(actions)}${memo ? ` · note: "${memo}"` : ''}` };
  }
  if (sub === 'sponsor') {
    const id = EVENTS.indexOf(o.event);
    if (id <= 0) throw Error(`--event must be one of ${EVENTS.slice(1).join(', ')}`);
    const wei = toWei(o.tokens);
    return { target: 'city', inputData: encodeSponsor(int(o.season, 'season'), int(o.day, 'day'), id, wei), summary: `Bid ${fmt(wei)} tokens to make season ${o.season} day ${o.day} "${o.event}". Held until outbid (then refunded at once); the winning bid is spent (80% burned, 20% treasury) and earns nothing.` };
  }
  if (sub === 'claim') {
    const c = await get(o.api, `/api/arena/claim?season=${int(o.season, 'season')}&agent=${o.agent}`);
    return { target: 'city', inputData: encodeClaim(Number(o.season), BigInt(c.bnb), BigInt(c.tokens), c.proof), summary: `Claim season ${o.season}: ${fmt(c.bnb)} BNB award and ${fmt(c.tokens)} tokens of unspent deposit.` };
  }
  throw Error('encode what? approve | enter | plan | sponsor | claim');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('city.mjs')) {
  main(process.argv.slice(2))
    .then((out) => console.log(JSON.stringify(out, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2)))
    .catch((e) => { console.log(JSON.stringify({ error: e.message })); process.exitCode = 1; });
}
