import assert from 'node:assert/strict';
import { DAYS, START_CASH, TIERS, TOKEN, UPGRADE_COST, cleanAd, eventFor, runSeason } from '../service/tycoon/engine.mjs';
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

// Lease auction in tokens: the higher bid wins; bids under the reserve, or beyond the deposit, are ignored.
const lot = LOTS.find((l) => l.tier === 'A');
const stall = LOTS.find((l) => l.tier === 'S');
const M = 1_000_000;
const auction = runSeason({ seed: 's', lots: LOTS, days: 1, events: [
  { type: 'enter', agent: 'x', name: 'x.ai', deposit: M }, { type: 'enter', agent: 'y', name: 'y.ai', deposit: M },
  { type: 'enter', agent: 'z', name: 'z.ai', deposit: M }, { type: 'enter', agent: 'w', name: 'w.ai', deposit: 100 },
  { type: 'enter', agent: 'free', name: 'free.ai', deposit: 0 },
  { type: 'plan', agent: 'x', day: 1, actions: { lease: [{ lot: lot.id, bid: TIERS.A.lease + 1000 }] } },
  { type: 'plan', agent: 'y', day: 1, actions: { lease: [{ lot: lot.id, bid: TIERS.A.lease + 5000 }] } },
  { type: 'plan', agent: 'z', day: 1, actions: { lease: [{ lot: LOTS.find((l) => l.tier === 'C').id, bid: 10 }] } },
  { type: 'plan', agent: 'w', day: 1, actions: { lease: [{ lot: LOTS.find((l) => l.tier === 'B').id, bid: TIERS.B.lease }] } },
  { type: 'plan', agent: 'free', day: 1, actions: { lease: [{ lot: stall.id, bid: 0 }] } },
] });
const by = (id) => auction.standings.find((s) => s.agent === id);
assert.equal(auction.lots.find((l) => l.id === lot.id).owner, 'y', 'highest bid wins');
assert.equal(by('y').tokens, M - TIERS.A.lease - 5000 - TOKEN.licence, 'the lease and the season licence come out of the deposit');
assert.equal(by('x').tokens, M, 'losing bids cost nothing');
assert.equal(by('z').lot, null, 'below reserve is ignored');
assert.equal(by('w').lot, null, 'a bid the deposit cannot cover is ignored');
assert.equal(by('free').lot, stall.id, 'market stalls need no tokens');
assert.equal(by('free').tokensSpent, 0);
// Every token spent is split 80% burned, 20% treasury.
assert.equal(auction.tokens.total, TIERS.A.lease + 5000 + TOKEN.licence);
assert.equal(auction.tokens.burned, Math.floor(auction.tokens.total * 0.8));
assert.equal(auction.tokens.treasury, auction.tokens.total - auction.tokens.burned);

// Upgrades cost tokens and rise with the level.
const up = runSeason({ seed: 's', lots: LOTS, days: 3, events: [
  { type: 'enter', agent: 'x', name: 'x.ai', deposit: M },
  { type: 'plan', agent: 'x', day: 1, actions: { lease: [{ lot: lot.id, bid: TIERS.A.lease }], stock: 500 } },
  { type: 'plan', agent: 'x', day: 2, actions: { upgrade: 'signage', stock: 500 } },
  { type: 'plan', agent: 'x', day: 3, actions: { upgrade: 'signage', stock: 500 } },
] });
assert.equal(up.standings[0].upgrades.signage, 2);
assert.equal(up.standings[0].spent.upgrades, UPGRADE_COST[0] + UPGRADE_COST[1]);

// Anyone can sponsor a day's event with tokens; the highest bid at or above the reserve sets it.
const sponsored = [
  { type: 'sponsor', who: 'p1', day: 2, event: 'rain', bid: TOKEN.sponsorReserve },
  { type: 'sponsor', who: 'p2', day: 2, event: 'premiere', bid: TOKEN.sponsorReserve + 1 },
  { type: 'sponsor', who: 'p3', day: 3, event: 'tourists', bid: TOKEN.sponsorReserve - 1 },
];
assert.equal(eventFor('s', 2, sponsored).id, 'premiere');
assert.equal(eventFor('s', 2, sponsored).sponsor.who, 'p2');
assert.equal(eventFor('s', 3, sponsored).sponsor, null, 'below the reserve does nothing');
const withSponsor = runSeason({ seed: 's', lots: LOTS, days: 2, events: [{ type: 'enter', agent: 'x', name: 'x.ai', deposit: 0 }, ...sponsored] });
assert.equal(withSponsor.days[1].id, 'premiere');
assert.equal(withSponsor.tokens.spent.sponsor, TOKEN.sponsorReserve + 1, 'only the winning sponsor pays');

// The season score blends profit, trade and reputation; standings follow it.
for (let i = 1; i < a.standings.length; i++) assert.ok(a.standings[i - 1].score >= a.standings[i].score);
assert.equal(a.standings.filter((s) => s.bestAd).length <= 1, true, 'one best-ad award');

// The daily operating rent is charged in city coins every day the shop is open.
const rented = runSeason({ seed: 's', lots: LOTS, days: DAYS, events: [
  { type: 'enter', agent: 'x', name: 'x.ai', deposit: M },
  { type: 'plan', agent: 'x', day: 1, actions: { lease: [{ lot: lot.id, bid: TIERS.A.lease }], stock: 0 } },
] });
assert.deepEqual(rented.standings[0].history.map((h) => h.rent), Array(DAYS).fill(TIERS.A.rent));
assert.equal(rented.standings[0].cash, START_CASH - DAYS * TIERS.A.rent, 'no stock, no takings: rent only');

// Loans: a default is recorded against the borrower and costs points.
const loan = runSeason({ seed: 's', lots: LOTS, days: 3, events: [
  { type: 'enter', agent: 'lender', name: 'l.ai', deposit: 0 }, { type: 'enter', agent: 'borrower', name: 'b.ai', deposit: M },
  { type: 'plan', agent: 'lender', day: 1, actions: { deals: [{ type: 'loan', with: 'borrower', amount: 5000, rate: 0.1, due: 2 }] } },
  { type: 'plan', agent: 'borrower', day: 1, actions: { deals: [{ type: 'accept', kind: 'loan', with: 'lender' }], lease: [{ lot: lot.id, bid: TIERS.A.lease }], stock: 20000 } },
] });
const borrower = loan.standings.find((s) => s.agent === 'borrower');
assert.equal(borrower.defaults, 1, 'could not repay after rent');
assert.ok(loan.feed.some((f) => f.kind === 'default'));

// Screen ads are plain text: no links, wallet addresses or other brands.
assert.ok(cleanAd({ title: '早安时代广场', sub: '现磨咖啡' }));
for (const bad of [{ title: 'visit www.x.com' }, { title: 'send to 0xabcdef123456' }, { title: 'Binance deal' }, { title: '' }]) assert.equal(cleanAd(bad), null);

// The season opens with its tenants: day 1's lease auction is settled before day 1 is played, and day 1
// then plays out on top of exactly those leases.
const opened = runSeason({ seed: 'test-season', lots: LOTS, events: demoEvents('test-season', LOTS, 1), days: 0, opening: true });
const day1 = runSeason({ seed: 'test-season', lots: LOTS, events: demoEvents('test-season', LOTS, 1), days: 1 });
assert.ok(opened.lots.some((l) => l.owner), 'shops open on day 1');
assert.deepEqual(opened.lots.map((l) => l.owner), day1.lots.map((l) => l.owner), 'same tenants as the full day 1');
assert.equal(opened.day, 0, 'no day played yet');
assert.ok(opened.standings.every((s) => !s.today), 'no trade before day 1 is played');

// The public snapshot follows the clock: day 1 first, settling after day 7.
let t = Date.UTC(2026, 10, 19);
const city = createTycoon({ now: () => t, dayMs: 1000, epoch: t });
assert.equal(city.snapshot().season.day, 1);
assert.ok(city.snapshot().lots.some((l) => l.owner), 'the snapshot opens the season with tenants');
t += 3500;
assert.equal(city.snapshot().season.day, 4);
assert.equal(city.snapshot().season.resolved, 3);
t += 4000;
assert.equal(city.snapshot().season.settling, true);
assert.ok(city.snapshot().standings.every((s) => !('wallet' in s)), 'no wallets in the public snapshot');

console.log('PASS: deterministic season, token lease auction and licence, opening auction, free stalls, 80/20 burn split, upgrades, event sponsorship, composite score, daily rent, loan default, ad filter, public clock');
