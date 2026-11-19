// Chinese names for real places on the map, for the HUD when the client is in Chinese. Most come
// from the tiles' OSM `name:zh` tags (collected as chunks load); roads rarely have one, so the main
// Dubai roads are listed here. Anything unknown keeps its map name.
import { isZh } from '../i18n.ts';

const ROADS: Record<string, string> = {
  'Sheikh Mohammed bin Rashid Boulevard': '谢赫·穆罕默德·本·拉希德大道',
  'Sheikh Zayed Road': '谢赫·扎耶德路',
  'Financial Centre Road': '金融中心路',
  'Al Khail Road': '阿尔海尔路',
  'Emaar Boulevard': '伊玛尔大道',
  'Burj Khalifa Boulevard': '哈利法塔大道',
  'Al Asayel Street': '阿萨耶尔街',
  'Happiness Street': '幸福街',
  'Al Saada Street': '萨达街',
  'Doha Street': '多哈街',
  'Al Wasl Road': '瓦斯尔路',
  'Jumeirah Road': '朱美拉路',
  'Al Mustaqbal Street': '未来街',
  'Marasi Drive': '马拉西大道',
  'Al Sukook Street': '苏库克街',
  'Business Bay Crossing': '商业湾大桥',
  'Al Meydan Road': '梅丹路',
  'Oud Metha Road': '乌德梅塔路',
  'Al Maktoum Road': '马克图姆路',
  'Al Ittihad Road': '联合路',
  'Downtown Dubai': '迪拜市中心',
  'Business Bay': '商业湾',
  'Dubai': '迪拜',
};
const DIR: Record<string, string> = { north: '北行', south: '南行', east: '东行', west: '西行' };

// OSM's zh names are often Traditional (and Taiwanese usage, 杜拜): show Simplified.
const TRAD = '爾業鐵噴樂競場聯園廈劇購運灣館飯學國門東區廣際華為號橋車島體術醫藥銀貿雲風龍鳳書畫藝電訊網絡線機療診廳樓層莊塊產權幣點廚麵湯燒雞魚蝦豬鴨飲開關廠發覽會議總統務處員達邁蘭維亞歐羅馬薩';
const SIMP = '尔业铁喷乐竞场联园厦剧购运湾馆饭学国门东区广际华为号桥车岛体术医药银贸云风龙凤书画艺电讯网络线机疗诊厅楼层庄块产权币点厨面汤烧鸡鱼虾猪鸭饮开关厂发览会议总统务处员达迈兰维亚欧罗马萨';
const T2S: Record<string, string> = Object.fromEntries([...TRAD].map((c, i) => [c, SIMP[i]]));
const simp = (s: string) => s.replace(/杜拜/g, '迪拜').replace(/./gu, (c) => T2S[c] ?? c);

const known = new Map<string, string>(Object.entries(ROADS));
const cache = new Map<string, string>();

/** Pairs from a chunk: [english, chinese, …]. */
export function addZhNames(pairs: string[]) {
  let added = false;
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    if (known.has(pairs[i])) continue;
    known.set(pairs[i], simp(pairs[i + 1]));
    added = true;
  }
  if (added) cache.clear();
}

function one(s: string): string {
  const hit = known.get(s);
  if (hit) return hit;
  const m = /^(.*\S)\s*\((north|south|east|west)\)$/i.exec(s);
  if (m && known.has(m[1])) return `${known.get(m[1])}（${DIR[m[2].toLowerCase()]}）`;
  return s;
}

/** A HUD line ("Building on X · Downtown Dubai, Dubai") with every name we know in Chinese. */
export function zhPlace(text: string): string {
  if (!text || !isZh()) return text;
  let out = cache.get(text);
  if (out !== undefined) return out;
  out = text.split(/(\s*[·,]\s*)/).map((part, i) => {
    if (i % 2) return part;
    const whole = one(part);
    if (whole !== part) return whole;
    // "Building on X", "Near X": translate the name inside the phrase.
    const m = /^(.*?\b(?:on|near|at|of)\s+)(.+)$/.exec(part);
    if (m) { const n = one(m[2]); if (n !== m[2]) return m[1] + n; }
    return part;
  }).join('');
  if (cache.size > 500) cache.clear();
  cache.set(text, out);
  return out;
}
