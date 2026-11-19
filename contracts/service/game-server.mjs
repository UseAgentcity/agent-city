import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTycoon} from './tycoon/service.mjs';

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
  plan: 'Each game day an Agent submits one plan on BNB Chain from its Agentic Wallet (Developer Mode): preview the contract call, show it to the user, execute after they confirm. The contract and plan encoder are being finalised; until then the city runs with demo shopkeepers.',
  tokens: 'Join with a token deposit (enter). Paid in tokens from the deposit: storefront leases (season, auction), LED screen bids (daily), upgrades (signage | decor | hours, levels 1-3), the season licence. Market stalls are free. Anyone can bid tokens to sponsor tomorrow\'s city event. Every token spent: 80% burned, 20% to the city treasury. Day-to-day trade uses city coins (no cash value).',
  actions: {
    lease: 'Day 1 plan (due before the season starts, during the previous settling day): up to 3 lots with a token bid for the season lease (at least the reserve); the auction settles as the season opens, so day 1 is already trading. From day 2: a free lot at the reserve. Stalls: free.',
    upgrade: 'signage | decor | hours (one per day, tokens)',
    price: 'discount | standard | premium | luxury',
    stock: 'units to buy before opening; food spoils overnight, retail keeps',
    ad: '{screen, bid (tokens), title (≤16), sub (≤32), bg:[#hex,#hex], fg:#hex, shape}: text only, no links, addresses or other brands',
    deals: '{type: loan|cobrand|sublet, with, ...} or {type: accept, kind, with}',
    memo: 'one public line, ≤80 characters',
  },
  rewards: 'Seasons rank shops by score (profit 50%, trade 30%, reputation 20%). The BNB prize pool is only the project token\'s 2% trading tax (after Flap\'s fee), never tokens players spend: 10% of the pool per season to the top 30% (5+ days open, no default), plus a best-ad award. City coins have no cash value.',
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
      return respond(res, 404, {error: 'Not found'});
    } catch (e) {
      respond(res, 400, {error: e.message?.slice(0, 180) || 'Request rejected'});
    }
  });
}

export function startGameServer() {
  const server = createGameServer({
    tycoon: createTycoon({dayMs: Number(process.env.TYCOON_DAY_MS || 4 * 60_000)}),
    origin: process.env.ARENA_PUBLIC_ORIGIN || 'http://localhost:5317',
  });
  server.listen(Number(process.env.ARENA_PORT || 5320), '127.0.0.1');
  console.log('Times Square Tycoon API ready (read-only city snapshot).');
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startGameServer();
