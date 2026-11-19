// Map tiles that failed to load leave bare ground: say so, and offer a retry, instead of a silently empty city.
import { t } from '../i18n.ts';
import './tileWarn.css';

export function installTileWarn(earth: { missingTiles(): number; retryTiles(): void }) {
  const el = document.createElement('div');
  el.id = 'tile-warn';
  el.className = 'hidden';
  el.setAttribute('role', 'status');
  document.body.appendChild(el);
  let shown = -1;
  const render = (n: number) => {
    if (n === shown) return;
    shown = n;
    el.classList.toggle('hidden', n === 0);
    if (!n) return;
    el.innerHTML = `<span class="tw-dot"></span><span class="tw-txt"><b>${t('地图数据加载失败', 'Map data failed to load')}</b><small>${t(`附近 ${n} 个街区暂时没有建筑和道路，正在自动重试`, `${n} nearby block${n === 1 ? '' : 's'} have no buildings or roads yet; retrying automatically`)}</small></span><button type="button">${t('立即重试', 'Retry now')}</button>`;
    el.querySelector('button')!.addEventListener('click', () => {
      earth.retryTiles();
      el.querySelector('button')!.textContent = t('重试中…', 'Retrying…');
    });
  };
  const iv = setInterval(() => render(earth.missingTiles()), 1500);
  return { dispose() { clearInterval(iv); el.remove(); } };
}
