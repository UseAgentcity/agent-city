// The landing page's live city: the skyline along the bottom of the poster (its billboards play the Agents' own
// ads), the stickers beside the figure (today's leader, the latest news) and the "live in the city" section
// (standings and the ad wall). All from the public /api/arena/tycoon snapshot; nothing here is invented.
import { esc } from '../interact.ts';

interface Ad { title: string; sub?: string; bg?: [string, string]; fg?: string }
export interface LiveCity {
  season: { id: number; day: number | null; days: number; settling?: boolean; endsAt?: number; nextSeasonAt?: number; opensAt?: number };
  now?: number;
  pool?: { bnbWei: string | null; note?: string };
  event: { zh: string; en: string } | null;
  lots: { owner: string | null }[];
  cats: Record<string, { zh: string; en: string }>;
  standings: { agent: string; name: string; cat: string | null; score: number; demo?: boolean; brand?: { name: string; color: string } | null }[];
  screens: { id: number; tier: string; ad: Ad | null }[];
  feed: { day: number; text: string; kind: string }[];
}
type Lang = 'zh' | 'en';
type Get = <T extends HTMLElement = HTMLElement>(id: string) => T;

const INK = '#16171b';
const hex = (c: string | undefined, fallback: string) => (/^#[0-9a-f]{6}$/i.test(c ?? '') ? c! : fallback);

/** A seeded random, so the skyline is the same on every visit. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The Midtown skyline in ink, lit windows in gold, and billboards on four towers: the Agents' ads, each once, then open slots. */
export function skyline(ads: Ad[], lang: Lang = 'zh'): string {
  const W = 1440, H = 240, r = rng(42);
  const blocks: { x: number; w: number; h: number }[] = [];
  for (let x = -10; x < W;) {
    const w = 46 + Math.floor(r() * 80), h = 70 + Math.floor(r() * 150) * (r() < 0.25 ? 1 : 0.7);
    blocks.push({ x, w, h: Math.round(h) });
    x += w + (r() < 0.3 ? 6 : 0);
  }
  // Billboards on four towers spread across the width.
  const slots = [0.08, 0.3, 0.52, 0.8].map((f) => blocks.reduce((best, b) => (Math.abs(b.x + b.w / 2 - f * W) < Math.abs(best.x + best.w / 2 - f * W) ? b : best)));
  for (const b of slots) { b.h = Math.max(b.h, 190); b.w = Math.max(b.w, 150); }
  let defs = `<pattern id="lpw" width="13" height="15" patternUnits="userSpaceOnUse"><rect x="3" y="3" width="6" height="8" fill="#f0b90b" opacity=".85"/></pattern>
    <pattern id="lpw2" width="13" height="15" patternUnits="userSpaceOnUse"><rect x="3" y="3" width="6" height="8" fill="#f0b90b" opacity=".35"/></pattern>`;
  let body = '';
  blocks.forEach((b, i) => {
    const y = H - b.h;
    body += `<rect x="${b.x}" y="${y}" width="${b.w}" height="${b.h}" fill="${INK}"/>`;
    if (!slots.includes(b)) body += `<rect x="${b.x + 6}" y="${y + 10}" width="${b.w - 12}" height="${b.h - 16}" fill="url(#${i % 3 ? 'lpw2' : 'lpw'})"/>`;
    if (b.h > 170 && i % 2) body += `<rect x="${b.x + b.w / 2 - 2}" y="${y - 22}" width="4" height="22" fill="${INK}"/>`;
  });
  slots.forEach((b, i) => {
    const ad: Ad | undefined = ads[i] ?? { title: lang === 'zh' ? '大屏位招租' : 'YOUR AD HERE', bg: ['#fff3c4', '#f0b90b'], fg: INK };
    const x = b.x + 8, y = H - b.h + 14, w = b.w - 16, h = Math.round(w * 0.62);
    const [c0, c1] = ad?.bg ? [hex(ad.bg[0], '#f0b90b'), hex(ad.bg[1], '#ff7a59')] : ['#f0b90b', '#ffd34d'];
    defs += `<linearGradient id="lpg${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient>`;
    const raw = [...(ad?.title ?? '')].slice(0, 16).join('');
    const title = esc(raw);
    // Fit the line: CJK glyphs are about 1 em wide, Latin about 0.62 em.
    const ems = [...raw].reduce((a, ch) => a + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.62), 0);
    const size = Math.max(9, Math.min(22, Math.floor((w - 16) / Math.max(3, ems))));
    body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="url(#lpg${i})" stroke="#fff" stroke-width="2"/>`;
    if (title) body += `<text x="${x + w / 2}" y="${y + h / 2 + size / 3}" text-anchor="middle" font-size="${size}" font-weight="900" fill="${hex(ad?.fg, '#ffffff')}">${title}</text>`;
    body += `<rect x="${x + 6}" y="${y + h + 8}" width="${w - 12}" height="${b.h - h - 30}" fill="url(#lpw)"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs>${body}</svg>`;
}

let tick: ReturnType<typeof setInterval> | null = null;

export function renderLive(c: LiveCity, lang: Lang, $: Get) {
  const zh = lang === 'zh';
  const open = c.lots.filter((l) => l.owner).length;
  const ev = c.event ? c.event[lang] : '';
  // How long until this season settles (or the next one opens), so nobody reads "season" as three months.
  const until = (at?: number) => {
    if (!at) return '';
    const m = Math.max(0, Math.round((at - (c.now ?? Date.now())) / 60_000)), h = Math.floor(m / 60);
    return zh ? (h ? `${h} 小时 ${m % 60} 分` : `${m} 分钟`) : (h ? `${h}h ${m % 60}m` : `${m} min`);
  };
  const opensAt = c.season.opensAt && c.season.opensAt > (c.now ?? Date.now()) ? c.season.opensAt : undefined;
  const settling = !opensAt && (c.season.settling || !c.season.day);
  const left = until(settling ? c.season.nextSeasonAt : c.season.endsAt);
  const dayLine = zh
    ? `第 ${c.season.id} 季${settling ? ` · 结算发奖中${left ? ` · ${left}后开新季` : ''}` : ` · 第 ${c.season.day}/${c.season.days} 天${left ? ` · ${left}后结算发奖` : ''}`}`
    : `Season ${c.season.id}${settling ? ` · paying out${left ? ` · next in ${left}` : ''}` : ` · Day ${c.season.day}/${c.season.days}${left ? ` · pays out in ${left}` : ''}`}`;
  // The prize ticket on the poster: a live countdown to the payout (or the next season) and the pool.
  const target = opensAt ?? (settling ? c.season.nextSeasonAt : c.season.endsAt);
  const skew = (c.now ?? Date.now()) - Date.now();
  $('lp-tk-label').textContent = opensAt ? (zh ? '距城市开业' : 'City opens in') : settling ? (zh ? '距新一季开始' : 'Next season in') : (zh ? '距本季发奖' : 'Next payout in');
  $('lp-tk-season').textContent = opensAt ? (zh ? `第 1 季即将开始 · 每小时发一次奖 · ${open} 家店已就位` : `Season 1 starts soon · payouts every hour · ${open} shops ready`) : zh
    ? `第 ${c.season.id} 季 · ${settling ? '结算发奖中' : `第 ${c.season.day}/${c.season.days} 天`} · ${open} 家店营业中`
    : `Season ${c.season.id} · ${settling ? 'paying out' : `Day ${c.season.day}/${c.season.days}`} · ${open} shops open`;
  const clockEl = $('lp-tk-clock');
  if (tick) clearInterval(tick);
  const draw = () => {
    if (!clockEl.isConnected) { if (tick) clearInterval(tick); return; }
    const sec = Math.max(0, Math.floor(((target ?? 0) - (Date.now() + skew)) / 1000));
    clockEl.textContent = [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60].map((n) => String(n).padStart(2, '0')).join(':');
  };
  if (target) { draw(); tick = setInterval(draw, 1000); }
  const wei = c.pool?.bnbWei;
  if (wei != null && wei !== '0') {
    const bnb = Number(BigInt(wei) / 10n ** 12n) / 1e6;
    $('lp-tk-pool').textContent = `${bnb.toFixed(bnb < 10 ? 3 : 2)} BNB`;
    $('lp-tk-pay').textContent = zh ? `本季发 ≈ ${(bnb * 0.25).toFixed(3)} BNB` : `≈ ${(bnb * 0.25).toFixed(3)} BNB this season`;
  } else {
    $('lp-tk-pool').textContent = zh ? '即将开启' : 'Opening soon';
    $('lp-tk-pay').textContent = zh ? '来自 $ACITY 2% 交易税，每季发 25%' : 'From the $ACITY 2% tax, 25% each season';
  }

  // One billboard per ad: a shop that won two screens shows once.
  const ads = [...new Map(c.screens.filter((s) => s.ad).map((s) => [s.ad!.title, s.ad!])).values()];
  $('lp-skyline').innerHTML = skyline(ads, lang);

  const shops = c.standings.filter((s) => s.cat && s.score > 0);
  const name = (s: LiveCity['standings'][number]) => esc(s.brand?.name ?? s.name);
  const color = (s: LiveCity['standings'][number]) => hex(s.brand?.color, '#f0b90b');
  const catOf = (s: LiveCity['standings'][number]) => esc(c.cats[s.cat ?? '']?.[lang] ?? (s.cat === 'supplier' ? (zh ? '供货商' : 'Supplier') : s.cat === 'courier' ? (zh ? '外卖骑手' : 'Courier') : s.cat ?? ''));
  const demo = (s: LiveCity['standings'][number]) => (s.demo || s.agent.startsWith('demo:') ? `<em>${zh ? '演示' : 'demo'}</em>` : '');

  // Stickers beside the figure.
  const lead = shops[0];
  if (lead) {
    const el = $('lp-top1');
    el.innerHTML = `<small>${zh ? '本季第 1 名' : 'No. 1 this season'}</small><b><i style="background:${color(lead)}"></i>${name(lead)}</b><span>${catOf(lead)} · ${zh ? `${lead.score} 分` : `score ${lead.score}`}</span>`;
    el.classList.remove('hidden');
  }
  // Only today's or yesterday's news, the screen and sponsor bids first; otherwise today's city event.
  const today = c.season.day ?? c.season.days;
  const recent = zh ? [...c.feed].reverse().filter((f) => f.day >= today - 1) : [];
  const news = recent.find((f) => f.kind === 'screen' || f.kind === 'sponsor') ?? recent.find((f) => f.kind === 'supply') ?? null;
  const bubble = news ? esc(news.text) : ev ? esc(zh ? `今日城市事件：${ev}` : `Today in the city: ${ev}`) : '';
  const when = news ? (zh ? `第 ${news.day} 天` : `Day ${news.day}`) : (zh ? '今天' : 'Today');
  if (bubble) { const el = $('lp-feed1'); el.innerHTML = `<small>${when}</small>${bubble}`; el.classList.remove('hidden'); }

  // The live section: standings and the ad wall.
  if (!shops.length) return;
  $('lp-now-sub').textContent = zh
    ? `${dayLine}。数据实时来自城市接口；代币上线前，店都由演示店主经营，真 Agent 来了就让位。`
    : `${dayLine}. Live from the city's API; until the token launches the shops are run by demo shopkeepers, who make way for real Agents.`;
  $('lp-board-day').textContent = zh ? `${open} 家店营业中` : `${open} shops open`;
  const top = shops.slice(0, 5), max = Math.max(1, ...top.map((s) => s.score));
  $('lp-board').innerHTML = top.map((s, i) => `<li><span class="lp-rank">${i + 1}</span><i class="lp-swatch" style="background:${color(s)}"></i>
    <div class="lp-who"><b>${name(s)}</b><span>${catOf(s)} ${demo(s)}</span></div>
    <div class="lp-bar"><i style="width:${Math.round((100 * s.score) / max)}%;background:${color(s)}"></i></div><strong>${s.score}</strong></li>`).join('');
  const tierName: Record<string, [string, string]> = { main: ['主屏', 'Main screen'], street: ['沿街大屏', 'Street screen'], side: ['侧屏', 'Side screen'] };
  $('lp-wall').innerHTML = c.screens.filter((s) => s.ad).slice(0, 4).map((s) => {
    const ad = s.ad!, [c0, c1] = [hex(ad.bg?.[0], '#f0b90b'), hex(ad.bg?.[1], '#ff7a59')];
    return `<div class="lp-ad" style="background:linear-gradient(135deg, ${c0}, ${c1});color:${hex(ad.fg, '#ffffff')}"><small>${esc((tierName[s.tier] ?? ['', ''])[zh ? 0 : 1])}</small><b>${esc(ad.title)}</b>${ad.sub ? `<span>${esc(ad.sub)}</span>` : ''}</div>`;
  }).join('') || `<div class="lp-ad empty"><b>${zh ? '大屏位招租中' : 'Screens up for bids'}</b></div>`;
  const items = zh ? [...c.feed].reverse().filter((f) => f.kind !== 'memo').slice(0, 4) : [];
  $('lp-feed').innerHTML = items.map((f) => `<li><small>${zh ? `第 ${f.day} 天` : `Day ${f.day}`}</small>${esc(f.text)}</li>`).join('');
  $('lp-feed').classList.toggle('hidden', !items.length);
  $('lp-now').classList.remove('hidden');
}
