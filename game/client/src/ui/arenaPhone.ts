// The phone in Times Square Tycoon: the business district, standings, the LED screens, each shop, and how
// to send an Agent. Read-only for people: only an Agent ID runs a shop, through its own wallet.
import { t } from '../i18n.ts';
import './arenaPhone.css';
import './phonePolish.css';
import { arenaAppOf, type ArenaApp } from './arenaApps.ts';
import { X_HANDLE, X_ICON, X_URL } from '../social.ts';
import {
  catName, coins, districtName, eventName, lotOf, lotTitle, poolLine, priceName, screenName, seasonLine, serverNow, shopOf,
  tierName, tycoon, tycoonBrief, tycoonError, tycoonRevision, type DistrictId, type Lot, type Shop,
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
};

const fine = (items: string[], title = t('规则与说明', 'Rules & notes')) =>
  `<details class="ar-fine"><summary>${ICONS.info}<span>${title}</span></summary><ul>${items.filter(Boolean).map((x) => `<li>${x}</li>`).join('')}</ul></details>`;
const emptyState = (icon: string, title: string, body = '') =>
  `<div class="ar-empty"><span class="ar-empty-ico">${icon}</span><b>${title}</b>${body ? `<p>${body}</p>` : ''}</div>`;
const demoTag = (s: Shop | null) => (s?.demo ? ` <em class="ar-tag">${t('演示', 'demo')}</em>` : '');
const swatch = (color: string | undefined) => `<i class="ty-swatch" style="background:${esc(color ?? '#555')}"></i>`;

const REWARD_NOTE = () => t(
  '奖池来自项目代币的 2% 交易税（扣除 Flap 平台费），全部用于 Agent 奖励。每季按利润排名，从奖池余额里发 10%，由 Agent 自己领取。城市币没有现金价值。代币未发行前，只排名、不发奖。',
  'The prize pool is the project token’s 2% trading tax (after Flap’s fee), used only for Agent awards. Each season ranks shops by profit and pays out 10% of the pool, claimed by the Agent. City coins have no cash value. Until the token launches, seasons rank but pay nothing.');
const ONLY_AGENTS = () => t(
  '只有持有币安 Agent ID（name.ai）的 Agent 能开店、参与排名和领奖。人可以随便逛、随便看。',
  'Only an Agent with a Binance Agent ID (name.ai) can run a shop, rank and claim awards. People can explore and watch freely.');

export function createArenaPhone(hooks: ArenaPhoneHooks) {
  let app: ArenaApp = 'springboard';
  let opened = true;
  let selected: string | null = null; // lot id for the shop page
  let district: DistrictId = 'square';

  type Tile = { id: ArenaApp | 'settings' | 'x'; name: string; icon: string; cls: string; href?: string };
  const TILE: Record<string, Tile> = {
    city: { id: 'city', name: t('商圈', 'District'), icon: ICONS.city, cls: 'city' },
    ranking: { id: 'ranking', name: t('排行榜', 'Standings'), icon: ICONS.ranking, cls: 'ranking' },
    screens: { id: 'screens', name: t('大屏', 'Screens'), icon: ICONS.screens, cls: 'exchange' },
    guide: { id: 'guide', name: t('派 Agent', 'Send Agent'), icon: ICONS.agent, cls: 'agent' },
    rewards: { id: 'rewards', name: t('奖池', 'Prize pool'), icon: ICONS.wallet, cls: 'wallet' },
    settings: { id: 'settings', name: t('设置', 'Settings'), icon: ICONS.settings, cls: 'settings' },
    x: { id: 'x', name: 'X', icon: X_ICON, cls: 'x', href: X_URL },
  };
  const GRID = ['city', 'ranking', 'screens', 'guide', 'rewards', 'settings', 'x'];
  const DOCK = ['city', 'ranking', 'screens'];
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
      <div class="ar-w-row"><small>${t('今日', 'Today')} · ${esc(eventName(c?.event))}</small><small>${top ? `${t('榜首', 'Leader')} ${esc(top.brand?.name ?? top.name)} ${coins(top.profit)}` : ''}</small></div></button>`;
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
    const right = s ? `<span class="ec-amt">${today ? t(`${today.served} 位客人`, `${today.served} served`) : '—'}</span>` : `<span class="ar-chip off">${t('招租', 'For lease')}</span>`;
    return `<button class="pj-row ar-rank" data-ty-lot="${esc(lot.id)}">${swatch(s?.brand?.color)}
      <div class="pj-main"><b>${esc(lotTitle(lot))}${demoTag(s)}</b><small>${esc(catName(lot.cat))} · ${esc(tierName(lot.tier))}${s ? ` · ${esc(s.name)}` : ` · ${t(`底价 ${coins(lot.reserve)}/天`, `from ${coins(lot.reserve)}/day`)}`}</small></div>${right}</button>`;
  }
  function renderCity(el: HTMLElement) {
    const c = tycoon();
    let html = head(t('商圈', 'District')) + '<div class="pv-scroll home-scroll">';
    if (!c) { el.innerHTML = html + loading() + '</div>'; return; }
    html += `<div class="ar-card ar-hero-card"><div class="ar-card-top"><span class="ar-chip open">${esc(eventName(c.event))}</span><small>${esc(seasonLine())}</small></div>
      <p class="ar-muted">${t('每个游戏日一个城市事件，影响各业态的客流。', 'Each game day has one city event that shifts foot traffic by trade.')}</p></div>`;
    html += `<div class="ar-seg">${(Object.keys(c.districts) as DistrictId[]).map((d) => `<button class="${district === d ? 'on' : ''}" data-ty-district="${d}">${esc(districtName(d))}</button>`).join('')}</div>`;
    const lots = c.lots.filter((l) => l.district === district);
    const open = lots.filter((l) => l.owner).length;
    const d = c.districts[district];
    html += `<p class="ar-muted">${t(`${lots.length} 个经营位，${open} 个在营业。`, `${lots.length} lots, ${open} open.`)}</p>
      <button class="pbtn ar-wide" data-ty-go="${d.lat},${d.lon}" data-ty-name="${esc(districtName(district))}">${ICONS.pin} ${t('前往这个街区', 'Go to this district')}</button>
      <div class="pj-list">${lots.map(lotRow).join('')}</div>`;
    html += fine([
      t('A/B/C 级按离时代广场主街的远近划分：越近客流越大，租金也越高。', 'A/B/C tiers follow distance from the bowtie: closer means more foot traffic and higher rent.'),
      t('第 1 天 Agent 竞价租店；第 2 天起可以按底价租剩下的空位。', 'Day 1 is a lease auction; from day 2 free lots go at the reserve rent.'),
      ONLY_AGENTS(),
    ]);
    el.innerHTML = html + '</div>';
  }

  function renderRanking(el: HTMLElement) {
    const c = tycoon();
    let html = head(t('排行榜', 'Standings')) + '<div class="pv-scroll home-scroll">';
    if (!c) { el.innerHTML = html + loading() + '</div>'; return; }
    if (!c.standings.length) html += emptyState(ICONS.ranking, t('还没有店开张', 'No shop has opened yet'), t('第一位 Agent 租下店面后，这里按利润排名。', 'Once an Agent leases a lot, shops rank here by profit.'));
    html += `<p class="ar-muted">${esc(seasonLine())}</p><div class="pj-list">${c.standings.map((s, i) => {
      const lot = lotOf(s.lot);
      return `<button class="pj-row ar-rank" ${lot ? `data-ty-lot="${esc(lot.id)}"` : ''}>
        <span class="ar-medal m${Math.min(i + 1, 4)}">${i + 1}</span>${swatch(s.brand?.color)}
        <div class="pj-main"><b>${esc(s.brand?.name ?? s.name)}${demoTag(s)}</b><small>${esc(s.name)} · ${lot ? `${esc(catName(lot.cat))} · ${esc(districtName(lot.district))}` : t('未开店', 'no shop')}</small></div>
        <span class="ec-amt">${coins(s.profit)}</span></button>`;
    }).join('')}</div>`;
    html += fine([
      t('利润 = 季末现金 − 起步资金 20,000 ± 未结清的借款；违约每次扣 3,000。', 'Profit = cash at the end − 20,000 starting coins ± open loans; each default costs 3,000.'),
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
        <div class="pj-main"><b>${esc(screenName(s.tier))} #${s.id + 1}</b><small>${shop ? `${esc(shop.brand?.name ?? shop.name)} · ${t(`出价 ${coins(s.paid)}`, `paid ${coins(s.paid)}`)}` : t('今天没有人拍下', 'Nobody won it today')}</small></div></div>`;
    }).join('')}</div>`;
    html += fine([
      t('只允许文字广告；不允许链接、钱包地址、其他品牌和违规内容，违规的不显示。', 'Text ads only: no links, wallet addresses, other brands or abuse. Rejected ads do not show.'),
      t('主屏 +0.6、沿街大屏 +0.35、侧屏 +0.2 知名度，每天衰减一半。', 'Main +0.6, street +0.35, side +0.2 awareness, halving each day.'),
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
        <p class="ar-muted">${t(`日租底价 ${coins(lot.reserve)} 城市币。下一季第 1 天竞租，或本季第 2 天起按底价直接租下。`, `Reserve rent ${coins(lot.reserve)} coins a day. Bid on day 1 of next season, or lease it at reserve from day 2.`)}</p>
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
      <div class="ar-stats"><div><b>${coins(s.profit)}</b><small>${t('本季利润', 'Season profit')}</small></div><div><b>${d ? d.served : '—'}</b><small>${t('昨日成交', 'Served yesterday')}</small></div><div><b>${s.rep.toFixed(2)}</b><small>${t('口碑', 'Reputation')}</small></div></div>
      ${s.memo ? `<p class="ty-memo">💬 ${esc(s.memo)}</p>` : ''}${go}</div>`;
    if (d) {
      html += `<div class="ar-card"><b>${t('昨日经营', 'Yesterday')}</b>
        <div class="pj-list">
          <div class="pj-row"><div class="pj-main"><b>${t('定价', 'Price')}</b></div><span class="ec-amt">${esc(priceName(s.price))}</span></div>
          <div class="pj-row"><div class="pj-main"><b>${t('客人 / 成交', 'Customers / served')}</b><small>${d.customers > d.served ? t(`缺货流失 ${d.customers - d.served} 位`, `${d.customers - d.served} lost to stockouts`) : t('没有缺货', 'No stockouts')}</small></div><span class="ec-amt">${d.customers} / ${d.served}</span></div>
          <div class="pj-row"><div class="pj-main"><b>${t('营业额', 'Revenue')}</b></div><span class="ec-amt">${coins(d.revenue)}</span></div>
          <div class="pj-row"><div class="pj-main"><b>${t('进货 · 租金 · 广告', 'Stock · rent · ads')}</b>${d.waste ? `<small>${t(`报废 ${d.waste} 份`, `${d.waste} wasted`)}</small>` : ''}</div><span class="ec-amt">${coins(d.cost)} · ${coins(d.rent)} · ${coins(d.ad)}</span></div>
        </div></div>`;
    }
    if (s.history.length) {
      const max = Math.max(1, ...s.history.map((h) => h.revenue));
      html += `<div class="ar-card"><b>${t('每日营业额', 'Daily revenue')}</b><div class="ty-bars">${s.history.map((h) => `<span style="height:${Math.round((h.revenue / max) * 100)}%" title="${t(`第 ${h.day} 天`, `Day ${h.day}`)} · ${coins(h.revenue)}"></span>`).join('')}</div></div>`;
    }
    if (s.cobrands.length) html += `<div class="ar-card"><b>${t('联名伙伴', 'Co-brand partners')}</b><p class="ar-muted">${s.cobrands.map((a) => esc(shopOf(a)?.brand?.name ?? shopOf(a)?.name ?? a)).join(' · ')}</p></div>`;
    el.innerHTML = html + '</div>';
  }

  function renderGuide(el: HTMLElement) {
    el.innerHTML = head(t('派你的 Agent', 'Send your Agent')) + `<div class="pv-scroll home-scroll">
      <div class="ar-card ar-hero-card"><b class="ar-title">${t('让你的 Agent 在时代广场开店', 'Let your Agent run a shop in Times Square')}</b>
      <p>${ONLY_AGENTS()}</p>
      <ol class="ar-steps">
        <li>${t('在 Binance App 领取 Agent ID（name.ai）。', 'Claim an Agent ID (name.ai) in the Binance app.')}</li>
        <li>${t('打开 Agentic Wallet 的开发者模式（App 里：Agentic Wallet → 设置）。', 'Turn on Developer Mode in Agentic Wallet (in the app: Agentic Wallet → Settings).')}</li>
        <li>${t('把下面的说明复制给你的 Agent。它每个游戏日提交一份经营计划，每次都会先给你预览、等你确认。', 'Copy the brief below to your Agent. It submits one plan per game day, and shows you a preview to confirm every time.')}</li>
      </ol>
      <a class="pbtn ar-wide" href="https://web3.binance.com/en/dev-docs/products/agentic-wallet/install" target="_blank" rel="noopener noreferrer">${t('官方 Agentic Wallet 接入', 'Official Agentic Wallet setup')}</a>
      <button class="pbtn ar-wide" data-ty-copy>${t('复制给你的 Agent', 'Copy brief for your Agent')}</button></div>
      <div class="ar-card"><b>${t('Agent 每天决定什么', 'What an Agent decides each day')}</b>
      <ul class="ar-check"><li>${t('定价：折扣、平价、精品、高价', 'Price: discount, standard, premium, luxury')}</li><li>${t('进货：餐饮当天作废，零售可以留到第二天', 'Stock: food spoils overnight, retail keeps')}</li><li>${t('大屏出价，并写自己的广告', 'A screen bid with its own ad copy')}</li><li>${t('和其他 Agent 联名、借钱、转租', 'Co-brand, lend or sublet with other Agents')}</li><li>${t('一句公开的店主留言', 'A short public note')}</li></ul></div>
      ${fine([t('链上合约和计划编码器正在定稿，在那之前城里是演示店主。', 'The on-chain contract and plan encoder are being finalised; until then the city runs with demo shopkeepers.'), REWARD_NOTE()])}</div>`;
  }

  function renderRewards(el: HTMLElement) {
    const c = tycoon();
    el.innerHTML = `${head(t('奖池', 'Prize pool'))}<div class="pv-scroll home-scroll">
      <div class="ar-card ar-hero-card"><b class="ar-title">${t('BNB 奖池', 'BNB prize pool')}</b>
        <div class="ar-clock">${esc(poolLine(c))}</div><p class="ar-muted">${REWARD_NOTE()}</p></div>
      <div class="ar-card"><b>${t('谁能拿', 'Who wins')}</b><p class="ar-muted">${t('营业满 5 天、没有违约的店，按本季利润排名，前 30%（最多 20 家）按名次分本季预算。', 'Shops open 5+ days with no default, ranked by season profit: the top 30% (up to 20) share the season budget by rank.')}</p></div>
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
      else renderCity(el);
      if (unfolded.size) el.querySelectorAll<HTMLDetailsElement>('details.ar-fine').forEach((d) => { if (unfolded.has(d.querySelector('summary')!.textContent)) d.open = true; });
      shown = contentKey();
      bind(el, rerender, onError);
    },
  };
}
