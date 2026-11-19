// The public Times Square Tycoon city: which season and day it is, and the city those days produced.
// Today the events come from the demo shopkeepers on a fast clock; on mainnet they come from the
// TimesSquareCity contract's events in chain order, through the same engine.
import { CATS, DAYS, EVENTS, SCREENS, SCREEN_RESERVE, TIERS, TOKEN, UPGRADES, UPGRADE_COST, eventFor, runSeason, sponsorFor } from './engine.mjs';
import { DISTRICTS, LOTS } from './lots.mjs';
import { DEMO_AGENTS, demoEvents, demoSponsors } from './demo.mjs';
import { chainSeed } from './chain.mjs';

/**
 * `chain` (optional, from watch.mjs): the live TimesSquareCity. Its clock replaces `dayMs`/`epoch`, its events
 * join the demo shopkeepers' (who make way for real Agents), and seasons use the contract's seed, so the city
 * shown here is exactly what the settlement replays.
 */
export function createTycoon({ now = () => Date.now(), dayMs = 4 * 60_000, epoch = Date.UTC(2026, 10, 19), source = 'demo', chain = null } = {}) {
  if (chain) { dayMs = chain.dayMs; epoch = chain.epoch; source = 'chain'; }
  const seasonMs = dayMs * (DAYS + 1); // seven trading days, then one day to settle
  const cache = new Map();
  const previous = new Map(); // finished season id -> summary
  function clock(t = now()) {
    const index = Math.floor((t - epoch) / seasonMs);
    const start = epoch + index * seasonMs;
    const elapsed = t - start;
    const resolved = Math.min(DAYS, Math.floor(elapsed / dayMs));
    const settling = elapsed >= DAYS * dayMs;
    return {
      id: index + 1, seed: chain ? chainSeed(chain.address, index + 1) : `${source}-season-${index + 1}`, start, resolved, settling,
      day: settling ? null : resolved + 1, days: DAYS, dayMs,
      dayEndsAt: settling ? start + seasonMs : start + (resolved + 1) * dayMs, endsAt: start + DAYS * dayMs, nextSeasonAt: start + seasonMs,
    };
  }
  function city(season) {
    const key = `${season.seed}:${season.resolved}:${chain?.revision() ?? 0}`;
    let c = cache.get(key);
    if (!c) {
      // Before day 1 is played its plans are already in (they were due at the season's start), so the
      // lease auction is settled and the city opens with its tenants.
      const opening = !season.settling && season.resolved === 0;
      const events = demoEvents(season.seed, LOTS, opening ? 1 : season.resolved, chain ? chain.events(season.id) : []);
      // Sponsorships already placed for today (settled before it started) and the open bids for tomorrow.
      const today = season.day ? (season.day > 1 ? demoSponsors(season.seed, season.day) : []) : [];
      const tomorrow = season.day && season.day < DAYS ? demoSponsors(season.seed, season.day + 1) : [];
      c = { ...runSeason({ seed: season.seed, lots: LOTS, events, days: season.resolved, opening }), events: [...events, ...today], tomorrow };
      cache.clear();
      cache.set(key, c);
    }
    return c;
  }
  /** The last finished season, in brief: what it burned and who led. */
  function lastSeason(season) {
    if (season.id <= 1) return null;
    const id = season.id - 1;
    if (!previous.has(id)) {
      const seed = chain ? chainSeed(chain.address, id) : `${source}-season-${id}`;
      const c = runSeason({ seed, lots: LOTS, events: demoEvents(seed, LOTS, DAYS, chain ? chain.events(id) : []), days: DAYS });
      previous.clear();
      previous.set(id, {
        id, burned: c.tokens.burned, total: c.tokens.total, treasury: c.tokens.treasury,
        sponsoredDays: c.days.filter((d) => d.sponsor).length,
        top: c.standings.slice(0, 3).map((s) => ({ name: s.name, brand: s.brand?.name ?? null, score: s.score, demo: s.agent.startsWith('demo:') })),
        bestAd: c.standings.find((s) => s.bestAd)?.brand?.name ?? null,
      });
    }
    return previous.get(id);
  }
  function snapshot() {
    const season = clock();
    const c = city(season);
    const today = season.day ? eventFor(season.seed, season.day, c.events) : null;
    const lead = season.day && season.day < DAYS ? sponsorFor(season.day + 1, c.tomorrow) : null;
    return {
      mode: source, now: now(), season,
      event: today, eventYesterday: c.event, days: c.days,
      sponsorship: season.day && season.day < DAYS ? {
        day: season.day + 1, reserve: TOKEN.sponsorReserve,
        bids: c.tomorrow.map(({ who, name, event, bid }) => ({ who, name, event, bid })).sort((a, b) => b.bid - a.bid),
        leader: lead ? { name: lead.name ?? lead.who, event: lead.event, bid: lead.bid } : null,
      } : null,
      tokenEconomy: { ...c.tokens, burnBps: TOKEN.burnBps, licence: TOKEN.licence, screenReserve: SCREEN_RESERVE, upgrades: UPGRADES, upgradeCost: UPGRADE_COST, symbol: process.env.TYCOON_TOKEN_SYMBOL || null },
      districts: DISTRICTS, cats: CATS, tiers: TIERS, events: EVENTS.map(({ id, zh, en }) => ({ id, zh, en })),
      lots: c.lots,
      screens: c.screens.map((s, i) => ({ ...s, tier: SCREENS[i].tier })),
      standings: c.standings.map(({ history, ...s }) => ({ ...s, demo: s.agent.startsWith('demo:'), history: history.map((h) => ({ day: h.day, revenue: h.revenue, customers: h.customers, served: h.served, cash: h.cash })) })),
      feed: c.feed.slice(-60).reverse(),
      demoAgents: DEMO_AGENTS.length,
      pool: chain?.pool() ? { ...chain.pool(), note: 'contract', contract: chain.address } : { bnbWei: null, note: 'not-launched' },
      lastSeason: lastSeason(season),
    };
  }
  return { snapshot, clock };
}
