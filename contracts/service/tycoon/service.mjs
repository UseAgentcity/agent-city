// The public Times Square Tycoon city: which season and day it is, and the city those days produced.
// Today the events come from the demo shopkeepers on a fast clock; on mainnet they come from the
// TimesSquareCity contract's events in chain order, through the same engine.
import { CATS, DAYS, EVENTS, SCREENS, TIERS, eventOf, runSeason } from './engine.mjs';
import { DISTRICTS, LOTS } from './lots.mjs';
import { DEMO_AGENTS, demoEvents } from './demo.mjs';

export function createTycoon({ now = () => Date.now(), dayMs = 4 * 60_000, epoch = Date.UTC(2026, 10, 19), source = 'demo' } = {}) {
  const seasonMs = dayMs * (DAYS + 1); // seven trading days, then one day to settle
  const cache = new Map();
  function clock(t = now()) {
    const index = Math.floor((t - epoch) / seasonMs);
    const start = epoch + index * seasonMs;
    const elapsed = t - start;
    const resolved = Math.min(DAYS, Math.floor(elapsed / dayMs));
    const settling = elapsed >= DAYS * dayMs;
    return {
      id: index + 1, seed: `${source}-season-${index + 1}`, start, resolved, settling,
      day: settling ? null : resolved + 1, days: DAYS, dayMs,
      dayEndsAt: settling ? start + seasonMs : start + (resolved + 1) * dayMs, endsAt: start + DAYS * dayMs, nextSeasonAt: start + seasonMs,
    };
  }
  function city(season) {
    const key = `${season.seed}:${season.resolved}`;
    let c = cache.get(key);
    if (!c) {
      c = runSeason({ seed: season.seed, lots: LOTS, events: demoEvents(season.seed, LOTS, season.resolved), days: season.resolved });
      cache.clear();
      cache.set(key, c);
    }
    return c;
  }
  function snapshot() {
    const season = clock();
    const c = city(season);
    const today = season.day ? eventOf(season.seed, season.day) : null;
    return {
      mode: source, now: now(), season,
      event: today, eventYesterday: c.event,
      districts: DISTRICTS, cats: CATS, tiers: TIERS, events: EVENTS.map(({ id, zh, en }) => ({ id, zh, en })),
      lots: c.lots,
      screens: c.screens.map((s, i) => ({ ...s, tier: SCREENS[i].tier })),
      standings: c.standings.map(({ history, ...s }) => ({ ...s, demo: s.agent.startsWith('demo:'), history: history.map((h) => ({ day: h.day, revenue: h.revenue, customers: h.customers, served: h.served, cash: h.cash })) })),
      feed: c.feed.slice(-60).reverse(),
      demoAgents: DEMO_AGENTS.length,
      pool: { bnbWei: null, note: 'not-launched' },
    };
  }
  return { snapshot, clock };
}
