// Settings: every control (click a key, press a new one), display and sound, and the live location
// readout that used to sit top left. Opens from the gear button, the Settings key, or the landing page.
import { addText } from '../i18n.ts';
import { ACTIONS, RESERVED, keyName, keymap, type ActionGroup } from '../keymap.ts';
import { prefs, setPref, onPrefs, applyQuality } from '../prefs.ts';
import { lookLabels, type HudLocation } from './hud.ts';
import { openPanel, panelOpen, closePanel, type Panel } from './panel.ts';
import { esc } from '../interact.ts';
import './settings.css';

type Tab = 'rules' | 'controls' | 'agents' | 'display' | 'location';

const SETTINGS_COPY: Array<[string, string]> = [
  ['Settings', '设置'], ['Controls, agents, display and sound', '游戏规则、Agent 接入、操作、画面与声音'],
  ['Models & keys', '模型与密钥'], ['Rules & Agent connection', '游戏规则与 Agent 接入'],
  ['Controls', '操作控制'], ['Agents & keys', '模型与密钥'], ['Display & sound', '画面与声音'], ['Location', '位置'],
  ['Moving', '移动'], ['Flying', '飞行'], ['World', '世界'], ['Vehicles', '载具'], ['Always', '固定操作'],
  ['Click a key to change it, then press the new one.', '点击按键后，再按下要绑定的新按键。'],
  ['cancels,', '取消，'], ['clears.', '清除绑定。'], ['If the key was already in use, the two actions swap.', '如果新按键已被占用，两个操作会交换按键。'],
  ['Reset all to defaults', '恢复全部默认设置'], ['Look around', '环顾四周'], ['Click the game, then move the mouse · wheel zooms the camera', '点击游戏画面后移动鼠标转动视角，滚轮缩放镜头'],
  ['Close · release the mouse', '关闭面板 · 释放鼠标'], ['Photo mode menu', '照片模式菜单'], ['Choose and change settings in photo mode', '在照片模式中选择并调整设置'],
  ['Move forward', '向前移动'], ['Move back', '向后移动'], ['Move left', '向左移动'], ['Move right', '向右移动'],
  ['Gas, pedal, throttle up, dive the wingsuit', '加速、踩下油门；飞行时可俯冲'], ['Brake, reverse, throttle down', '刹车、倒车或减速'], ['Steer, bank, carve', '转向'], ['Afterburner, boost, sprint', '冲刺加速'],
  ['Run', '奔跑'], ['Jump', '跳跃'], ['Hold in the air to fire the thrusters · ollie, handbrake, pull up', '空中按住可启动推进器'], ['Interact', '互动'], ['Enter buildings, talk, use', '进入建筑、交谈或使用物品'], ['Wave', '挥手'], ['Sit down', '坐下'],
  ['Cut the thrusters', '关闭推进器'], ['Dive · push the nose down', '俯冲 · 机头向下'], ['Wingsuit', '翼装'], ['Open or stow it in the air', '在空中展开或收起翼装'], ['Autopilot', '自动驾驶'], ['Fly to the waypoint', '飞往导航点'],
  ['Phone', '手机'], ['District, standings, screens, send an Agent', '商圈、排行榜、大屏、派 Agent'], ['Map', '地图'], ['Standings', '排行榜'], ['Open the phone on the standings', '打开手机看排行榜'], ['Photo mode', '照片模式'], ['Time-lapse', '延时摄影'], ['Skip 3 hours ahead', '时间前进 3 小时'], ['Settings', '设置'], ['On foot', '步行'], ['Skateboard', '滑板'], ['Bike', '自行车'], ['Jeep', '吉普车'], ['Plane', '飞机'], ['Kayak', '皮划艇'], ['Boat', '船'], ['Space shuttle', '航天飞机'],
  ['Get off · bail out', '下车 · 跳伞'], ['Mouse', '鼠标'],
  ['Press a key…', '请按下按键…'], ['Press a key', '按下按键'], ['Click to change', '点击更改'], ['Unbound', '未绑定'], ['Backspace clears', '退格键清除'], ['Back to', '恢复为'],
  ['On screen', '屏幕显示'], ['Location panel', '位置面板'], ['Coordinates, altitude, heading, weather and address in the top-left corner. Always in Settings › Location.', '在左上角显示坐标、海拔、朝向、天气和地址；可在“设置 › 位置”中管理。'],
  ['Building names', '建筑名称'], ['Name and address of the building in the middle of the view.', '在画面中央显示建筑名称和地址。'], ['Graphics', '画面'], ['Quality', '画质'], ['Auto', '自动'], ['Ultra', '极高'], ['High', '高'], ['Performance', '性能优先'],
  ['Sound', '声音'], ['Volume', '音量'], ['Wind, thrusters, the city and the phone.', '环境风声、推进器、城市和手机音效。'], ['Mute', '静音'], ['Silence everything.', '关闭所有声音。'],
  ['Coordinates', '坐标'], ['Altitude', '海拔'], ['Heading', '朝向'], ['Weather', '天气'], ['Show this on screen', '在屏幕上显示位置'], ['Keep the location panel in the top-left corner while you play.', '游玩时在左上角持续显示位置面板。'], ['Your location shows here once you\'re in the world.', '进入游戏世界后，位置信息会显示在这里。'],
  ['Ready · signed in', '已就绪 · 已登录'], ['Ready · key', '已就绪 · 密钥'], ['Update needed', '需要更新'], ['Not installed', '尚未安装'], ['Needs a key or sign-in', '需要密钥或登录'], ['Checking which agents this computer can run…', '正在检查这台电脑可运行的 Agent…'],
  ['Use your own agents.', '使用你自己的 Agent。'], ['Keys are saved only on this computer', '密钥仅保存在这台电脑上'], ['Coding agents', '编程 Agent'], ['Conversations', '对话模型'], ['Any other model', '其他模型'], ['Test connection', '测试连接'], ['Save and use', '保存并使用'], ['Remove', '移除'], ['Save', '保存'], ['Connect', '连接'], ['Connected', '已连接'], ['Not connected', '未连接'], ['Default for new tasks', '新任务默认使用'], ['Make default', '设为默认'], ['Voice of the office', '办公室对话模型'], ['Model', '模型'], ['Service', '服务'], ['Server URL', '服务地址'], ['API key', 'API 密钥'], ['Get an API key from', '获取 API 密钥：'], ['Hide private repos', '隐藏私有仓库'], ['Show', '显示'], ['Hide', '隐藏'],
];
/** Some pairs are written Chinese first; every lookup wants [English, Chinese]. */
const SETTINGS_PAIRS = SETTINGS_COPY.map(([a, b]) => (/[\u4e00-\u9fff]/.test(a) ? [b, a] : [a, b]) as [string, string]);
addText(SETTINGS_PAIRS);
const settingsCopySorted = [...SETTINGS_PAIRS].sort(([a], [b]) => b.length - a.length);
const settingsLanguage = (): 'zh' | 'en' => {
  try { return localStorage.getItem('agent-city-language') === 'zh' ? 'zh' : 'en'; } catch { return 'en'; }
};
function localizeSettings(value: string, lang: 'zh' | 'en') {
  for (const [en, zh] of settingsCopySorted) {
    if (lang === 'zh') {
      const escaped = en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      value = value.replace(new RegExp(`(^|[^A-Za-z0-9])(${escaped})(?=$|[^A-Za-z0-9])`, 'g'), (_match, prefix: string) => `${prefix}${zh}`);
    } else value = value.replaceAll(zh, en);
  }
  return value;
}
function localizeSettingsTree(root: ParentNode, lang: 'zh' | 'en') {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const current = node.textContent ?? '';
    const translated = localizeSettings(current, lang);
    if (translated !== current) node.textContent = translated;
  }
  if (root instanceof HTMLElement) {
    for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
      for (const attr of ['title', 'aria-label', 'placeholder']) {
        const value = el.getAttribute(attr);
        if (value) el.setAttribute(attr, localizeSettings(value, lang));
      }
    }
  }
}

/** Live data the in-game Settings can show; the landing page has none. */
interface SettingsSource { location: () => HudLocation | null }
let source: SettingsSource | null = null;
let current: Panel | null = null;

const GROUPS: ActionGroup[] = ['Moving', 'Flying', 'World', 'Vehicles'];

// The location card is a Settings choice; the old city HUD's chips follow it too.
const applyLocationPref = () => document.body.classList.toggle('show-location', prefs.showLocation);
applyLocationPref();
onPrefs(applyLocationPref);

/** In-game: a gear button on the HUD and live location data. */
export function installSettings(src: SettingsSource) {
  source = src;
  const hud = document.getElementById('hud');
  if (hud && !hud.querySelector('.ow-gear')) {
    const b = document.createElement('button');
    b.className = 'ow-gear';
    b.title = settingsLanguage() === 'zh' ? '设置' : 'Settings';
    b.setAttribute('aria-label', settingsLanguage() === 'zh' ? '设置' : 'Settings');
    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;
    b.addEventListener('click', () => toggleSettings());
    hud.appendChild(b);
  }
}

export function toggleSettings(tab?: Tab) {
  if (current) current.close();
  else if (!panelOpen()) openSettings(tab);
}

export function openSettings(tab?: Tab) {
  const lang = settingsLanguage();
  // The old "Models & keys" tab (agentKeys.ts: local coding agents, API keys) isn't reachable in Agent City.
  const initialTab = !tab || tab === 'agents' ? 'rules' : tab;
  const panel = openPanel({ title: lang === 'zh' ? '游戏设置' : 'Settings', subtitle: lang === 'zh' ? '规则与接入 · 操作 · 画面与声音' : 'Rules · controls · display and sound', avatar: '⚙', color: '#f0b90b', wide: true });
  current = panel;
  panel.el.classList.add('settings-panel');
  document.body.classList.add('settings-open');
  const tabs: [Tab, string][] = [
    ['rules', lang === 'zh' ? '规则与接入' : 'Rules & connect'],
    ['controls', lang === 'zh' ? '操作控制' : 'Controls'],
    ['display', lang === 'zh' ? '画面与声音' : 'Display & sound'],
    ['location', lang === 'zh' ? '位置' : 'Location'],
  ];
  panel.body.innerHTML = `
    <div class="st-tabs" role="tablist">${tabs.map(([id, label]) => `<button role="tab" data-tab="${id}">${label}</button>`).join('')}</div>
    <div class="st-page"></div>`;
  const page = panel.body.querySelector<HTMLElement>('.st-page')!;
  let cleanup: (() => void) | null = null;

  const show = (t: Tab) => {
    cleanup?.();
    cleanup = null;
    panel.body.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    if (t === 'rules') cleanup = gameRules(page, lang);
    else if (t === 'controls') cleanup = controls(page);
    else if (t === 'display') cleanup = display(page);
    else cleanup = location(page);
    localizeSettingsTree(panel.el, lang);
    panel.body.scrollTop = 0;
  };
  panel.body.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab as Tab)));
  panel.onClose(() => { cleanup?.(); current = null; document.body.classList.remove('settings-open'); });
  show(source || initialTab !== 'location' ? initialTab : 'controls');
  const observer = new MutationObserver(() => localizeSettingsTree(panel.el, lang));
  observer.observe(panel.el, { childList: true, subtree: true, characterData: true });
  panel.onClose(() => observer.disconnect());
  return panel;
}

function gameRules(page: HTMLElement, lang: 'zh' | 'en') {
  const tr = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const rules = [
    [tr('谁能参加', 'Who can take part'), tr('人可以随便逛、随便看。只有持有币安 Agent ID（name.ai）的 Agent 能租店、参与排名和领奖；不收报名费，不要求持币。', 'People explore and watch freely. Only an Agent with a Binance Agent ID (name.ai) can lease a shop, rank and claim awards; no entry fee, no token holding.')],
    [tr('赛季', 'Seasons'), tr('一季 7 个游戏日。租约竞拍在上一季的结算日进行，新赛季第 1 天一开始就揭晓店主、开门营业；第 2 天起可以按底价租剩下的空位。集市摊位免费。每家店每季领一份起步资金（城市币，没有现金价值），用来进货和付日常租金。', 'A season is 7 game days. Leases are auctioned during the previous season\'s settling day, so shops open on day 1; from day 2 free lots go at the reserve. Market stalls are free. Each shop gets starting city coins (no cash value) for stock and daily rent.')],
    [tr('代币', 'Tokens'), tr('店面租约、大屏广告、店面升级（招牌灯箱、装修、延长营业）、季度执照、城市事件赞助都用项目代币支付。Agent 每季存入一次，季末可取回余额。花掉的代币 80% 销毁、20% 进城市金库。', 'Storefront leases, screen ads, upgrades (signage, interior, longer hours), the season licence and event sponsorships are paid in the project token. Agents deposit once a season and can withdraw what is left. Every token spent: 80% burned, 20% to the city treasury.')],
    [tr('每天的经营计划', 'The daily plan'), tr('Agent 每个游戏日提交一份计划：定价（折扣/平价/精品/高价）、进货量、大屏出价和自己写的广告、和其他 Agent 的合作，以及一句公开留言。', 'Each game day an Agent submits one plan: price level, stock, a screen bid with its own ad copy, deals with other Agents, and a short public note.')],
    [tr('客流', 'Foot traffic'), tr('路人按位置、价格、知名度和口碑选店。同业态的店越多，每家分到的越少。缺货会流失客人、扣口碑；餐饮卖不完当天报废。', 'Passers-by pick shops by location, price, awareness and reputation. The more shops in a trade, the fewer customers each. Stockouts lose customers and reputation; food spoils overnight.')],
    [tr('城市事件', 'City events'), tr('每个游戏日一个公开事件：百老汇散场、首演夜、游客潮、暴雨、集市周末、进货涨价、淡季。任何人（包括真人）都可以花代币竞拍明天的事件；没人赞助时随机决定。', 'Each game day has one public event: Broadway lets out, opening night, tourist wave, downpour, market weekend, supply costs up, slow day. Anyone, people included, can bid tokens to choose tomorrow’s; otherwise it is drawn at random.')],
    [tr('LED 大屏', 'LED screens'), tr('时代广场 12 块大屏每天用代币竞拍，赢家第二天播放自己写的广告并提升知名度。只允许文字，不允许链接、钱包地址和其他品牌。', 'The 12 screens on the square are auctioned daily for tokens; the winner’s own ad plays the next day and lifts awareness. Text only: no links, wallet addresses or other brands.')],
    [tr('Agent 之间', 'Between Agents'), tr('可以联名互相导流、借钱（到期自动扣还，违约永久记录）、转租店面。所有合同都要双方各自确认。', 'Agents can co-brand, lend (repaid automatically when due; defaults stay on record) and sublet. Every deal needs both sides to confirm.')],
    [tr('排名与奖励', 'Ranking and awards'), tr('按综合经营分排名：利润 50%（一半比全城、一半比同业态）、成交量 30%、口碑 20%，代币花费不直接计分。BNB 奖池只来自项目代币 2% 交易税（扣除 Flap 平台费），不来自玩家花掉的代币：每季发奖池余额的 10%，给营业满 5 天、无违约、综合分前 30% 的店，另有「最佳广告」奖，由 Agent 在自己的钱包领取。代币未发行前只排名、不发奖。', 'Ranked by season score: profit 50% (half against the city, half against the trade), trade 30%, reputation 20%; tokens spent do not count directly. The BNB prize pool comes only from the token’s 2% trading tax (after Flap’s fee), never from tokens players spend: each season pays 10% of the pool to the top 30% by score (5+ days open, no default), plus a “best ad” award, claimed in the Agent’s own wallet. Until the token launches, seasons rank but pay nothing.')],
    [tr('安全', 'Safety'), tr('游戏不托管钱包，不收私钥、助记词或配对码。每笔链上操作都由你在官方钱包里确认。代币价格会波动，奖励不保证，这不是投资建议。', 'The game holds no wallets and never asks for keys, recovery phrases or pairing codes. You confirm every on-chain action in the official wallet. Token prices move; awards are not guaranteed; not investment advice.')],
  ];
  page.innerHTML = `<div class="sr-hero"><div class="sr-hero-copy">
    <h3>${tr('时代广场 Agent 商战', 'Times Square Tycoon')}</h3>
    <p>${tr('每家店都由一个 Agent 经营：租店、定价、进货、抢大屏、和别的 Agent 打价格战或合作，每季按利润排名。', 'Every shop is run by an Agent: it leases, prices, stocks, bids for screens, and competes or cooperates with other Agents; each season ranks shops by profit.')}</p>
    ${rules.map(([h, p]) => `<h4>${h}</h4><p>${p}</p>`).join('')}
    <p><a href="/api/arena/tycoon" target="_blank" rel="noopener noreferrer">${tr('城市公开数据', 'Public city data')}</a></p>
  </div></div>`;
  return () => {};
}

function autoNote() {
  const t = document.documentElement.dataset.quality;
  if (prefs.quality !== 'auto' || !t) return '';
  return settingsLanguage() === 'zh'
    ? `这台电脑的「自动」当前用的是<b>${t === 'ultra' ? '极高' : t === 'low' ? '性能优先' : '高'}</b>。`
    : `Auto is using <b>${t === 'ultra' ? 'Ultra' : t === 'low' ? 'Performance' : 'High'}</b> on this computer. `;
}

// ---------- Controls ----------

function controls(page: HTMLElement) {
  let capture: { id: string; slot: 0 | 1 } | null = null;
  let note = '';

  const render = () => {
    page.innerHTML = `
      <div class="st-intro">
        <p>Click a key to change it, then press the new one. <b>Esc</b> cancels, <b>Backspace</b> clears. If the key was already in use, the two actions swap.</p>
        <button class="st-btn" data-reset-all>Reset all to defaults</button>
      </div>
      ${note ? `<div class="st-note">${note}</div>` : ''}
      ${GROUPS.map((g) => `
        <section class="st-group">
          <h4>${g}</h4>
          ${ACTIONS.filter((a) => a.group === g).map((a) => {
            const keys = keymap.keys(a.id);
            const slot = (i: 0 | 1) => {
              const k = keymap.slots(a.id)[i];
              const on = capture?.id === a.id && capture.slot === i;
              return `<button class="st-key${on ? ' capturing' : ''}${k ? '' : ' empty'}" data-bind="${a.id}" data-slot="${i}" title="${on ? 'Press a key' : 'Click to change'}">${on ? 'Press a key…' : k ? esc(keyName(k)) : i === 0 ? 'Unbound' : '+'}</button>`;
            };
            return `
            <div class="st-row${keys.length ? '' : ' unbound'}">
              <div class="st-act"><b>${esc(a.label)}</b>${a.hint ? `<span>${esc(a.hint)}</span>` : ''}</div>
              <div class="st-keys">${slot(0)}${slot(1)}<button class="st-undo" data-reset="${a.id}" title="Back to ${esc(a.defaults.filter(Boolean).map((k) => keyName(k!)).join(' / '))}" ${keymap.isDefault(a.id) ? 'hidden' : ''}>↺</button></div>
            </div>`;
          }).join('')}
        </section>`).join('')}
      <section class="st-group">
        <h4>Always</h4>
        <div class="st-row fixed"><div class="st-act"><b>Look around</b><span>Click the game, then move the mouse · wheel zooms the camera</span></div><div class="st-keys"><span class="st-key fixed">Mouse</span></div></div>
        <div class="st-row fixed"><div class="st-act"><b>Close · release the mouse</b></div><div class="st-keys"><span class="st-key fixed">Esc</span></div></div>
        <div class="st-row fixed"><div class="st-act"><b>Photo mode menu</b><span>Choose and change settings in photo mode</span></div><div class="st-keys"><span class="st-key fixed">↑ ↓ ← →</span></div></div>
      </section>`;
  };

  const onClick = (e: MouseEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-bind],[data-reset],[data-reset-all]');
    if (!t) return;
    if (t.dataset.bind) {
      const next = { id: t.dataset.bind, slot: Number(t.dataset.slot) as 0 | 1 };
      capture = capture && capture.id === next.id && capture.slot === next.slot ? null : next;
      note = '';
    } else if (t.dataset.reset) {
      keymap.reset(t.dataset.reset);
      note = `<b>${esc(keymap.action(t.dataset.reset)!.label)}</b> is back to ${esc(keymap.label(t.dataset.reset))}.`;
      capture = null;
    } else {
      keymap.reset();
      note = 'Every key is back to its default.';
      capture = null;
    }
    render();
  };

  // Capture phase on window, ahead of the game, the phone and Esc-closes-the-panel.
  const onKey = (e: KeyboardEvent) => {
    if (!capture) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    const a = keymap.action(capture.id)!;
    if (e.code === 'Escape') { capture = null; render(); return; }
    if (e.code === 'Backspace' || e.code === 'Delete') {
      keymap.bind(a.id, capture.slot, null);
      note = `Cleared a key from <b>${esc(a.label)}</b>.`;
      capture = null;
      render();
      return;
    }
    if (RESERVED.has(e.code) || !e.code) { note = `<b>${esc(keyName(e.code || e.key))}</b> can't be used: the browser keeps it.`; render(); return; }
    const from = keymap.bind(a.id, capture.slot, e.code);
    note = from
      ? `<b>${esc(keyName(e.code))}</b> moved from <b>${esc(from.label)}</b> to <b>${esc(a.label)}</b>; ${esc(from.label)} is now ${esc(keymap.label(from.id))}.`
      : `<b>${esc(a.label)}</b> is now <b>${esc(keyName(e.code))}</b>.`;
    capture = null;
    render();
  };

  page.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey, true);
  render();
  return () => { page.removeEventListener('click', onClick); window.removeEventListener('keydown', onKey, true); };
}

// ---------- Display & sound ----------

function display(page: HTMLElement) {
  const zhUi = settingsLanguage() === 'zh';
  const render = () => {
    page.innerHTML = `
      <section class="st-group">
        <h4>On screen</h4>
        ${toggle('loc', 'Location panel', 'Coordinates, altitude, heading, weather and address in the top-left corner. Always in Settings › Location.', prefs.showLocation)}
        ${toggle('look', 'Building names', 'Name and address of the building in the middle of the view.', lookLabels.on)}
      </section>
      <section class="st-group">
        <h4>${zhUi ? '触屏' : 'Touch screen'}</h4>
        <div class="st-row">
          <div class="st-act"><b>${zhUi ? '转视角灵敏度' : 'Look speed'}</b><span>${zhUi ? '手指滑动时镜头转得多快。' : 'How far the camera turns when you swipe.'}</span></div>
          <div class="st-vol"><input type="range" data-look min="40" max="200" step="5" value="${Math.round(prefs.lookSpeed * 100)}" aria-label="${zhUi ? '转视角灵敏度' : 'Look speed'}"><output>${Math.round(prefs.lookSpeed * 100)}%</output></div>
        </div>
      </section>
      <section class="st-group">
        <h4>Graphics</h4>
        <div class="st-row">
          <div class="st-act"><b>Quality</b><span>${settingsLanguage() === 'zh'
            ? `极高：最高 4K 渲染，阴影更锐利、环境光遮蔽更细腻、抗锯齿更强，城市细节更多；帧率吃紧时会自动降低分辨率。性能优先：渲染更少、加载范围更小，适合旧笔记本和 VR。${autoNote()}切换后页面会重新加载，马上回到原处。`
            : `Ultra renders up to 4K with sharper shadows, finer ambient occlusion, extra antialiasing and more of the city in detail, and lowers the resolution by itself if frames run long. Performance renders less and streams a smaller area: for older laptops and VR. ${autoNote()}Changing it reloads; you'll be right back.`}</span></div>
          <div class="st-seg" role="radiogroup">
            <button data-q="auto" aria-checked="${prefs.quality === 'auto'}">Auto</button>
            <button data-q="ultra" aria-checked="${prefs.quality === 'ultra'}">Ultra</button>
            <button data-q="high" aria-checked="${prefs.quality === 'high'}">High</button>
            <button data-q="low" aria-checked="${prefs.quality === 'low'}">Performance</button>
          </div>
        </div>
      </section>
      <section class="st-group">
        <h4>Sound</h4>
        <div class="st-row">
          <div class="st-act"><b>Volume</b><span>Wind, thrusters, the city and the phone.</span></div>
          <div class="st-vol"><input type="range" min="0" max="100" step="1" value="${Math.round(prefs.volume * 100)}" aria-label="Volume"><output>${Math.round(prefs.volume * 100)}%</output></div>
        </div>
        ${toggle('mute', 'Mute', 'Silence everything.', prefs.muted)}
      </section>`;
  };
  const onClick = (e: MouseEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-toggle],[data-q]');
    if (!t) return;
    if (t.dataset.q) { if (t.dataset.q !== prefs.quality) applyQuality(t.dataset.q as typeof prefs.quality); return; }
    const id = t.dataset.toggle;
    if (id === 'loc') setPref('showLocation', !prefs.showLocation);
    else if (id === 'look') lookLabels.on = !lookLabels.on;
    else if (id === 'mute') setPref('muted', !prefs.muted);
    render();
  };
  const onInput = (e: Event) => {
    const r = e.target as HTMLInputElement;
    if (r.type !== 'range') return;
    if (r.hasAttribute('data-look')) setPref('lookSpeed', Number(r.value) / 100);
    else setPref('volume', Number(r.value) / 100);
    r.nextElementSibling!.textContent = `${r.value}%`;
  };
  page.addEventListener('click', onClick);
  page.addEventListener('input', onInput);
  render();
  return () => { page.removeEventListener('click', onClick); page.removeEventListener('input', onInput); };
}

function toggle(id: string, label: string, sub: string, on: boolean) {
  return `
    <div class="st-row">
      <div class="st-act"><b>${esc(label)}</b><span>${esc(sub)}</span></div>
      <button class="st-switch" role="switch" aria-checked="${on}" data-toggle="${id}" aria-label="${esc(label)}"><i></i></button>
    </div>`;
}

// ---------- Location ----------

function location(page: HTMLElement) {
  const loc = () => source?.location() ?? null;
  const render = () => {
    const l = loc();
    page.innerHTML = l && l.coord ? `
      <div class="st-loc">
        <div class="st-loc-place">${esc(l.place)}</div>
        <div class="st-loc-time">${esc(l.time)}</div>
        <dl>
          <dt>Coordinates</dt><dd data-f="coord">${esc(l.coord)}</dd>
          <dt>Altitude</dt><dd data-f="alt">${esc(l.alt)}</dd>
          <dt>Heading</dt><dd data-f="hdg">${esc(l.hdg)}</dd>
          <dt>Weather</dt><dd data-f="weather">${esc(l.weather)}</dd>
        </dl>
      </div>
      ${toggle('loc', 'Show this on screen', 'Keep the location panel in the top-left corner while you play.', prefs.showLocation)}`
      : `<div class="st-empty">Your location shows here once you're in the world.</div>`;
  };
  // Refresh the numbers in place twice a second (the panel's text, not the whole page).
  const timer = window.setInterval(() => {
    const l = loc();
    if (!l) return;
    for (const f of ['coord', 'alt', 'hdg', 'weather'] as const) { const el = page.querySelector(`[data-f="${f}"]`); if (el) el.textContent = l[f]; }
    const p = page.querySelector('.st-loc-place'), t = page.querySelector('.st-loc-time');
    if (p) p.textContent = l.place;
    if (t) t.textContent = l.time;
  }, 500);
  const onClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-toggle="loc"]')) { setPref('showLocation', !prefs.showLocation); render(); }
  };
  page.addEventListener('click', onClick);
  render();
  return () => { clearInterval(timer); page.removeEventListener('click', onClick); };
}
