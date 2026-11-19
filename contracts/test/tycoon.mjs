import assert from 'node:assert/strict';
import { DAYS, START_CASH, TIERS, cleanAd, runSeason } from '../service/tycoon/engine.mjs';
import { LOTS } from '../service/tycoon/lots.mjs';
import { demoEvents } from '../service/tycoon/demo.mjs';
import { createTycoon } from '../service/tycoon/service.mjs';

// Same events, same city: the server, a replay and the browser trial must agree.
const events = demoEvents('test-season', LOTS, DAYS);
const a = runSeason({ seed: 'test-season', lots: LOTS, events });
const b = runSeason({ seed: 'test-season', lots: LOTS, events: structuredClone(events) });
assert.deepEqual(a, b, 'deterministic');
assert.equal(a.day, DAYS);
assert.ok(a.lots.some((l) => l.owner), 'demo shopkeepers lease lots');
assert.ok(a.screens.some((s) => s.ad), 'someone wins a screen');

// Lease auction: the higher bid wins a lot; bids under reserve are ignored.
const lot = LOTS.find((l) => l.tier === 'A');
const auction = runSeason({ seed: 's', lots: LOTS, days: 1, events: [
  { type: 'enter', agent: 'x', name: 'x.ai' }, { type: 'enter', agent: 'y', name: 'y.ai' }, { type: 'enter', agent: 'z', name: 'z.ai' },
  { type: 'plan', agent: 'x', day: 1, actions: { lease: [{ lot: lot.id, bid: TIERS.A.rent + 100 }] } },
  { type: 'plan', agent: 'y', day: 1, actions: { lease: [{ lot: lot.id, bid: TIERS.A.rent + 500 }] } },
  { type: 'plan', agent: 'z', day: 1, actions: { lease: [{ lot: LOTS.find((l) => l.tier === 'C').id, bid: 10 }] } },
] });
assert.equal(auction.lots.find((l) => l.id === lot.id).owner, 'y', 'highest bid wins');
assert.equal(auction.standings.find((s) => s.agent === 'z').lot, null, 'below reserve is ignored');

// A shop that cannot pay its rent loses the lot.
const broke = runSeason({ seed: 's', lots: LOTS, days: 2, events: [
  { type: 'enter', agent: 'x', name: 'x.ai' },
  { type: 'plan', agent: 'x', day: 1, actions: { lease: [{ lot: lot.id, bid: START_CASH - 100 }], stock: 0 } },
] });
assert.equal(broke.standings[0].lot, null, 'evicted');
assert.equal(broke.standings[0].evicted, 1);

// Loans: a default is recorded against the borrower and costs points.
const loan = runSeason({ seed: 's', lots: LOTS, days: 3, events: [
  { type: 'enter', agent: 'lender', name: 'l.ai' }, { type: 'enter', agent: 'borrower', name: 'b.ai' },
  { type: 'plan', agent: 'lender', day: 1, actions: { deals: [{ type: 'loan', with: 'borrower', amount: 5000, rate: 0.1, due: 2 }] } },
  { type: 'plan', agent: 'borrower', day: 1, actions: { deals: [{ type: 'accept', kind: 'loan', with: 'lender' }], lease: [{ lot: lot.id, bid: START_CASH }] } },
] });
const borrower = loan.standings.find((s) => s.agent === 'borrower');
assert.equal(borrower.defaults, 1, 'could not repay after rent');
assert.ok(loan.feed.some((f) => f.kind === 'default'));

// Screen ads are plain text: no links, wallet addresses or other brands.
assert.ok(cleanAd({ title: '早安时代广场', sub: '现磨咖啡' }));
for (const bad of [{ title: 'visit www.x.com' }, { title: 'send to 0xabcdef123456' }, { title: 'Binance deal' }, { title: '' }]) assert.equal(cleanAd(bad), null);

// The public snapshot follows the clock: day 1 first, settling after day 7.
let t = Date.UTC(2026, 10, 19);
const city = createTycoon({ now: () => t, dayMs: 1000, epoch: t });
assert.equal(city.snapshot().season.day, 1);
t += 3500;
assert.equal(city.snapshot().season.day, 4);
assert.equal(city.snapshot().season.resolved, 3);
t += 4000;
assert.equal(city.snapshot().season.settling, true);
assert.ok(city.snapshot().standings.every((s) => !('wallet' in s)), 'no wallets in the public snapshot');

console.log('PASS: deterministic tycoon season, lease auction, eviction, loan default, ad filter, public clock');
