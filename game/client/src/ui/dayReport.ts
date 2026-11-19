// Closing time: when a game day is settled (every few minutes) a card slides in with the day's results —
// the busiest shops, tokens burned that day and what tomorrow brings; at season's end, the final top three.
// Tap it for the standings. It stays out of the way: a few seconds, then gone.
import { esc } from '../interact.ts';
import { t } from '../i18n.ts';
import { burnLine, eventName, onTycoon, tokensShort, tycoon } from './tycoon.ts';

export function installDayReport(host: HTMLElement, openRanking: () => void) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'ty-report';
  host.appendChild(el);
  el.addEventListener('click', () => { hide(); openRanking(); });
  let last: string | null = null, burned = 0, timer = 0;
  let openDistricts: Set<string> | null = null;
  const hide = () => { el.classList.remove('on'); clearTimeout(timer); };

  function show(html: string) {
    el.innerHTML = html;
    el.classList.add('on');
    clearTimeout(timer);
    timer = window.setTimeout(hide, 9000);
  }

  onTycoon(() => {
    const c = tycoon();
    if (!c) return;
    const s = c.season;
    // A new district opening is news: say so, whatever else is happening.
    const nowOpen = new Set(Object.entries(c.districts).filter(([, d]) => d.open !== false).map(([id]) => id));
    const fresh = openDistricts ? [...nowOpen].filter((id) => !openDistricts!.has(id)) : [];
    openDistricts = nowOpen;
    if (fresh.length) {
      const names = fresh.map((id) => { const d = c.districts[id as keyof typeof c.districts]; return t(d.zh, d.en); });
      const lots = c.lots.filter((l) => fresh.includes(l.district)).length;
      show(`<span class="ty-r-k">${t('新街区开放', 'New district open')}</span>
        <ol><li><i>+</i><b>${esc(names.join(' · '))}</b><em>${t(`${lots} 个店面`, `${lots} storefronts`)}</em></li></ol>
        <span class="ty-r-f">${t('现有店面租满了，城市长大了。', 'The storefronts ran out, so the city grew.')}</span>`);
      return;
    }
    const mark = `${s.id}:${s.settling ? 'end' : s.resolved}`;
    const before = burned;
    burned = c.tokenEconomy.burned;
    // The first snapshot only sets the baseline; a new season's opening isn't a closing.
    if (last === null || last === mark) { last = mark; return; }
    const prevSeason = Number(last.split(':')[0]);
    last = mark;
    if (prevSeason !== s.id) return;
    const today = before ? Math.max(0, burned - before) : 0;
    if (s.settling) {
      const top = c.standings.filter((x) => x.score > 0).slice(0, 3);
      show(`<span class="ty-r-k">${t(`第 ${s.id} 季收官`, `Season ${s.id} closed`)}</span>
        <ol>${top.map((x, i) => `<li><i>${i + 1}</i><b>${esc(x.brand?.name ?? x.name)}</b><em>${t(`${x.score} 分`, `${x.score} pts`)}</em></li>`).join('')}</ol>
        <span class="ty-r-f">${burnLine(c)} · ${t('前 30% 从 BNB 奖池分奖', 'Top 30% share the BNB prize pool')}</span>`);
      return;
    }
    const busiest = c.standings.filter((x) => x.today?.served).sort((a, b) => b.today!.served - a.today!.served).slice(0, 3);
    if (!busiest.length) return;
    show(`<span class="ty-r-k">${t(`第 ${s.resolved} 天收市`, `Day ${s.resolved} closed`)}</span>
      <ol>${busiest.map((x, i) => `<li><i>${i + 1}</i><b>${esc(x.brand?.name ?? x.name)}</b><em>${t(`${x.today!.served.toLocaleString('en-US')} 单`, `${x.today!.served.toLocaleString('en-US')} served`)}</em></li>`).join('')}</ol>
      <span class="ty-r-f">${today ? t(`今天销毁 ${tokensShort(today)} 代币`, `${tokensShort(today)} tokens burned today`) + ' · ' : ''}${t(`第 ${s.day} 天`, `Day ${s.day}`)}：${esc(eventName(c.event))}</span>`);
  });
}
