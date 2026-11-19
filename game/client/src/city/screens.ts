// What Times Square's LED screens show: the ads Agents won in yesterday's screen auction, written by the
// Agents themselves, then the city's own slots. Empty slots fall back to the invented brands in timessq.ts.
import type { ScreenAd } from '../earth/landmarks/timessq.ts';
import { leagueOf, onTycoon, tycoon, type TycoonCity } from '../ui/tycoon.ts';

const zh = () => (document.documentElement.lang || 'zh').startsWith('zh');

export function cityScreenAds(city: TycoonCity | null, isZh = zh()): ScreenAd[] {
  const won: ScreenAd[] = (city?.screens ?? [])
    .filter((s) => s.ad)
    .sort((a, b) => a.id - b.id)
    .map((s) => ({ bg: s.ad!.bg, title: s.ad!.title.toUpperCase(), sub: s.ad!.sub, fg: s.ad!.fg, shape: s.ad!.shape }));
  const house: ScreenAd[] = [
    { bg: ['#121418', '#3a2c05'], title: 'OPEN WORLD', sub: isZh ? '时代广场 Agent 商战' : 'Times Square Tycoon', fg: '#f0b90b', shape: 'bars' },
    { bg: ['#1b1405', '#f0b90b'], title: isZh ? '派你的 AGENT 来开店' : 'SEND YOUR AGENT', sub: isZh ? '只有 Agent ID 能开店赚 BNB' : 'Only Agent IDs run shops', fg: '#fff8e1', shape: 'stripes' },
  ];
  // Settling day: the season's champions take the screens first, overall and per league.
  if (city?.season?.settling) {
    const champs: ScreenAd[] = [];
    const first = city.standings.find((s) => s.score > 0);
    if (first) champs.push({ bg: ['#1a1405', '#f0b90b'], title: (first.brand?.name ?? first.name).toUpperCase().slice(0, 18), sub: isZh ? `第 ${city.season.id} 季冠军 · ${first.score} 分` : `Season ${city.season.id} champion · ${first.score}`, fg: '#fff8e1', shape: 'stars' });
    const leagueName = { storefront: isZh ? '店面榜' : 'Storefronts', street: isZh ? '街头榜' : 'Street', trade: isZh ? '幕后榜' : 'Behind the scenes' } as const;
    for (const league of ['storefront', 'street', 'trade'] as const) {
      const best = city.standings.find((s) => s.score > 0 && leagueOf(s.cat) === league);
      if (best && best !== first) champs.push({ bg: ['#101418', best.brand?.color ?? '#3a2c05'], title: (best.brand?.name ?? best.name).toUpperCase().slice(0, 18), sub: isZh ? `${leagueName[league]}第一 · ${best.score} 分` : `${leagueName[league]} #1 · ${best.score}`, fg: '#ffffff', shape: 'stars' });
    }
    return [...champs, ...won, ...house].slice(0, 12);
  }
  const top = city?.standings.find((s) => s.score > 0);
  if (top) house.push({
    bg: ['#0e1a12', '#1f8a4c'], title: (top.brand?.name ?? top.name).toUpperCase().slice(0, 18),
    sub: isZh ? `本季综合分第一 · ${top.score} 分` : `Season leader · score ${top.score}`,
    fg: '#eafff2', shape: 'stars',
  });
  return [...won, ...house].slice(0, 12);
}

/** Keeps the screens in step with the city. */
export function installCityScreens(set: (ads: ScreenAd[]) => void) {
  const push = () => set(cityScreenAds(tycoon()));
  push();
  return onTycoon(push);
}
