// First visit to Times Square: four short steps that show a person what the city is about, then get
// out of the way. Look at the screens, visit a shop, change vehicle, open the phone.
import { t } from '../i18n.ts';

const KEY = 'open-world-tycoon-guide';

export interface GuideState {
  /** The nearest open shop and how far its door is (m), or null before the city has loaded. */
  shop: { name: string; dist: number } | null;
  /** A shop page was opened (by E at a door or from the phone). */
  shopViewed: boolean;
  vehicleChanged: boolean;
  phoneOpened: boolean;
  touch: boolean;
}

export function installGuide(hud: HTMLElement) {
  let finished = false;
  try { finished = localStorage.getItem(KEY) === 'done'; } catch { /* private mode */ }
  const el = document.createElement('div');
  el.className = 'ac-guide hidden';
  el.innerHTML = '<span class="ac-g-n"></span><span class="ac-g-t"></span><button type="button" class="ac-g-x"></button>';
  const step = el.querySelector<HTMLElement>('.ac-g-n')!;
  const text = el.querySelector<HTMLElement>('.ac-g-t')!;
  const skip = el.querySelector<HTMLButtonElement>('.ac-g-x')!;
  skip.textContent = t('跳过', 'Skip');
  hud.appendChild(el);
  let stage = 0, shown = 0;

  function finish() {
    finished = true;
    el.classList.add('hidden');
    try { localStorage.setItem(KEY, 'done'); } catch { /* this visit only */ }
  }
  skip.addEventListener('click', finish);
  return {
    finish,
    update(dt: number, s: GuideState) {
      if (finished) return;
      shown += dt;
      // Advance on what the person actually did.
      if (stage === 0 && shown > 9) stage = 1;
      if (stage === 1 && s.shopViewed) stage = 2;
      if (stage === 2 && s.vehicleChanged) stage = 3;
      if (stage === 3 && s.phoneOpened) { finish(); return; }
      let line: string;
      if (stage === 0) line = t('抬头看大屏：上面的广告是 Agent 自己写、自己竞拍来的', 'Look up at the screens: Agents write those ads and bid for them');
      else if (stage === 1) {
        if (!s.shop) line = t('时代广场的每家店都由一个 Agent 经营，正在找最近的店…', 'Every shop here is run by an Agent. Finding the nearest one…');
        else if (s.shop.dist > 6) line = t(`走到最近的店「${s.shop.name}」（${Math.round(s.shop.dist)} 米）`, `Walk to the nearest shop, “${s.shop.name}” (${Math.round(s.shop.dist)} m)`);
        else line = s.touch ? t('点「互动」，看这家店今天的生意', 'Tap Use to see how this shop is doing today') : t('按 E 看这家店今天的生意', 'Press E to see how this shop is doing today');
      } else if (stage === 2) line = s.touch ? t('点交通工具按钮换一种走法，去剧院区和集市逛逛', 'Tap a vehicle to get around: try the Theater District and the market') : t('按 1–8 换交通工具：3 骑车、4 开车、5 开飞机看全城', 'Press 1–8 for vehicles: 3 bike, 4 jeep, 5 plane over the city');
      else line = s.touch ? t('点手机图标，看排行榜和大屏竞拍', 'Tap the phone for standings and the screen auction') : t('按 P 打开手机，看排行榜、大屏竞拍和怎么派你的 Agent', 'Press P for standings, the screen auction and how to send your Agent');
      const n = `${stage + 1}/4`;
      if (step.textContent !== n) step.textContent = n;
      if (text.textContent !== line) text.textContent = line;
      el.classList.remove('hidden');
    },
  };
}
