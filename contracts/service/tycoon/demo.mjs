// Demo shopkeepers: a handful of reference Agents with different temperaments, so the city has life
// before real Agents arrive and the trial mode has opponents. They only ever produce ordinary plans —
// the same events a real Agent would send — and are always labelled as demo.
import { CATS, DAYS, EVENTS, PRICE_LEVELS, SCREENS, SCREEN_RESERVE, TIERS, TOKEN, UPGRADES, UPGRADE_COST, eventFor, rng, runSeason } from './engine.mjs';

const AD_COPY = {
  coffee: [['第一口就醒', '广场最快的一杯'], ['早安时代广场', '现磨咖啡 6 城市币起'], ['ESPRESSO RUSH', 'Two minutes from the bowtie']],
  gifts: [['把纽约带回家', '明信片 · 冰箱贴 · 帽子'], ['I ♥ MIDTOWN', 'Souvenirs on the square']],
  dining: [['今晚吃顿好的', '剧院散场后见'], ['MIDNIGHT TABLE', 'Open after the show']],
  apparel: [['街头就是秀场', '新款到店'], ['WEAR THE CITY', 'New drop this week']],
  theatre: [['今晚开演', 'TKTS 有折扣票'], ['CURTAIN UP', 'Tonight on Broadway']],
  bar: [['散场来一杯', 'Happy hour 到 9 点'], ['LAST CALL CLUB', 'After the curtain falls']],
  stall: [['热可可在这里', '布莱恩特公园集市'], ['WINTER MARKET', 'Handmade gifts & cocoa']],
};
const COLORS = [['#ff3d6e', '#7a1cff'], ['#0b0f2b', '#1e4dff'], ['#1b1405', '#f0b90b'], ['#0e1a12', '#1f8a4c'], ['#2a0a12', '#ff7a59'], ['#081a1f', '#2ee6c9']];

/** Reference temperaments. `bid` scales the lease bid over reserve; `ad` is the chance to bid for a screen. */
export const DEMO_AGENTS = [
  { agent: 'demo:nova', name: 'nova.demo', cat: 'coffee', bid: 1.35, price: 'standard', ad: 0.6, brand: ['NOVA BREW', '广场最快的一杯', '#ff7a59'] },
  { agent: 'demo:atlas', name: 'atlas.demo', cat: 'coffee', bid: 1.05, price: 'discount', ad: 0.15, brand: ['Atlas Coffee', '便宜大碗', '#2ee6c9'] },
  { agent: 'demo:lumi', name: 'lumi.demo', cat: 'gifts', bid: 1.25, price: 'premium', ad: 0.5, brand: ['LUMI GIFTS', '纽约的记忆', '#f0b90b'] },
  { agent: 'demo:pico', name: 'pico.demo', cat: 'gifts', bid: 1.0, price: 'standard', ad: 0.2, brand: ['Pico Shop', '一美元惊喜', '#7aa2ff'] },
  { agent: 'demo:sage', name: 'sage.demo', cat: 'dining', bid: 1.3, price: 'premium', ad: 0.45, brand: ['Sage Table', '散场后的晚餐', '#3ddc97'] },
  { agent: 'demo:rio', name: 'rio.demo', cat: 'dining', bid: 1.1, price: 'standard', ad: 0.25, brand: ['RIO GRILL', '24 小时烤肉', '#ff3d6e'] },
  { agent: 'demo:vega', name: 'vega.demo', cat: 'apparel', bid: 1.2, price: 'premium', ad: 0.55, brand: ['VEGA WEAR', '街头就是秀场', '#c084fc'] },
  { agent: 'demo:orion', name: 'orion.demo', cat: 'theatre', bid: 1.4, price: 'premium', ad: 0.7, brand: ['Orion Stage', '今晚开演', '#f6465d'] },
  { agent: 'demo:mira', name: 'mira.demo', cat: 'theatre', bid: 1.05, price: 'standard', ad: 0.3, brand: ['Mira Playhouse', '每晚都有新戏', '#f472b6'] },
  { agent: 'demo:juno', name: 'juno.demo', cat: 'bar', bid: 1.15, price: 'standard', ad: 0.35, brand: ['JUNO BAR', '散场来一杯', '#38bdf8'] },
  { agent: 'demo:kai', name: 'kai.demo', cat: 'bar', bid: 1.0, price: 'discount', ad: 0.1, brand: ['Kai Tavern', '啤酒买一送一', '#a3e635'] },
  { agent: 'demo:tess', name: 'tess.demo', cat: 'stall', bid: 1.0, price: 'standard', ad: 0.05, brand: ['Tess Cocoa', '热可可在这里', '#ffb291'] },
  { agent: 'demo:bo', name: 'bo.demo', cat: 'stall', bid: 1.0, price: 'premium', ad: 0.05, brand: ['Bo Crafts', '手作礼物', '#d08a4f'] },
  { agent: 'demo:ivy', name: 'ivy.demo', cat: 'coffee', bid: 1.15, price: 'standard', ad: 0.3, brand: ['Ivy Roasters', '慢一点的咖啡', '#3ddc97'] },
];

/** What a shopkeeper says: about today's event when it touches its trade, otherwise about its own shop. */
const EVENT_MEMOS = {
  rain: { up: ['下雨了，热饮要多备', '雨天反而忙，多进点货'], down: ['下雨没人逛，今天少进货', '雨天先保守一点'] },
  tourists: { up: ['游客潮来了，备货加三成', '游客多，今天要抢大屏'] },
  'broadway-out': { up: ['散场人潮要来了，晚上加人手', '剧院一散场就满座'] },
  premiere: { up: ['首演夜，价格往上调', '今晚全城都在看戏'] },
  'market-weekend': { up: ['集市周末，摊位要备足货', '周末人多，涨一点价'] },
  'supply-up': { all: ['进货涨价了，少进一点', '成本上来了，先提价'] },
  slow: { all: ['淡季，打折留住熟客', '人少，减少备货'] },
};
const CAT_MEMOS = {
  coffee: ['早上排队最长，咖啡豆要够', '第二杯半价，留住上班族', '换了新豆子，口碑要稳住'],
  gifts: ['明信片卖得最快', '帽子和冰箱贴补货了', '游客最爱自由女神小摆件'],
  dining: ['晚餐时段要提前备菜', '主厨推荐换了', '别让客人等太久'],
  apparel: ['新款到店，先卖精品价', '库存够，慢慢卖', '橱窗换了新陈列'],
  theatre: ['今晚的票还剩一些', '散场后和隔壁酒吧联名', '口碑比票价更重要'],
  bar: ['散场后才是我们的主场', '今晚 happy hour 到 9 点', '啤酒备足了'],
  stall: ['热可可快卖完了', '手作礼物每天只做这么多', '集市的灯串亮起来了'],
};

/** One demo Agent's plan for `day`, from what it can see of the city after the previous day. */
export function demoPlan(bot, day, city, seed, lots, events = []) {
  const r = rng(`${seed}:${bot.agent}:${day}`);
  const me = city.standings.find((s) => s.agent === bot.agent);
  const ev = eventFor(seed, day, events);
  const tokens = me?.tokens ?? depositOf(bot);
  const actions = {};
  if (day === 1 || !me?.lot) {
    const free = lots.filter((l) => !city.lots.find((x) => x.id === l.id)?.owner);
    const mine = free.filter((l) => l.cat === bot.cat).sort((a, b) => TIERS[b.tier].traffic - TIERS[a.tier].traffic);
    // Bid tokens for the season lease: temperament over the reserve, never more than the deposit allows.
    const affordable = (mine.length ? mine : free).filter((l) => TIERS[l.tier].lease + (l.tier === 'S' ? 0 : TOKEN.licence) <= tokens);
    const picks = affordable.slice(0, 3);
    actions.lease = picks.map((l) => ({ lot: l.id, bid: Math.min(Math.max(0, tokens - TOKEN.licence), Math.round(TIERS[l.tier].lease * (day === 1 ? bot.bid * (0.9 + r() * 0.25) : 1))) }));
    actions.brand = { name: bot.brand[0], slogan: bot.brand[1], color: bot.brand[2] };
  }
  const lot = lots.find((l) => l.id === (me?.lot ?? actions.lease?.[0]?.lot));
  const catId = lot?.cat ?? bot.cat;
  const cat = CATS[catId];
  const mult = ev.mult[catId] ?? 1;
  // Price: temperament, nudged by today's event and yesterday's queue.
  let level = me?.price ?? bot.price;
  const y = me?.today;
  if (y && y.customers > 0) {
    if (y.served >= y.customers && r() < 0.3) level = level === 'discount' ? 'standard' : level === 'standard' ? 'premium' : level;
    if (y.served < y.customers * 0.7 && r() < 0.3) level = 'premium';
  }
  if (mult >= 1.3 && level === 'standard' && r() < 0.5) level = 'premium';
  if (mult < 1 && r() < 0.5) level = 'discount';
  actions.price = level;
  // Stock: yesterday's customers (or a guess), scaled by today's event.
  const guess = cat.base * 2 * TIERS[lot?.tier ?? 'B'].traffic * 0.22;
  const last = y?.customers || guess;
  actions.stock = Math.round(last * mult * (1 / PRICE_LEVELS[level]) ** (cat.elastic * 0.6) * (0.95 + r() * 0.3));
  // Screen: the bold ones bid for tomorrow's screens.
  if (me?.lot && r() < bot.ad && tokens > SCREEN_RESERVE.side * 2) {
    const screen = SCREENS[Math.floor(r() ** 2 * SCREENS.length)];
    const copy = AD_COPY[catId][Math.floor(r() * AD_COPY[catId].length)];
    const colors = COLORS[Math.floor(r() * COLORS.length)];
    actions.ad = { screen: screen.id, bid: Math.round(SCREEN_RESERVE[screen.tier] * (1 + r() * 1.2)), title: copy[0], sub: copy[1], bg: colors, fg: '#ffffff', shape: ['circle', 'bars', 'stripes', 'stars'][Math.floor(r() * 4)] };
  }
  // Upgrades: the ambitious ones spend tokens on signage, then the interior, early in the season.
  if (me?.lot && lot?.tier !== 'S' && day >= 2 && day <= 4 && r() < bot.ad) {
    const kind = me.upgrades.signage <= me.upgrades.decor ? 'signage' : r() < 0.5 ? 'decor' : 'hours';
    if (UPGRADE_COST[me.upgrades[kind]] && UPGRADE_COST[me.upgrades[kind]] < tokens * 0.4) actions.upgrade = kind;
  }
  // Deals: theatre and bar/dining partners co-brand early in the season.
  const partners = { theatre: ['bar', 'dining'], bar: ['theatre'], dining: ['theatre'] }[catId];
  if (me?.lot && partners && day <= 3) {
    const partner = city.standings.find((s) => s.agent !== bot.agent && s.lot && partners.includes(lots.find((l) => l.id === s.lot)?.cat) && !me.cobrands.includes(s.agent));
    if (partner) {
      const theirs = city.openOffers.find((o) => o.kind === 'cobrand' && o.from === partner.agent && o.to === bot.agent);
      actions.deals = [theirs ? { type: 'accept', kind: 'cobrand', with: partner.agent } : { type: 'cobrand', with: partner.agent }];
    }
  }
  const em = EVENT_MEMOS[ev.id];
  const memos = em?.all ?? (mult > 1 ? em?.up : mult < 1 ? em?.down : null) ?? CAT_MEMOS[catId];
  return { type: 'plan', agent: bot.agent, day, actions, memo: memos[Math.floor(r() * memos.length)] };
}

/** Token deposit per temperament: bolder bidders bring more. */
export const depositOf = (bot) => (bot.cat === 'stall' ? 0 : Math.round((bot.bid * 500_000 + bot.ad * 500_000) / 10_000) * 10_000);

/** Demo spectators who sometimes sponsor tomorrow's city event with tokens (always labelled as demo). */
export const DEMO_SPONSORS = [
  { who: 'demo:fan-broadway', name: 'broadway_fan（演示）', likes: ['premiere', 'broadway-out'] },
  { who: 'demo:fan-market', name: 'market_lover（演示）', likes: ['market-weekend', 'tourists'] },
  { who: 'demo:fan-chaos', name: 'storm_chaser（演示）', likes: ['rain', 'supply-up'] },
];
export function demoSponsors(seed, day) {
  const out = [];
  for (const s of DEMO_SPONSORS) {
    const r = rng(`${seed}:${s.who}:${day}`);
    if (r() > 0.35) continue;
    const event = s.likes[Math.floor(r() * s.likes.length)];
    if (!EVENTS.some((e) => e.id === event)) continue;
    out.push({ type: 'sponsor', who: s.who, name: s.name, day, event, bid: Math.round(TOKEN.sponsorReserve * (1 + r() * 1.5) / 1000) * 1000 });
  }
  return out;
}

/** A whole season played by demo Agents (optionally alongside other events, e.g. a person's trial plans). */
export function demoEvents(seed, lots, upToDay = DAYS, extra = []) {
  const events = DEMO_AGENTS.map((b) => ({ type: 'enter', agent: b.agent, name: b.name, deposit: depositOf(b) }));
  events.push(...extra.filter((e) => e.type === 'enter'));
  for (let day = 1; day <= upToDay; day++) {
    // Sponsorships for a day are settled before the day starts.
    if (day > 1) events.push(...demoSponsors(seed, day));
    const city = runSeason({ seed, lots, events, days: day - 1 });
    for (const bot of DEMO_AGENTS) events.push(demoPlan(bot, day, city, seed, lots, events));
    events.push(...extra.filter((e) => (e.type === 'plan' || e.type === 'sponsor') && e.day === day));
  }
  return events;
}
