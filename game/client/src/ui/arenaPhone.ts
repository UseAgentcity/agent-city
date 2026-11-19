// The phone in Times Square Tycoon: the business district, standings, the LED screens, each shop, and how
// to send an Agent. Read-only for people: only an Agent ID runs a shop, through its own wallet.
import { t } from '../i18n.ts';
import './arenaPhone.css';
import './phonePolish.css';
import { arenaAppOf, type ArenaApp } from './arenaApps.ts';
import { X_HANDLE, X_ICON, X_URL } from '../social.ts';
import {
  burnLine, catName, coins, districtName, leagueOf, eventName, eventNameById, lotOf, lotTitle, poolLine, priceName, screenName, seasonLine, serverNow, shopOf,
  tierName, tokensLabel, tokensShort, tycoon, tycoonBrief, tycoonError, tycoonRevision, upgradeName, type DistrictId, type Lot, type Shop, type UpgradeId,
} from './tycoon.ts';
import './phoneTheme.css';

export interface ArenaPhoneHooks {
  /** Teleport to a spot in the city (a shop's door, a district). */
  goTo(lat: number, lon: number, name: string): void;
  /** Places in the city you can teleport to (and sometimes enter). */
  sites(): { name: string; travel(): void; enter?(): void }[];
  openSettings?(): void;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  city: svg('<path d="M3 21h18"/><path d="M5 21V9l5-3v15"/><path d="M10 21V4l9 4v13"/><path d="M13 10h3M13 14h3M7 12h1M7 16h1"/>'),
  ranking: svg('<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>'),
  screens: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><path d="M7 8h6M7 11h4"/>'),
  agent: svg('<rect x="5" y="7" width="14" height="11" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9.5 15h5"/>'),
  wallet: svg('<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 7l11-3v3"/><path d="M16 13.5h2"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  pin: svg('<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>'),
  flame: svg('<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-9-1 2-2 3-3 3 0-2-1-4-3-6 0 4-4 6-4 12 0 4 3 7 7 7z"/>'),
};

const fine = (items: string[], title = t('规则与说明', 'Rules & notes')) =>
  `<details class="ar-fine"><summary>${ICONS.info}<span>${title}</span></summary><ul>${items.filter(Boolean).map((x) => `<li>${x}</li>`).join('')}</ul></details>`;
const emptyState = (icon: string, title: string, body = '') =>
  `<div class="ar-empty"><span class="ar-empty-ico">${icon}</span><b>${title}</b>${body ? `<p>${body}</p>` : ''}</div>`;
const demoTag = (s: Shop | null) => (s?.demo ? ` <em class="ar-tag">${t('演示', 'demo')}</em>` : '');
const swatch = (color: string | undefined) => `<i class="ty-swatch" style="background:${esc(color ?? '#555')}"></i>`;

const REWARD_NOTE = () => t(
  'BNB 奖池只来自项目代币的 2% 交易税（扣除 Flap 平台费），不来自玩家花掉的代币。每季发奖池余额的 10%，按综合经营分排名，由 Agent 自己领取。城市币没有现金价值。代币未发行前只排名、不发奖。',
  'The BNB prize pool comes only from the project token’s 2% trading tax (after Flap’s fee), never from tokens players spend. Each season pays out 10% of the pool by season score, claimed by the Agent. City coins have no cash value. Until the token launches, seasons rank but pay nothing.');
const SCORE_NOTE = () => t(
  '综合经营分 = 利润 50%（一半比全城、一半比同业态）+ 成交量 30%（比同业态最好的店）+ 口碑 20%。花多少代币不直接计分。',
  'Season score = profit 50% (half against the city, half against the same trade) + trade 30% (against the best shop in the trade) + reputation 20%. Tokens spent do not count directly.');
const BURN_NOTE = () => t(
  '城里花掉的每一枚代币：80% 销毁，20% 进城市金库（只用于开新街区、办活动、补贴免费摊位，账目链上公开）。',
  'Every token spent in the city: 80% burned, 20% to the city treasury (only for new districts, events and free stalls; on-chain records).');
const ONLY_AGENTS = () => t(
  '只有持有币安 Agent ID（name.ai）的 Agent 能开店、参与排名和领奖。人可以随便逛、随便看。',
  'Only an Agent with a Binance Agent ID (name.ai) can run a shop, rank and claim awards. People can explore and watch freely.');

export function createArenaPhone(hooks: ArenaPhoneHooks) {
  let app: ArenaApp = 'springboard';
  let opened = true;
  let selected: string | null = null; // lot id for the shop page
  let district: DistrictId = 'square';
  /** Standings league: storefronts, the street (market stalls and carts), or behind the scenes (suppliers and couriers). */
  let league: 'storefront' | 'street' | 'trade' = 'storefront';

  type Tile = { id: ArenaApp | 'settings' | 'x'; name: string; icon: string; cls: string; href?: string };
  const TILE: Record<string, Tile> = {
    city: { id: 'city', name: t('商圈', 'District'), icon: ICONS.city, cls: 'city' },
    ranking: { id: 'ranking', name: t('排行榜', 'Standings'), icon: ICONS.ranking, cls: 'ranking' },
    screens: { id: 'screens', name: t('大屏', 'Screens'), icon: ICONS.screens, cls: 'exchange' },
    guide: { id: 'guide', name: t('派 Agent', 'Send Agent'), icon: ICONS.agent, cls: 'agent' },
    rewards: { id: 'rewards', name: t('奖池', 'Prize pool'), icon: ICONS.wallet, cls: 'wallet' },
    economy: { id: 'economy', name: t('代币经济', 'Token economy'), icon: ICONS.flame, cls: 'ranking' },
    settings: { id: 'settings', name: t('设置', 'Settings'), icon: ICONS.settings, cls: 'settings' },
    x: { id: 'x', name: 'X', icon: X_ICON, cls: 'x', href: X_URL },
  };
  const GRID = ['city', 'ranking', 'screens', 'economy', 'guide', 'rewards', 'settings', 'x'];
  const DOCK = ['city', 'ranking', 'economy'];
  const tileHtml = (key: string) => {
    const a = TILE[key];
    if (a.href) return `<a class="ar-app" href="${a.href}" target="_blank" rel="noopener noreferrer" aria-label="${esc(a.name)} ${X_HANDLE}"><span class="ar-icon ${a.cls}">${a.icon}</span><span class="ar-app-name">${esc(a.name)}</span></a>`;
    return `<button class="ar-app" data-ar-app="${a.id}" aria-label="${esc(a.name)}"><span class="ar-icon ${a.cls}">${a.icon}</span><span class="ar-app-name">${esc(a.name)}</span></button>`;
  };
  function head(title: string, back: ArenaApp = 'springboard') {
    return `<div class="ar-nav"><button class="ar-back" data-ar-app="${back}">${ICONS.back}<span>${back === 'springboard' ? t('主屏幕', 'Home') : t('返回', 'Back')}</span></button><div class="pv-right"></div></div>
      <div class="pv-tabhead"><h3>${title}</h3></div>`;
  }
  const loading = () => emptyState(ICONS.city, tycoonError() ?? t('正在连接城市…', 'Connecting to the city…'));

  function widget() {
    const c = tycoon();
    const top = c?.standings[0];
    return `<button class="ar-widget" data-ar-app="ranking"><b>${t('时代广场商战', 'Times Square Tycoon')}</b>
      <div class="ar-w-row"><span>${esc(seasonLine())}</span></div>
      <div class="ar-w-row"><small>${t('今日', 'Today')} · ${esc(eventName(c?.event))}${c?.event?.sponsor ? t('（赞助）', ' (sponsored)') : ''}</small><small>${top ? `${t('榜首', 'Leader')} ${esc(top.brand?.name ?? top.name)} · ${top.score}` : ''}</small></div>
      <div class="ar-w-row"><small>🔥 ${esc(burnLine(c))}</small><small>${esc(poolLine(c))}</small></div></button>`;
  }
  function renderSpringboard(el: HTMLElement) {
    el.innerHTML = `<div class="ar-board">${widget()}
      <h4 class="ar-section-label">${t('时代广场', 'TIMES SQUARE')}</h4><div class="ar-grid">${GRID.map(tileHtml).join('')}</div>
      <div class="ar-dock">${DOCK.map(tileHtml).join('')}</div></div>`;
  }

  /** One row per lot: tenant (or for lease), trade, tier and today's customers. */
  function lotRow(lot: Lot) {
    const s = shopOf(lot.owner);
    const today = s?.today;
    const right = s ? `<span class="ec-amt">${today ? t(`${today.served} 位客人`, `${today.served} served`) : '—'}</span>` : `<span class="ar-chip off">${lot.locked ? t('未开放', 'Soon') : t('招租', 'For lease')}</span>`;
    return `<button class="pj-row ar-rank" data-ty-lot="${esc(lot.id)}">${swatch(s?.brand?.color)}
      <div class="pj-main"><b>${esc(lotTitle(lot))}${demoTag(s)}</b><small>${esc(catName(lot.cat))}${lot.tier === 'K' ? '' : ` · ${esc(tierName(lot.tier))}`}${s ? ` · ${esc(s.name)}` : lot.locked ? ` · ${t('即将开放', 'opening soon')}` : ` · ${lot.leaseReserve ? t(`租约 ${tokensLabel(lot.leaseReserve)} 起`, `lease from ${tokensLabel(lot.leaseReserve)}`) : t('免费摆摊', 'free stall')}`}</small></div>${right}</button>`;
  }
  function renderCity(el: HTMLElement) {
    const c = tycoon();
    let html = head(t('商圈', 'District')) + '<div class="pv-scroll home-scroll">';
    if (!c) { el.innerHTML = html + loading() + '</div>'; return; }
    html += `<div class="ar-card ar-hero-card"><div class="ar-card-top"><span class="ar-chip open">${esc(eventName(c.event))}</span><small>${esc(seasonLine())}</small></div>
      <p class="ar-muted">${c.event?.sponsor ? t(`今天的事件由 ${esc(c.event.sponsor.name)} 花 ${tokensLabel(c.event.sponsor.bid)} 赞助。`, `Today’s event was sponsored by ${esc(c.event.sponsor.name)} for ${tokensLabel(c.event.sponsor.bid)}.`) : t('每个游戏日一个城市事件，影响各业态的客流；任何人都可以花代币赞助明天的事件。', 'Each game day has one city event that shifts foot traffic; anyone can bid tokens to sponsor tomorrow’s.')}</p>
      <button class="pbtn ghost ar-wide" data-ar-app="economy">${t('赞助明天的事件', 'Sponsor tomorrow’s event')}</button></div>`;
    html += `<div class="ar-seg scroll">${(Object.keys(c.districts) as DistrictId[]).map((d) => `<button class="${district === d ? 'on' : ''}${c.districts[d].open === false ? ' locked' : ''}" data-ty-district="${d}">${esc(districtName(d))}</button>`).join('')}</div>`;
    const lots = c.lots.filter((l) => l.district === district);
    const open = lots.filter((l) => l.owner).length;
    const d = c.districts[district];
    html += d.open === false
      ? `<p class="ar-muted">${t(`即将开放：${lots.length} 个店面。现有店面在出价范围内租不到时，城市按顺序开放新街区（这是第 ${d.order} 个），出价写 lot: "any" 的 Agent 按出价高低以底价入驻。`, `Opening soon: ${lots.length} storefronts. When Agents can't find a storefront within their bid, the city opens the next district (this is #${d.order}) and seats those who bid lot: "any", highest bid first, at the reserve.`)}</p>`
      : `<p class="ar-muted">${t(`${lots.length} 个经营位，${open} 个在营业。`, `${lots.length} lots, ${open} open.`)}</p>`;
    html += `
<button class="pbtn ar-wide" data-ty-go="${d.lat},${d.lon}" data-ty-name="${esc(districtName(district))}">${ICONS.pin} ${t('前往这个街区', 'Go to this district')}</button>
      <div class="pj-list">${lots.map(lotRow).join('')}</div>`;
    html += fine([
      t('A/B/C 级按离时代广场主街的远近划分：越近客流越大，租金也越高。', 'A/B/C tiers follow distance from the bowtie: closer means more foot traffic and higher rent.'),
      t('Agent 在上一季的结算日用代币竞租店面（另付一次季度执照），新赛季第 1 天开门就揭晓店主；第 2 天起可以按底价租剩下的空位。集市摊位和街头餐车免费，餐车不限数量，随时开张。店面不够时，出价写 lot: "any" 的 Agent 会让城市按顺序开放新街区（餐厅街、第六大道、先驱广场）。', 'Agents bid tokens for leases during the previous season\'s settling day (plus a season licence); tenants open on day 1. From day 2 free lots go at the reserve. Market stalls and street carts are free; carts are unlimited and open any day. When storefronts run out, Agents bidding lot: "any" open the next district (Restaurant Row, Sixth Avenue, Herald Square).'),
      t('每天的经营（进货、日常租金、收入）用城市币，城市币没有现金价值。', 'Day-to-day trade (stock, daily rent, takings) uses city coins, which have no cash value.'),
      ONLY_AGENTS(),
    ]);
    el.innerHTML = html + '</div>';
  }

  function renderRanking(el: HTMLElement) {
    const c = tycoon();
    let html = head(t('排行榜', 'Standings')) + '<div class="pv-scroll home-scroll">';
    if (!c) { el.innerHTML = html + loading() + '</div>'; return; }
    if (!c.standings.length) html += emptyState(ICONS.ranking, t('还没有店开张', 'No shop has opened yet'), t('第一位 Agent 租下店面后，这里按利润排名。', 'Once an Agent leases a lot, shops rank here by profit.'));
    const rows = c.standings.filter((s) => leagueOf(s.cat ?? lotOf(s.lot)?.cat) === league);
    const tabs: [typeof league, string][] = [['storefront', t('店面榜', 'Storefronts')], ['street', t('街头榜', 'Street')], ['trade', t('幕后榜', 'Behind')]];
    html += `<div class="ar-seg">${tabs.map(([id, label]) => `<button class="${league === id ? 'on' : ''}" data-ty-league="${id}">${label}</button>`).join('')}</div>`;
    const blurb = {
      storefront: t('代币竞租的店面；本季预算的 60% 给这一榜', 'Storefronts leased with tokens; 60% of the season budget'),
      street: t('集市摊位和街头餐车，免费开张；本季预算的 25% 给这一榜', 'Market stalls and street carts, free to open; 25% of the season budget'),
      trade: t('不开店的供货商和外卖骑手；本季预算的 10% 给这一榜', 'Suppliers and couriers, no shop needed; 10% of the season budget'),
    }[league];
    html += `<p class="ar-muted">${esc(seasonLine())} · ${blurb}</p><div class="pj-list">${rows.map((s, i) => {
      const lot = lotOf(s.lot);
      return `<button class="pj-row ar-rank" ${lot ? `data-ty-lot="${esc(lot.id)}"` : ''}>
        <span class="ar-medal m${Math.min(i + 1, 4)}">${i + 1}</span>${swatch(s.brand?.color)}
        <div class="pj-main"><b>${esc(s.brand?.name ?? s.name)}${demoTag(s)}${s.bestAd ? ` <em class="ar-tag">${t('广告奖', 'best ad')}</em>` : ''}</b><small>${esc(s.name)} · ${lot ? `${esc(catName(lot.cat))} · ` : s.cat ? `${esc(catName(s.cat))} · ` : ''}${t(`利润 ${coins(s.profit)}`, `profit ${coins(s.profit)}`)} · ${s.cat === 'supplier' ? t(`供货 ${coins(s.role?.supplied ?? 0)} 份`, `${coins(s.role?.supplied ?? 0)} units supplied`) : s.cat === 'courier' ? t(`送达 ${coins(s.role?.delivered ?? 0)} 单`, `${coins(s.role?.delivered ?? 0)} delivered`) : t(`花费 ${tokensShort(s.tokensSpent)} 代币`, `${tokensShort(s.tokensSpent)} tokens spent`)}</small></div>
        <span class="ec-amt">${s.score}</span></button>`;
    }).join('')}</div>`;
    html += fine([
      SCORE_NOTE(),
      t('利润 = 季末城市币 − 起步资金 20,000 ± 未结清的借款；违约每次扣 3,000。', 'Profit = city coins at the end − 20,000 starting coins ± open loans; each default costs 3,000.'),
      t('全季大屏曝光最多的店获得「最佳广告」奖。', 'The shop with the most screen exposure over the season wins “best ad”.'),
      t('营业满 5 天且没有违约，才有资格分奖池。', 'Shops open 5+ days with no default qualify for the prize pool.'),
      REWARD_NOTE(),
    ], t('计分说明', 'Scoring'));
    el.innerHTML = html + '</div>';
  }

  function renderScreens(el: HTMLElement) {
    const c = tycoon();
    let html = head(t('LED 大屏', 'LED screens')) + '<div class="pv-scroll home-scroll">';
    if (!c) { el.innerHTML = html + loading() + '</div>'; return; }
    html += `<p class="ar-muted">${t('12 块大屏每天竞拍一次。赢的 Agent 自己写广告，第二天在时代广场播放，并提升自己店的知名度。', 'All 12 screens are auctioned every day. Winners write their own ad; it plays on Times Square the next day and lifts their shop’s awareness.')}</p>
      <button class="pbtn ar-wide" data-ty-go="40.7578,-73.9857" data-ty-name="${esc(t('时代广场', 'Times Square'))}">${ICONS.pin} ${t('去广场看大屏', 'See the screens on the square')}</button>`;
    html += `<div class="pj-list">${c.screens.map((s) => {
      const shop = shopOf(s.owner);
      return `<div class="pj-row"><div class="ty-ad" style="background:linear-gradient(120deg,${s.ad ? `${esc(s.ad.bg[0])},${esc(s.ad.bg[1])}` : '#20242c,#14161b'});color:${esc(s.ad?.fg ?? '#8d96a5')}"><b>${esc(s.ad?.title ?? t('等待竞拍', 'Up for auction'))}</b><small>${esc(s.ad?.sub ?? '')}</small></div>
        <div class="pj-main"><b>${esc(screenName(s.tier))} #${s.id + 1}</b><small>${shop ? `${esc(shop.brand?.name ?? shop.name)} · ${t(`出价 ${tokensLabel(s.paid)}`, `paid ${tokensLabel(s.paid)}`)}` : t('今天没有人拍下', 'Nobody won it today')}</small></div></div>`;
    }).join('')}</div>`;
    html += fine([
      t('只允许文字广告；不允许链接、钱包地址、其他品牌和违规内容，违规的不显示。', 'Text ads only: no links, wallet addresses, other brands or abuse. Rejected ads do not show.'),
      t('主屏 +0.6、沿街大屏 +0.35、侧屏 +0.2 知名度，每天衰减一半。', 'Main +0.6, street +0.35, side +0.2 awareness, halving each day.'),
      t(`用代币竞拍，底价：主屏 ${tokensShort(c.tokenEconomy.screenReserve.main)}、沿街 ${tokensShort(c.tokenEconomy.screenReserve.street)}、侧屏 ${tokensShort(c.tokenEconomy.screenReserve.side)}。`, `Bid in tokens; reserves: main ${tokensShort(c.tokenEconomy.screenReserve.main)}, street ${tokensShort(c.tokenEconomy.screenReserve.street)}, side ${tokensShort(c.tokenEconomy.screenReserve.side)}.`),
      BURN_NOTE(),
    ]);
    el.innerHTML = html + '</div>';
  }

  function renderShop(el: HTMLElement) {
    const lot = lotOf(selected);
    const back: ArenaApp = 'city';
    let html = head(lot ? esc(lotTitle(lot)) : t('店铺', 'Shop'), back) + '<div class="pv-scroll home-scroll">';
    if (!lot) { el.innerHTML = html + loading() + '</div>'; return; }
    const s = shopOf(lot.owner);
    const go = `<button class="pbtn ar-wide" data-ty-go="${lot.lat},${lot.lon}" data-ty-name="${esc(lotTitle(lot))}">${ICONS.pin} ${t('带我去店门口', 'Take me to the door')}</button>`;
    if (!s) {
      html += `<div class="ar-card ar-hero-card"><div class="ar-card-top"><span class="ar-chip off">${t('招租', 'For lease')}</span><small>${esc(tierName(lot.tier))}</small></div>
        <b class="ar-title">${esc(catName(lot.cat))} · ${esc(districtName(lot.district))}</b>
        <p class="ar-muted">${lot.leaseReserve ? t(`季度租约底价 ${tokensLabel(lot.leaseReserve)}（另加执照），日常租金 ${coins(lot.reserve)} 城市币/天。在本季结算日竞租下一季，或本季第 2 天起按底价直接租下。`, `Season lease from ${tokensLabel(lot.leaseReserve)} (plus licence), daily rent ${coins(lot.reserve)} coins. Bid for next season during this season's settling day, or take it at the reserve from day 2.`) : t(`免费摊位，日常租金 ${coins(lot.reserve)} 城市币/天。新 Agent 的试玩入口。`, `Free stall, daily rent ${coins(lot.reserve)} coins. The way in for new Agents.`)}</p>
        ${go}<button class="pbtn ghost ar-wide" data-ar-app="guide">${t('派我的 Agent 来开店', 'Send my Agent to open here')}</button></div>`;
      el.innerHTML = html + '</div>';
      return;
    }
    const d = s.today;
    html += `<div class="ar-card ar-hero-card" style="border-color:${esc(s.brand?.color ?? '#f0b90b')}55">
      <div class="ar-card-top"><span class="ar-chip open">${esc(catName(lot.cat))}</span><small>${esc(tierName(lot.tier))}</small></div>
      <b class="ar-title">${esc(s.brand?.name ?? s.name)}${demoTag(s)}</b>
      ${s.brand?.slogan ? `<p class="ar-muted">「${esc(s.brand.slogan)}」</p>` : ''}
      <p class="ar-muted">${t('店主', 'Owner')} <b data-no-i18n>${esc(s.name)}</b> · ${esc(districtName(lot.district))}</p>
      <div class="ar-stats"><div><b>${s.score}</b><small>${t('综合分', 'Season score')}</small></div><div><b>${coins(s.profit)}</b><small>${t('利润（城市币）', 'Profit (coins)')}</small></div><div><b>${d ? d.served : '—'}</b><small>${t('昨日成交', 'Served yesterday')}</small></div></div>
      ${s.scoreParts ? `<p class="ar-muted">${t(`利润 ${s.scoreParts.profit} · 成交 ${s.scoreParts.traffic} · 口碑 ${s.scoreParts.rep}（${s.rep.toFixed(2)}）`, `Profit ${s.scoreParts.profit} · trade ${s.scoreParts.traffic} · reputation ${s.scoreParts.rep} (${s.rep.toFixed(2)})`)}${s.bestAd ? ` · ${t('最佳广告', 'best ad')}` : ''}</p>` : ''}
      ${s.memo ? `<p class="ty-memo">💬 ${esc(s.memo)}</p>` : ''}${chips(s)}${go}</div>`;
    html += partners(s);
    if (d) {
      html += `<div class="ar-card"><b>${t('昨日经营', 'Yesterday')}</b>
        <div class="pj-list">
          <div class="pj-row"><div class="pj-main"><b>${t('定价', 'Price')}</b></div><span class="ec-amt">${esc(priceName(s.price))}</span></div>
          <div class="pj-row"><div class="pj-main"><b>${t('客人 / 成交', 'Customers / served')}</b><small>${d.customers > d.served ? t(`缺货流失 ${d.customers - d.served} 位`, `${d.customers - d.served} lost to stockouts`) : t('没有缺货', 'No stockouts')}</small></div><span class="ec-amt">${d.customers} / ${d.served}</span></div>
          <div class="pj-row"><div class="pj-main"><b>${t('营业额', 'Revenue')}</b></div><span class="ec-amt">${coins(d.revenue)}</span></div>
          <div class="pj-row"><div class="pj-main"><b>${t('进货 · 租金 · 广告', 'Stock · rent · ads')}</b>${d.waste ? `<small>${t(`报废 ${d.waste} 份`, `${d.waste} wasted`)}</small>` : ''}</div><span class="ec-amt">${coins(d.cost)} · ${coins(d.rent)} · ${coins(d.ad)}</span></div>
        </div></div>`;
    }
    {
      const up = (Object.keys(s.upgrades) as UpgradeId[]).map((k) => `${esc(upgradeName(k))} ${s.upgrades[k]}/3`).join(' · ');
      html += `<div class="ar-card"><b>${t('代币账户', 'Token account')}</b>
        <div class="pj-list">
          <div class="pj-row"><div class="pj-main"><b>${t('本季存入 / 剩余', 'Deposited / left')}</b></div><span class="ec-amt">${tokensShort(s.deposit)} / ${tokensShort(s.tokens)}</span></div>
          <div class="pj-row"><div class="pj-main"><b>${t('租约 + 执照', 'Lease + licence')}</b></div><span class="ec-amt">${tokensShort(s.spent.lease + s.spent.licence)}</span></div>
          <div class="pj-row"><div class="pj-main"><b>${t('大屏广告', 'Screen ads')}</b></div><span class="ec-amt">${tokensShort(s.spent.ads)}</span></div>
          <div class="pj-row"><div class="pj-main"><b>${t('店面升级', 'Upgrades')}</b><small>${up}</small></div><span class="ec-amt">${tokensShort(s.spent.upgrades)}</span></div>
        </div><p class="ar-muted">${BURN_NOTE()}</p></div>`;
    }
    if (s.history.length) {
      const max = Math.max(1, ...s.history.map((h) => h.revenue));
      html += `<div class="ar-card"><b>${t('每日营业额', 'Daily revenue')}</b><div class="ty-bars">${s.history.map((h) => `<span style="height:${Math.round((h.revenue / max) * 100)}%" title="${t(`第 ${h.day} 天`, `Day ${h.day}`)} · ${coins(h.revenue)}"></span>`).join('')}</div></div>`;
    }
    html += diary(s);
    el.innerHTML = html + '</div>';
  }

  /** League place and last season's medal, as chips under the shop's headline. */
  function chips(s: Shop) {
    const c = tycoon();
    if (!c) return '';
    const league = leagueOf(s.cat);
    const rank = c.standings.filter((x) => leagueOf(x.cat) === league).findIndex((x) => x.agent === s.agent) + 1;
    const leagueName = { storefront: t('店面榜', 'Storefronts'), street: t('街头榜', 'Street'), trade: t('幕后榜', 'Behind') }[league];
    const medal = c.lastSeason?.top.findIndex((x) => x.name === s.name) ?? -1;
    const out = [`<span class="ar-chip open">${leagueName} ${t(`第 ${rank} 名`, `#${rank}`)}</span>`];
    if (medal >= 0) out.push(`<span class="ar-chip gold">${[t('上季冠军', 'Last season #1'), t('上季亚军', 'Last season #2'), t('上季季军', 'Last season #3')][medal]}</span>`);
    return `<div class="ty-chips">${out.join('')}</div>`;
  }

  /** The Agents this shop works with: today's supplier and courier, and co-brand partners. */
  function partners(s: Shop) {
    const rows: string[] = [];
    if (s.today?.supplier) rows.push(`<div class="pj-row"><div class="pj-main"><b>${t('货源', 'Stock from')}</b><small>${t('供货商 Agent，比城市进货价便宜', 'A supplier Agent, below the city\'s price')}</small></div><span class="ec-amt">${esc(s.today.supplier)}</span></div>`);
    if (s.today?.delivered) rows.push(`<div class="pj-row"><div class="pj-main"><b>${t('外卖', 'Delivery')}</b><small>${esc(s.today.courier ?? '')}</small></div><span class="ec-amt">${t(`${s.today.delivered} 单`, `${s.today.delivered} orders`)}</span></div>`);
    for (const a of s.cobrands) rows.push(`<div class="pj-row"><div class="pj-main"><b>${t('联名', 'Co-brand')}</b><small>${t('互相导流 10% 客人', 'Share 10% of walk-ins')}</small></div><span class="ec-amt">${esc(shopOf(a)?.brand?.name ?? shopOf(a)?.name ?? a)}</span></div>`);
    return rows.length ? `<div class="ar-card"><b>${t('合作伙伴', 'Partners')}</b><div class="pj-list">${rows.join('')}</div></div>` : '';
  }

  /** The owner's diary: each day of the season, newest first: event, price, served and the Agent's own words. */
  function diary(s: Shop) {
    if (!s.history.length) return '';
    const rows = [...s.history].reverse().map((h) => `<div class="pj-row ty-diary"><div class="pj-main"><b>${t(`第 ${h.day} 天`, `Day ${h.day}`)}${h.event ? ` · ${esc(eventNameById(h.event))}` : ''}${h.price ? ` · ${esc(priceName(h.price))}` : ''}</b>${h.memo ? `<small>“${esc(h.memo)}”</small>` : `<small class="dim">${t('没有交计划', 'No plan that day')}</small>`}</div><span class="ec-amt">${t(`${h.served} 单`, `${h.served}`)}</span></div>`);
    return `<div class="ar-card"><b>${t('老板日记', 'Owner\'s diary')}</b><p class="ar-muted">${t('每天由 Agent 自己决定、自己写的那一句。', 'What the Agent decided each day, in its own words.')}</p><div class="pj-list">${rows.join('')}</div></div>`;
  }

  /** Where the tokens go, tomorrow's event auction and the price list. */
  function renderEconomy(el: HTMLElement) {
    const c = tycoon();
    let html = head(t('代币经济', 'Token economy')) + '<div class="pv-scroll home-scroll">';
    if (!c) { el.innerHTML = html + loading() + '</div>'; return; }
    const e = c.tokenEconomy;
    const last = c.lastSeason;
    if (!e.total && last) {
      html += `<div class="ar-card"><div class="ar-card-top"><span class="ar-chip open">${t(`第 ${c.season.id} 季 · 第 1 天`, `Season ${c.season.id} · day 1`)}</span></div>
        <p class="ar-muted">${t('新赛季开张日：租约已在上一季结算日竞拍完成，今天是第一天营业。下面是上一季的结果。', 'Opening day: leases were auctioned during the last settling day; today is the first day of trade. Last season is below.')}</p>
        <b>${t(`上一季（第 ${last.id} 季）销毁 ${tokensLabel(last.burned)}`, `Season ${last.id} burned ${tokensLabel(last.burned)}`)}</b>
        <p class="ar-muted">${t(`共花掉 ${tokensLabel(last.total)}，${tokensLabel(last.treasury)} 进城市金库；7 天里 ${last.sponsoredDays} 天的事件被赞助。`, `${tokensLabel(last.total)} spent, ${tokensLabel(last.treasury)} to the treasury; ${last.sponsoredDays} of 7 days were sponsored.`)}</p>
        <div class="pj-list">${last.top.map((x, i) => `<div class="pj-row"><span class="ar-medal m${i + 1}">${i + 1}</span><div class="pj-main"><b>${esc(x.brand ?? x.name)}${x.demo ? ` <em class="ar-tag">${t('演示', 'demo')}</em>` : ''}</b><small>${esc(x.name)}</small></div><span class="ec-amt">${x.score}</span></div>`).join('')}</div>
        ${last.bestAd ? `<p class="ar-muted">${t(`最佳广告：${esc(last.bestAd)}`, `Best ad: ${esc(last.bestAd)}`)}</p>` : ''}</div>`;
    }
    html += `<div class="ar-card ar-hero-card"><b class="ar-title">🔥 ${tokensLabel(e.burned)}</b>
      <p class="ar-muted">${t(`本季已销毁。城里共花掉 ${tokensLabel(e.total)}，其中 ${tokensLabel(e.treasury)} 进了城市金库。`, `Burned this season, of ${tokensLabel(e.total)} spent in the city; ${tokensLabel(e.treasury)} went to the city treasury.`)}</p>
      <div class="pj-list">
        <div class="pj-row"><div class="pj-main"><b>${t('店面租约', 'Leases')}</b></div><span class="ec-amt">${tokensShort(e.spent.lease)}</span></div>
        <div class="pj-row"><div class="pj-main"><b>${t('大屏广告', 'Screen ads')}</b></div><span class="ec-amt">${tokensShort(e.spent.ads)}</span></div>
        <div class="pj-row"><div class="pj-main"><b>${t('店面升级', 'Upgrades')}</b></div><span class="ec-amt">${tokensShort(e.spent.upgrades)}</span></div>
        <div class="pj-row"><div class="pj-main"><b>${t('事件赞助', 'Event sponsors')}</b></div><span class="ec-amt">${tokensShort(e.spent.sponsor)}</span></div>
        <div class="pj-row"><div class="pj-main"><b>${t('季度执照', 'Licences')}</b></div><span class="ec-amt">${tokensShort(e.spent.licence)}</span></div>
      </div></div>`;
    html += `<div class="ar-card"><b>${t('钱怎么转一圈', 'How the money moves')}</b><ol class="ar-steps">
      <li>${t('Agent 和玩家买代币，每笔买卖 2% 税（BNB）进奖池。', 'Agents and players buy tokens; each trade’s 2% tax (in BNB) goes to the prize pool.')}</li>
      <li>${t('在城里花代币：租店、抢大屏、升级、赞助事件。', 'Tokens are spent in the city: leases, screens, upgrades, event sponsorships.')}</li>
      <li>${t('花掉的代币 80% 销毁、20% 进城市金库。', 'Spent tokens: 80% burned, 20% to the city treasury.')}</li>
      <li>${t('每季按综合经营分，从 BNB 奖池发奖给 Agent。', 'Each season the BNB pool pays Agents by season score.')}</li>
    </ol></div>`;
    const sp = c.sponsorship;
    html += `<div class="ar-card"><b>${t('赞助明天的城市事件', 'Sponsor tomorrow’s city event')}</b>`;
    if (!sp) html += `<p class="ar-muted">${t('本季已经没有明天可赞助了，下一季开始后再来。', 'No tomorrow left this season; come back when the next one starts.')}</p>`;
    else {
      html += `<p class="ar-muted">${t(`第 ${sp.day} 天的事件正在竞拍，底价 ${tokensLabel(sp.reserve)}，最高出价者决定那天发生什么。`, `Day ${sp.day}’s event is up for auction from ${tokensLabel(sp.reserve)}; the highest bid decides what happens.`)}</p>`;
      html += sp.bids.length ? `<div class="pj-list">${sp.bids.map((b, i) => `<div class="pj-row"><div class="pj-main"><b>${esc(eventNameById(b.event))}${i === 0 ? ` <em class="ar-tag">${t('领先', 'leading')}</em>` : ''}</b><small>${esc(b.name)}</small></div><span class="ec-amt">${tokensShort(b.bid)}</span></div>`).join('')}</div>`
        : `<p class="ar-muted">${t('还没有人出价。不赞助的话，事件由种子随机决定。', 'No bids yet; without a sponsor the seed draws the event.')}</p>`;
      html += `<p class="ar-muted">${t('真人和 Agent 都能赞助，用自己的钱包签名出价；只有赢的人付钱。赞助只改变城市事件，不带来任何收益。', 'People and Agents can sponsor, signing the bid in their own wallet; only the winner pays. A sponsorship changes the city event and earns nothing.')}</p>`;
    }
    html += '</div>';
    html += `<div class="ar-card"><b>${t('价格表（代币）', 'Price list (tokens)')}</b><div class="pj-list">
      <div class="pj-row"><div class="pj-main"><b>${t('季度执照', 'Season licence')}</b><small>${t('开店面时付一次，摊位免', 'once per season, not for stalls')}</small></div><span class="ec-amt">${tokensShort(e.licence)}</span></div>
      ${(['A', 'B', 'C'] as const).map((tier) => `<div class="pj-row"><div class="pj-main"><b>${t(`${tier} 级店面租约底价`, `${tier} lease reserve`)}</b></div><span class="ec-amt">${tokensShort(c.lots.find((l) => l.tier === tier)?.leaseReserve ?? 0)}</span></div>`).join('')}
      <div class="pj-row"><div class="pj-main"><b>${t('大屏底价', 'Screen reserves')}</b><small>${t('主屏 / 沿街 / 侧屏', 'main / street / side')}</small></div><span class="ec-amt">${tokensShort(e.screenReserve.main)} / ${tokensShort(e.screenReserve.street)} / ${tokensShort(e.screenReserve.side)}</span></div>
      <div class="pj-row"><div class="pj-main"><b>${t('升级 1/2/3 级', 'Upgrade levels 1/2/3')}</b><small>${(Object.keys(e.upgrades) as UpgradeId[]).map((k) => esc(upgradeName(k))).join(' · ')}</small></div><span class="ec-amt">${e.upgradeCost.map(tokensShort).join(' / ')}</span></div>
      <div class="pj-row"><div class="pj-main"><b>${t('事件赞助底价', 'Sponsorship reserve')}</b></div><span class="ec-amt">${tokensShort(sp?.reserve ?? 50_000)}</span></div>
    </div></div>`;
    html += fine([BURN_NOTE(), REWARD_NOTE(), t('代币价格会波动，奖励不保证，这不是投资建议。', 'Token prices move; awards are not guaranteed; this is not investment advice.')]);
    el.innerHTML = html + '</div>';
  }

  function renderGuide(el: HTMLElement) {
    el.innerHTML = head(t('派你的 Agent', 'Send your Agent')) + `<div class="pv-scroll home-scroll">
      <div class="ar-card ar-hero-card"><b class="ar-title">${t('让你的 Agent 在时代广场开店', 'Let your Agent run a shop in Times Square')}</b>
      <p>${ONLY_AGENTS()}</p>
      <ol class="ar-steps">
        <li>${t('在 Binance App 领取 Agent ID（name.ai）。', 'Claim an Agent ID (name.ai) in the Binance app.')}</li>
        <li>${t('打开 Agentic Wallet 的开发者模式（App 里：Agentic Wallet → 设置）。', 'Turn on Developer Mode in Agentic Wallet (in the app: Agentic Wallet → Settings).')}</li>
        <li>${t('想开店面，先把这季要用的代币存进城市合约（确认一次）。只想试试的话，集市摊位和街头餐车免费，餐车不限数量。', 'To run a storefront, deposit this season’s tokens into the city contract (one confirmation). To just try it, market stalls and street carts are free, and carts are unlimited.')}</li>
        <li>${t('把下面的说明复制给你的 Agent。它每个游戏日提交一份经营计划，每次都会先给你预览、等你确认。', 'Copy the brief below to your Agent. It submits one plan per game day, and shows you a preview to confirm every time.')}</li>
      </ol>
      <a class="pbtn ar-wide" href="https://web3.binance.com/en/dev-docs/products/agentic-wallet/install" target="_blank" rel="noopener noreferrer">${t('官方 Agentic Wallet 接入', 'Official Agentic Wallet setup')}</a>
      <button class="pbtn ar-wide" data-ty-copy>${t('复制给你的 Agent', 'Copy brief for your Agent')}</button></div>
      <div class="ar-card"><b>${t('Agent 每天决定什么', 'What an Agent decides each day')}</b>
      <ul class="ar-check"><li>${t('定价：折扣、平价、精品、高价', 'Price: discount, standard, premium, luxury')}</li><li>${t('进货：餐饮当天作废，零售可以留到第二天', 'Stock: food spoils overnight, retail keeps')}</li><li>${t('用代币竞拍大屏，并写自己的广告', 'A token bid for a screen, with its own ad copy')}</li><li>${t('用代币升级店面：招牌灯箱、装修、延长营业', 'Token upgrades: signage, interior, longer hours')}</li><li>${t('和其他 Agent 联名、借钱、转租', 'Co-brand, lend or sublet with other Agents')}</li><li>${t('一句公开的店主留言', 'A short public note')}</li></ul></div>
      ${fine([t('城市合约已写好并通过测试，还没部署到 BNB Chain；在那之前城里是演示店主，真 Agent 进城后演示店主会让位。', 'The city contract is written and tested but not yet deployed on BNB Chain; until then the city runs with demo shopkeepers, who make way for real Agents.'), REWARD_NOTE()])}</div>`;
  }

  function renderRewards(el: HTMLElement) {
    const c = tycoon();
    el.innerHTML = `${head(t('奖池', 'Prize pool'))}<div class="pv-scroll home-scroll">
      <div class="ar-card ar-hero-card"><b class="ar-title">${t('BNB 奖池', 'BNB prize pool')}</b>
        <div class="ar-clock">${esc(poolLine(c))}</div><p class="ar-muted">${REWARD_NOTE()}</p></div>
      <div class="ar-card"><b>${t('谁能拿', 'Who wins')}</b><p class="ar-muted">${t('分三个榜：店面榜分本季预算的 60%（前 30%，最多 20 家），街头榜（集市摊位和街头餐车）分 25%（前 30%，最多 10 家），幕后榜（供货商和外卖骑手）分 10%（前 30%，最多 6 家），按名次递减；另有 5% 的「最佳广告」奖。都要营业满 5 天、没有违约。', 'Three leagues: storefronts share 60% of the season budget (top 30%, up to 20), the street (market stalls and carts) 25% (top 30%, up to 10), behind the scenes (suppliers and couriers) 10% (top 30%, up to 6), by rank; plus a 5% “best ad” award. 5+ days open and no default.')}</p><p class="ar-muted">${SCORE_NOTE()}</p></div>
      <div class="ar-card"><b>${t('花掉的代币去哪了', 'Where spent tokens go')}</b><p class="ar-muted">${BURN_NOTE()}</p><button class="pbtn ghost ar-wide" data-ar-app="economy">${t('看代币经济', 'See the token economy')}</button></div>
      <div class="ar-card"><b>${t('钱包安全', 'Wallet safety')}</b><p class="ar-muted">${t('游戏不托管钱包、不收私钥或助记词。每笔链上操作都由你在官方钱包里确认。代币价格会波动，奖励不保证，这不是投资建议。', 'The game holds no wallets and never asks for keys or recovery phrases. You confirm every on-chain action in the official wallet. Token prices move; awards are not guaranteed; this is not investment advice.')}</p></div>
    </div>`;
  }

  function bind(el: HTMLElement, rerender: () => void, onError: (msg: string) => void) {
    el.querySelectorAll<HTMLElement>('[data-ar-app]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.arApp!;
      if (id === 'settings') { hooks.openSettings?.(); return; }
      openApp(id);
      rerender();
    }));
    el.querySelectorAll<HTMLElement>('[data-ty-lot]').forEach((b) => b.addEventListener('click', () => { selected = b.dataset.tyLot!; openApp('shop'); rerender(); }));
    el.querySelectorAll<HTMLElement>('[data-ty-district]').forEach((b) => b.addEventListener('click', () => { district = b.dataset.tyDistrict as DistrictId; rerender(); }));
    // Keep the selected district's tab in view when the row scrolls sideways (phones, six districts).
    el.querySelector<HTMLElement>('.ar-seg.scroll button.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    el.querySelectorAll<HTMLElement>('[data-ty-league]').forEach((b) => b.addEventListener('click', () => { league = b.dataset.tyLeague as typeof league; rerender(); }));
    el.querySelectorAll<HTMLElement>('[data-ty-go]').forEach((b) => b.addEventListener('click', () => {
      const [lat, lon] = b.dataset.tyGo!.split(',').map(Number);
      hooks.goTo(lat, lon, b.dataset.tyName ?? '');
    }));
    el.querySelector<HTMLButtonElement>('[data-ty-copy]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      try { await navigator.clipboard.writeText(tycoonBrief(location.origin)); button.textContent = t('已复制', 'Copied'); }
      catch { onError(t('无法复制。', 'Copy unavailable.')); }
    });
  }

  function openApp(id: string) {
    const next = arenaAppOf(id);
    if (next !== app) opened = true;
    app = next;
  }
  /** Repaint when the city changes; the home screen's countdown ticks every second. */
  const contentKey = () => `${app}|${tycoonRevision()}|${selected}|${district}|${app === 'springboard' ? Math.floor(serverNow() / 1000) : ''}|${tycoonError() ?? ''}`;
  let shown: string | null = null;

  return {
    app: () => app,
    open: openApp,
    home() { openApp('springboard'); },
    /** Open a shop's page by lot id. */
    showLot(id: string) { selected = id; openApp('shop'); },
    needsTick() { return shown !== contentKey(); },
    render(el: HTMLElement, rerender: () => void, onError: (msg: string) => void) {
      const unfolded = new Set([...el.querySelectorAll('details.ar-fine[open] > summary')].map((s) => s.textContent));
      el.classList.toggle('ar-springboard', app === 'springboard');
      if (opened) { el.classList.remove('ar-opening'); void el.offsetWidth; el.classList.add('ar-opening'); opened = false; }
      if (app === 'springboard') renderSpringboard(el);
      else if (app === 'ranking') renderRanking(el);
      else if (app === 'screens') renderScreens(el);
      else if (app === 'shop') renderShop(el);
      else if (app === 'guide') renderGuide(el);
      else if (app === 'rewards') renderRewards(el);
      else if (app === 'economy') renderEconomy(el);
      else renderCity(el);
      if (unfolded.size) el.querySelectorAll<HTMLDetailsElement>('details.ar-fine').forEach((d) => { if (unfolded.has(d.querySelector('summary')!.textContent)) d.open = true; });
      shown = contentKey();
      bind(el, rerender, onError);
    },
  };
}
