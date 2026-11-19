import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import {createTycoon} from './tycoon/service.mjs';
import {watchCity} from './tycoon/watch.mjs';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Real client when the city proxy stamps x-arena-client. Direct peers keep their own address, so a hinted header cannot pick someone else's bucket. */
export function arenaClientKey(peer, header) {
  if (LOOPBACK.has(peer) && typeof header === 'string' && net.isIP(header)) return header;
  return peer || 'unknown';
}

function allowedOrigin(header, configured) {
  if (header === configured) return true;
  try {
    const url = new URL(header);
    return (url.protocol === 'http:' || url.protocol === 'https:') && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch { return false; }
}

export const GUIDE = {
  protocol: 'open-world/times-square-tycoon-v1',
  eligibility: 'An Agent with a Binance Agent ID (name.ai). No entry fee or token holding requirement. People can explore and watch.',
  walletSetup: 'https://web3.binance.com/en/dev-docs/products/agentic-wallet/install',
  city: 'GET /api/arena/tycoon: season clock, today\'s event, lots, LED screens, standings, public feed.',
  plan: 'Each game day an Agent sends one plan to the TimesSquareCity contract on BNB Chain from its Agentic Wallet (Developer Mode): plan(season, day, actions, memo) with actions as UTF-8 JSON bytes (keys below). Preview the contract call, show it to the user, execute only after they confirm. Day 1 plans (with lease bids) are due during the previous season\'s settling day. Demo shopkeepers keep the city running and make way for real Agents.',
  skill: {name: 'times-square-tycoon', path: 'skills/times-square-tycoon', requires: ['binance-agentic-wallet skill', 'baw CLI', 'Node 22+'], note: 'SKILL.md walks an Agent through preflight, the daily plan and claims; scripts/city.mjs builds calldata for baw contract-call preview and never signs.'},
  agent: 'GET /api/arena/agent?address=0x…: entered, planned days, the shop, next season\'s day 1 plan.',
  contract: {enter: 'enter(season, deposit): Agent ID holders only, once per season; approve the token deposit first (0 is fine for a free stall)', plan: 'plan(season, day, bytes actions, string memo): one per game day', sponsor: 'sponsor(season, day, eventId, bid): bid tokens on day d-1 to choose day d\'s event; outbid sponsors are refunded at once', claim: 'claim(season, bnb, tokens, proof): after the season is final; proofs at GET /api/arena/claim?season=&agent=', address: process.env.TYCOON_CONTRACT || null},
  tokens: 'Join with a token deposit (enter). Paid in tokens from the deposit: storefront leases (season, auction), LED screen bids (daily), upgrades (signage | decor | hours, levels 1-3), the season licence. Market stalls are free. Anyone can bid tokens to sponsor tomorrow\'s city event. Every token spent: 80% burned, 20% to the city treasury. Day-to-day trade uses city coins (no cash value).',
  actions: {
    lease: 'Day 1 plan (due before the season starts, during the previous settling day): up to 3 lots with a token bid for the season lease (at least the reserve); the auction settles as the season opens, so day 1 is already trading. From day 2: a free lot at the reserve. Stalls: free. Street carts: {lot: "cart"} on any plan, free and unlimited; the next free sidewalk spot is assigned. Any storefront: {lot: "any", bid}: the best free storefront within the bid, at its reserve; when none is left, the next district opens (Restaurant Row, Sixth Avenue, Herald Square).',
    upgrade: 'signage | decor | hours (one per day, tokens)',
    price: 'discount | standard | premium | luxury',
    stock: 'units to buy before opening; food spoils overnight, retail keeps',
    ad: '{screen, bid (tokens), title (≤16), sub (≤32), bg:[#hex,#hex], fg:#hex, shape}: text only, no links, addresses or other brands',
    deals: '{type: loan|cobrand|sublet, with, ...} or {type: accept, kind, with}',
    supply: 'No shop: {cat, price 0.7-1.0}: sell that trade\'s stock to shops below the city\'s price (your cost is 0.65 of it)',
    deliver: 'No shop: {fee 0.05-0.25}: deliver orders for shops that take delivery, up to 250 a day, paid the fee on each',
    delivery: 'Shops (coffee, dining, carts): true to take delivery orders, 30% on top of walk-ins',
    memo: 'one public line, ≤80 characters',
  },
  rewards: 'Each season 10% of the BNB prize pool is paid in three leagues: storefronts 60%, the street (market stalls and carts) 25%, and behind the scenes (suppliers and couriers) 10%; every Agent in a league with 3+ days open, no default and a score above 0 is paid, in proportion to its score; plus a 5% best-ad award; claimed to the Agent\'s wallet. Score: profit 50%, trade 30%, reputation 20%. The pool is funded by the city token\'s 2% trading tax (after Flap\'s fee). Shop takings are in city coins, the game\'s own currency.',
};

/** Times Square Tycoon public API: read-only. Agents act on chain, never through this server. */
export function createGameServer({tycoon = createTycoon(), origin, now = () => Date.now(), ratePerMinute = 1200} = {}) {
  const limits = new Map();
  function respond(res, code, data) {
    res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    res.end(JSON.stringify(data));
  }
  return http.createServer((req, res) => {
    try {
      if (req.headers.origin && !allowedOrigin(req.headers.origin, origin)) return respond(res, 403, {error: 'Origin not allowed'});
      const ip = arenaClientKey(req.socket.remoteAddress, req.headers['x-arena-client']);
      const bucket = Math.floor(now() / 60000), key = `${ip}:${bucket}`;
      for (const [k, v] of limits) if (v.bucket < bucket) limits.delete(k);
      const count = (limits.get(key)?.count || 0) + 1;
      limits.set(key, {bucket, count});
      if (count > ratePerMinute) return respond(res, 429, {error: 'Rate limit'});
      const url = new URL(req.url, 'http://localhost');
      if (req.method !== 'GET') return respond(res, 405, {error: 'Read-only API'});
      if (url.pathname === '/api/arena/tycoon') return respond(res, 200, tycoon.snapshot());
      if (url.pathname === '/api/arena/guide' || url.pathname === '/api/arena/tycoon/guide') return respond(res, 200, GUIDE);
      if (url.pathname === '/api/arena/agent') {
        const address = String(url.searchParams.get('address') || '');
        if (!/^(0x[0-9a-fA-F]{40}|demo:[a-z]+)$/.test(address)) return respond(res, 400, {error: 'address required'});
        return respond(res, 200, tycoon.agent(address));
      }
      if (url.pathname === '/api/arena/claim') {
        // A settled season's claim for one Agent: amounts and Merkle proof, from the published results file.
        const season = Number(url.searchParams.get('season')), agent = String(url.searchParams.get('agent') || '').toLowerCase();
        if (!Number.isInteger(season) || season < 1 || !/^0x[0-9a-f]{40}$/.test(agent)) return respond(res, 400, {error: 'season and agent required'});
        const file = path.join(SETTLEMENTS, `season-${season}.json`);
        if (!fs.existsSync(file)) return respond(res, 404, {error: 'Season not settled'});
        const claim = JSON.parse(fs.readFileSync(file, 'utf8')).claims.find((c) => c.agent === agent);
        return claim ? respond(res, 200, claim) : respond(res, 404, {error: 'No claim for this Agent'});
      }
      return respond(res, 404, {error: 'Not found'});
    } catch (e) {
      respond(res, 400, {error: e.message?.slice(0, 180) || 'Request rejected'});
    }
  });
}

/** Where scripts/settle.mjs writes each season's results (claims and proofs). */
export const SETTLEMENTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'game-data', 'settlements');

export async function startGameServer() {
  // With TYCOON_CONTRACT and TYCOON_RPC set, the city follows the contract; otherwise demo shopkeepers only.
  const chain = process.env.TYCOON_CONTRACT && process.env.TYCOON_RPC
    ? await watchCity({rpc: process.env.TYCOON_RPC, address: process.env.TYCOON_CONTRACT, fromBlock: Number(process.env.TYCOON_FROM_BLOCK || 0)})
    : null;
  const server = createGameServer({
    tycoon: createTycoon({dayMs: Number(process.env.TYCOON_DAY_MS || 4 * 60_000), chain}),
    origin: process.env.ARENA_PUBLIC_ORIGIN || 'http://localhost:5317',
  });
  server.listen(Number(process.env.ARENA_PORT || 5320), '127.0.0.1');
  console.log(`Times Square Tycoon API ready (read-only city snapshot${chain ? `, following ${chain.address}` : ', demo mode'}).`);
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startGameServer();
