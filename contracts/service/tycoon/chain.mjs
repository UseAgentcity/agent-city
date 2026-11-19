// The bridge between TimesSquareCity on BNB Chain and the engine: chain logs in, engine events out; engine
// results in, a season settlement (awards, refunds, Merkle root and proofs) out. Anyone can run this against
// the public logs and check the operator's post. Token amounts on chain are 18-decimal wei; the engine counts
// whole tokens, and every refund is taken in wei so that spent + refunds equals the deposits exactly.
import { ethers } from 'ethers';
import { DAYS, EVENTS, qualified, runSeason } from './engine.mjs';
import { LOTS } from './lots.mjs';
import { demoEvents } from './demo.mjs';

export const CITY_ABI = [
  'event Entered(uint256 indexed season, address indexed agent, uint256 deposit)',
  'event Planned(uint256 indexed season, uint256 indexed day, address indexed agent, bytes actions, string memo)',
  'event Sponsored(uint256 indexed season, uint256 indexed day, address indexed who, uint8 eventId, uint256 bid)',
  'event Published(uint256 indexed season, bytes32 root, uint256 bnbTotal, uint256 tokensSpent, uint256 refunds, string resultUri)',
  'function enter(uint256 season, uint256 deposit)',
  'function plan(uint256 season, uint256 day, bytes actions, string memo)',
  'function sponsor(uint256 season, uint256 day, uint8 eventId, uint256 bid)',
  'function claim(uint256 season, uint256 bnb, uint256 tokens, bytes32[] proof)',
  'function clock() view returns (uint256 season, uint256 day)',
  'function seasonBudget() view returns (uint256)',
];
const city = new ethers.Interface(CITY_ABI);
const UNIT = 10n ** 18n;
const whole = (wei) => Number(BigInt(wei) / UNIT);
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The seed a chain season is played with: fixed by the contract address and the season number. */
export const chainSeed = (contract, season) => `city-${contract.toLowerCase()}-season-${season}`;

/**
 * Turns a season's raw logs (in block, then log-index order) into engine events. Plans whose JSON doesn't parse
 * become empty plans (the Agent still "showed up"); names are short addresses until a name service is wired in.
 * @param {{topics: string[], data: string}[]} logs  @param {number} season  @param {(addr: string) => string} [nameOf]
 */
export function eventsFromLogs(logs, season, nameOf = short) {
  const out = [];
  for (const log of logs) {
    let e;
    try { e = city.parseLog(log); } catch { continue; }
    if (!e || Number(e.args.season) !== season) continue;
    if (e.name === 'Entered') {
      const agent = e.args.agent.toLowerCase();
      out.push({ type: 'enter', agent, name: nameOf(agent), deposit: whole(e.args.deposit) });
    } else if (e.name === 'Planned') {
      let actions = {};
      try { actions = JSON.parse(ethers.toUtf8String(e.args.actions)); } catch { /* not JSON: an empty plan */ }
      if (!actions || typeof actions !== 'object' || Array.isArray(actions)) actions = {};
      out.push({ type: 'plan', agent: e.args.agent.toLowerCase(), day: Number(e.args.day), actions, memo: e.args.memo });
    } else if (e.name === 'Sponsored') {
      const ev = EVENTS[Number(e.args.eventId)];
      if (!ev) continue;
      const who = e.args.who.toLowerCase();
      out.push({ type: 'sponsor', who, name: nameOf(who), day: Number(e.args.day), event: ev.id, bid: whole(e.args.bid) });
    }
  }
  return out;
}

/**
 * A whole chain season as the city plays it: the contract's events alongside the demo shopkeepers (who make way
 * for real Agents), on the contract's seed. The API, the settlement and anyone checking it all run this.
 */
export const replaySeason = (contract, season, chainEvents, days = DAYS) => {
  const seed = chainSeed(contract, season);
  return runSeason({ seed, lots: LOTS, events: demoEvents(seed, LOTS, days, chainEvents), days });
};

/** Exact on-chain deposits per agent (wei), from a season's Entered logs. */
export function depositsFromLogs(logs, season) {
  const out = {};
  for (const log of logs) {
    let e;
    try { e = city.parseLog(log); } catch { continue; }
    if (e?.name === 'Entered' && Number(e.args.season) === season) out[e.args.agent.toLowerCase()] = e.args.deposit.toString();
  }
  return out;
}

/** UTF-8 JSON plan bytes for `plan()`: what an Agent (or its skill) sends. */
export const encodePlan = (actions) => ethers.toUtf8Bytes(JSON.stringify(actions));

// ---- Merkle tree: sorted pairs, double-hashed leaves (matches TimesSquareCity._verify and OpenZeppelin) ----
export const leafOf = (season, agent, bnb, tokens) =>
  ethers.keccak256(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'address', 'uint256', 'uint256'], [season, agent, bnb, tokens])));
const pair = (a, b) => (BigInt(a) < BigInt(b) ? ethers.keccak256(ethers.concat([a, b])) : ethers.keccak256(ethers.concat([b, a])));

function tree(leaves) {
  const layers = [leaves.slice().sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))];
  while (layers.at(-1).length > 1) {
    const prev = layers.at(-1), next = [];
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? pair(prev[i], prev[i + 1]) : prev[i]);
    layers.push(next);
  }
  const proof = (leaf) => {
    const path = [];
    let i = layers[0].indexOf(leaf);
    for (let l = 0; l < layers.length - 1; l++) {
      const sib = i ^ 1;
      if (sib < layers[l].length) path.push(layers[l][sib]);
      i >>= 1;
    }
    return path;
  };
  return { root: layers.at(-1)[0], proof };
}

/** Award weights: the best-ad shop takes 5%; each league's share goes to its winners by rank, linearly decreasing. */
export const BEST_AD_BPS = 500n;
/**
 * Two leagues, so free carts and stalls never crowd paid storefronts out of the awards (or the other way round):
 * each pays its own top 30% from its own share of the season budget.
 */
export const LEAGUES = {
  storefront: { bps: 6500n, max: 20 },
  street: { bps: 3000n, max: 10 }, // market stalls and street carts
};
export const leagueOf = (s) => (s.cat === 'cart' || s.cat === 'stall' ? 'street' : 'storefront');

/**
 * Settles a played season. `city` is runSeason(...) for all 7 days of the chain events; `depositsWei` maps each
 * agent (lower-case) to its exact on-chain deposit; `budgetWei` is the contract's seasonBudget() at posting time.
 * Returns what `publish` takes, plus every Agent's claim and proof.
 */
export function settleSeason(city, { season, budgetWei, depositsWei }) {
  const budget = BigInt(budgetWei);
  // The city's demo shopkeepers keep the streets alive but never take a share: only real Agent ID wallets do.
  const real = (s) => /^0x[0-9a-f]{40}$/.test(s.agent);
  const bnb = new Map();
  const add = (agent, wei) => bnb.set(agent, (bnb.get(agent) ?? 0n) + wei);
  const bestAd = city.standings.find((s) => s.bestAd && real(s) && qualified(s));
  if (bestAd) add(bestAd.agent, (budget * BEST_AD_BPS) / 10_000n);
  for (const [league, { bps, max }] of Object.entries(LEAGUES)) {
    const ranked = city.standings.filter((s) => real(s) && qualified(s) && s.score > 0 && leagueOf(s) === league).sort((a, b) => b.score - a.score);
    const n = Math.min(max, Math.max(ranked.length ? 1 : 0, Math.ceil(ranked.length * 0.3)));
    const share = (budget * bps) / 10_000n;
    const weights = ranked.slice(0, n).map((_, i) => BigInt(n - i));
    const sum = weights.reduce((a, b) => a + b, 0n);
    ranked.slice(0, n).forEach((s, i) => add(s.agent, sum ? (share * weights[i]) / sum : 0n));
  }

  let tokensSpent = 0n, refunds = 0n;
  const claims = [];
  const agents = new Set([...Object.keys(depositsWei), ...bnb.keys()]);
  for (const agent of agents) {
    const deposit = BigInt(depositsWei[agent] ?? 0);
    const s = city.standings.find((x) => x.agent === agent);
    const spentWei = BigInt(s?.tokensSpent ?? 0) * UNIT;
    if (spentWei > deposit) throw Error(`engine spent more than ${agent} deposited`);
    const refund = deposit - spentWei;
    tokensSpent += spentWei;
    refunds += refund;
    const award = bnb.get(agent) ?? 0n;
    if (award > 0n || refund > 0n) claims.push({ agent, bnb: award, tokens: refund, leaf: leafOf(season, agent, award, refund) });
  }
  const bnbTotal = claims.reduce((a, c) => a + c.bnb, 0n);
  if (bnbTotal > budget) throw Error('awards exceed the budget');
  if (!claims.length) return { root: null, bnbTotal: 0n, tokensSpent, refunds, claims };
  const t = tree(claims.map((c) => c.leaf));
  for (const c of claims) c.proof = t.proof(c.leaf);
  return { root: t.root, bnbTotal, tokensSpent, refunds, claims };
}
