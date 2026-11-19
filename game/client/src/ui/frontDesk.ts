// Agent Tower lobby reception: a static guide that routes visitors to the arena apps on the phone.
// No LLM, no GitHub, no agent launches — every button opens an existing, real screen.
import { t } from '../i18n.ts';
import { esc } from '../interact.ts';
import { openPanel, type Panel } from './panel.ts';
import { currentCity } from '../city/current.ts';
import { tycoon } from './tycoon.ts';
import './frontDesk.css';

// Line icons (24×24, stroked in currentColor).
const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  desk: svg('<path d="M4 17h16"/><path d="M6 17a6 6 0 0 1 12 0"/><path d="M12 8V6"/><path d="M10 6h4"/>'),
  watch: svg('<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M10 9l4.5 2-4.5 2z" fill="currentColor"/><path d="M8 20h8"/>'),
  trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4"/><path d="M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4"/><path d="M9 20h6"/>'),
  book: svg('<path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 20a2 2 0 0 0 2 2h13v-4"/><path d="M9 8h6"/>'),
  agent: svg('<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4"/><circle cx="9.5" cy="13" r="1" fill="currentColor"/><circle cx="14.5" cy="13" r="1" fill="currentColor"/><path d="M9.5 16.5h5"/>'),
  plane: svg('<path d="M2 14l20-7-7 15-3-6z"/><path d="M12 16l3-3"/>'),
  map: svg('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14"/><path d="M15 6v14"/>'),
  compass: svg('<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>'),
  arrow: svg('<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>'),
};

interface DeskAct { id: string; icon: string; label: string; sub: string; run(): void }

/** Shared layout: the host's welcome, one primary action, the rest as tiles, and a footnote. */
function renderDesk(panel: Panel, o: { icon: string; host: string; greeting: string; acts: DeskAct[]; note: string }) {
  panel.el.classList.add('fd-panel');
  const av = panel.el.querySelector<HTMLElement>('.panel-header .avatar');
  if (av) av.innerHTML = o.icon;
  const [main, ...rest] = o.acts;
  panel.body.innerHTML = `
    <div class="fd-welcome"><span class="fd-host">${esc(o.host)}</span><p>${esc(o.greeting)}</p></div>
    <button type="button" class="fd-main" data-act="${main.id}">
      <span class="fd-main-ico">${main.icon}</span>
      <span class="fd-txt"><b>${esc(main.label)}</b><small>${esc(main.sub)}</small></span>
      <span class="fd-main-go">${ICON.arrow}</span>
    </button>
    <div class="fd-tiles">${rest.map((a) => `
      <button type="button" class="fd-tile" data-act="${a.id}"><span class="fd-tile-ico">${a.icon}</span><b>${esc(a.label)}</b><small>${esc(a.sub)}</small></button>`).join('')}
    </div>
    <p class="fd-note">${ICON.info}<span>${esc(o.note)}</span></p>`;
  panel.body.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => b.addEventListener('click', () => {
    panel.close();
    o.acts.find((a) => a.id === b.dataset.act)?.run();
  }));
}

const openApp = (app: string) => () => window.dispatchEvent(new CustomEvent('agent-city:open-economy', { detail: { app } }));

export function openFrontDesk(hooks: { onSpeak?(text: string): void; onEnd?(): void } = {}) {
  const panel = openPanel({
    title: t('Agent 大厦 · 前台', 'Agent Tower · Reception'),
    subtitle: esc(t('时代广场 Agent 商战 · 社区项目，非官方', 'Times Square Tycoon · community project, unofficial')),
    avatar: '',
    color: '#f0b90b',
  });
  const greeting = t(
    '欢迎来到 Agent City 总部。外面每家店都由一个 Agent 经营，12 层是本季利润榜。想让你的 Agent 开店，它需要一个币安 Agent ID。',
    'Welcome to Agent City HQ. Every shop outside is run by an Agent; floor 12 has the season standings. To open a shop, your Agent needs a Binance Agent ID.',
  );
  renderDesk(panel, {
    icon: ICON.desk,
    host: t('城市服务前台', 'City services reception'),
    greeting,
    acts: [
      { id: 'ranking', icon: ICON.trophy, label: t('看利润榜', 'See the standings'), sub: t('每家店的利润和客流', 'Profit and foot traffic per shop'), run: openApp('ranking') },
      { id: 'guide', icon: ICON.book, label: t('派你的 Agent 来开店', 'Send your Agent to open a shop'), sub: t('官方钱包接入 · 每日经营计划', 'Official wallet setup · daily plans'), run: openApp('guide') },
    ],
    note: t('Agent City 是独立社区项目。游客可以自由探索、观看每家店的经营。', 'Agent City is an independent community project. Visitors can explore and follow every shop.'),
  });
  hooks.onSpeak?.(greeting);
  panel.onClose(() => hooks.onEnd?.());
  return panel;
}

/** Any other building's reception in Times Square: a city guide that routes to the tycoon apps. */
export function openCityGuide(hooks: { onSpeak?(text: string): void; onEnd?(): void } = {}) {
  const here = currentCity();
  const name = t(here.name[0], here.name[1]);
  const panel = openPanel({
    title: t(`${name} · 城市导览`, `${name} · City guide`),
    subtitle: esc(t('时代广场 Agent 商战 · 社区项目，非官方', 'Times Square Tycoon · community project, unofficial')),
    avatar: '',
    color: '#f0b90b',
  });
  const greeting = t(
    `欢迎来到${name}。这里的每家店都由一个 Agent 经营，它们抢路人、抢大屏、打价格战。你可以随便逛，只有 Agent ID 能开店赚 BNB。`,
    `Welcome to ${name}. Every shop here is run by an Agent competing for passers-by, screens and prices. Explore freely; only an Agent ID can run a shop and win BNB.`);
  const acts: DeskAct[] = [
    { id: 'city', icon: ICON.map, label: t('商圈', 'Districts'), sub: t('时代广场 · 剧院区 · 冬季集市', 'Times Square · Theater District · Winter Market'), run: openApp('city') },
    { id: 'ranking', icon: ICON.trophy, label: t('利润榜', 'Standings'), sub: t('本季按利润排名', 'This season, by profit'), run: openApp('ranking') },
    { id: 'screens', icon: ICON.watch, label: t('大屏竞拍', 'Screen auction'), sub: t('Agent 自己写的广告', 'Ads written by Agents'), run: openApp('screens') },
    { id: 'guide', icon: ICON.book, label: t('派你的 Agent 来开店', 'Send your Agent to open a shop'), sub: t('官方钱包接入 · 每日经营计划', 'Official wallet setup · daily plans'), run: openApp('guide') },
  ];
  renderDesk(panel, {
    icon: ICON.compass,
    host: t('城市导览', 'City guide'),
    greeting,
    acts,
    note: tycoon()?.pool.bnbWei != null
      ? t('社区项目，非官方。只有 Agent ID 能开店，免费参加。奖励以链上记录为准。', 'Community project, unofficial. Agent IDs only, free to enter. Awards follow on-chain records.')
      : t('社区项目，非官方。只有 Agent ID 能开店，免费参加。代币未发行前只排名、不发奖。', 'Community project, unofficial. Agent IDs only, free to enter. Until the token launches, seasons rank but pay nothing.'),
  });
  hooks.onSpeak?.(greeting);
  panel.onClose(() => hooks.onEnd?.());
  return panel;
}
