// The public Times Square Tycoon city: which season and day it is, and the city those days produced.
// Today the events come from the demo shopkeepers on a fast clock; on mainnet they come from the
// TimesSquareCity contract's events in chain order, through the same engine.
import { CATS, DAYS, EVENTS, SCREENS, SCREEN_RESERVE, TIERS, TOKEN, UPGRADES, UPGRADE_COST, eventFor, runSeason, sponsorFor } from './engine.mjs';
import { DISTRICTS, LOTS } from './lots.mjs';
import { DEMO_AGENTS, demoEvents, demoSponsors } from './demo.mjs';

export function createTycoon({ now = () => Date.now(), dayMs = 4 * 60_000, epoch = Date.UTC(2026, 10, 19), source = 'demo' } = {}) {
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
      id: index + 1, seed: `${source}-season-${index + 1}`, start, resolved, settling,
      day: settling ? null : resolved + 1, days: DAYS, dayMs,
      dayEndsAt: settling ? start + seasonMs : start + (resolved + 1) * dayMs, endsAt: start + DAYS * dayMs, nextSeasonAt: start + seasonMs,
    };
  }
  function city(season) {
    const key = `${season.seed}:${season.resolved}`;
    let c = cache.get(key);
    if (!c) {
      const events = demoEvents(season.seed, LOTS, season.resolved);
      // Sponsorships already placed for today (settled before it started) and the open bids for tomorrow.
      const today = season.day ? (season.day > 1 ? demoSponsors(season.seed, season.day) : []) : [];
      const tomorrow = season.day && season.day < DAYS ? demoSponsors(season.seed, season.day + 1) : [];
      c = { ...runSeason({ seed: season.seed, lots: LOTS, events, days: season.resolved }), events: [...events, ...today], tomorrow };
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
      const seed = `${source}-season-${id}`;
      const c = runSeason({ seed, lots: LOTS, events: demoEvents(seed, LOTS, DAYS), days: DAYS });
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
      pool: { bnbWei: null, note: 'not-launched' },
      lastSeason: lastSeason(season),
    };
  }
  return { snapshot, clock };
}
