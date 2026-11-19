// Chinese for UI text that is written in English. Proper names (OpenStreetMap POIs, streets,
// addresses, company names) are left as they are; only names with a standard Chinese form are listed.
import { addPatterns, addText } from './i18n.ts';

const DIR: Record<string, string> = { N: '北', NE: '东北', E: '东', SE: '东南', S: '南', SW: '西南', W: '西', NW: '西北' };

addText([
  // Vehicles and movement
  ['On foot', '步行'], ['Skate', '滑板'], ['Skateboard', '滑板'], ['Bike', '自行车'], ['Jeep', '吉普车'], ['Plane', '飞机'], ['Prop plane', '螺旋桨飞机'],
  ['Kayak', '皮划艇'], ['Boat', '快艇'], ['Shuttle', '航天飞机'], ['Space shuttle', '航天飞机'], ['swimming', '游泳中'], ['in the air', '空中'], ['In the air', '空中'],
  ['Over open water', '开阔水域上空'],
  ['No water nearby for the kayak.', '附近没有水面，不能用皮划艇。'], ['No water nearby for the boat.', '附近没有水面，不能开船。'],
  ['Not enough clear, flat ground to take off here. Try a park, a wide road or the air.', '这里没有足够平坦开阔的地面起飞。去公园、宽阔道路，或者在空中再试。'],
  ['Too close to the ground for the wingsuit.', '离地面太近，不能打开翼装。'],
  ['Autopilot off.', '自动驾驶已关闭。'], ['Autopilot off: not flying.', '自动驾驶已关闭：当前不在飞行。'], ['You have the controls.', '已交还操控。'],
  ['Time-lapse off', '延时摄影已关闭'],
  // Buildings
  ['house', '住宅'], ['apartments', '公寓楼'], ['offices', '写字楼'], ['shop', '商店'], ['mall', '商场'], ['church', '宗教场所'], ['warehouse', '仓库'], ['tower', '塔楼'],
  ['House', '住宅'], ['Apartments', '公寓楼'], ['Offices', '写字楼'], ['Office tower', '办公塔楼'], ['Shop', '商店'], ['Shopping mall', '购物中心'],
  ['Church', '宗教场所'], ['Storage warehouse', '仓库'], ['Building', '建筑'],
  ['Skyscraper HQ', '摩天总部'], ['Tower', '塔楼'], ['Office building', '办公楼'], ['Storefront', '临街店铺'], ['Storefront studio', '临街工作室'],
  ['Go inside', '进入'], ['Go outside', '出去'], ['Jump out the window', '从窗户跳出去'], ['Inside the building', '建筑内部'],
  ['ground floor', '首层'], ['Ground floor', '首层'], ['lobby', '大堂'], ['guest rooms', '客房'], ['the store', '店铺'],
  ['Roof terrace', '屋顶露台'], ['step outside on top', '到楼顶外面'], ['step outside on top of the tower', '到塔顶外面'],
  ['thrusters ready', '推进器就绪'],
  // Lift
  ['Call the lift', '呼叫电梯'], ['Choose a floor', '选择楼层'], ['Lift', '电梯'],
  // HUD and navigation
  ['You have arrived', '已到达'], ['Straight ahead', '正前方'], ['Behind you', '在你身后'], ['Bear left', '稍向左'], ['To your left', '在你左边'],
  ['Bear right', '稍向右'], ['To your right', '在你右边'], ['Waypoint set:', '已设置路标：'], ['Flying to', '正在飞往'], ['Arrived at', '已到达'],
  ['Arrived over', '已到达上空：'], ['Autopilot to', '自动驾驶前往'], [': climbing out.', '：正在爬升。'], ['. You have the controls.', '。已交还操控。'],
  ['Dropped pin', '标记点'], ['Back to you', '回到我的位置'],
  // Weather
  ['Sunny', '晴'], ['Mostly sunny', '大部晴朗'], ['Partly sunny', '晴间多云'], ['Partly cloudy', '局部多云'], ['Mostly cloudy', '大部多云'],
  ['Light breeze, clear', '微风，晴朗'], ['Clear', '晴朗'], ['Mostly clear', '大部晴朗'], ['Partly clear', '晴间多云'], ['Light rain', '小雨'], ['Heavy rain', '大雨'], ['Rain', '雨'],
  ['Light snow', '小雪'], ['Heavy snow', '大雪'], ['Snow', '雪'], ['Thunderstorms', '雷暴'], ['Fog', '雾'], ['Dust storm', '沙尘暴'], ['Overcast', '阴'],
  // World map
  ['Clouds', '云层'], ['☁ Clouds', '☁ 云层'], ['⛈ Rain & storms', '⛈ 降雨与风暴'], ['🌬 Wind', '🌬 风'], ['Map', '地图'], ['Places', '地点'], ['Settings', '设置'],
  ['🛰 Satellite', '🛰 卫星图'], ['🗺 Street map', '🗺 街道图'], ['Street map / satellite', '街道图 / 卫星图'], ['Search anywhere on Earth', '搜索地球上的任何地方'],
  ['Teleport inside', '传送进入'], ['Click one of your buildings on the map, or pick it here.', '在地图上点一栋建筑，或在这里选择。'], ['Find a building', '查找建筑'],
  ['Click to teleport inside', '点击传送进入'], ['No places found.', '没有找到地点。'], ['Your projects', '建筑'],
  ['Time of day', '时间'], ['Time speed', '时间流速'], ['Fast', '快'], ['Normal', '正常'], ['Weather', '天气'], ['Units', '单位'], ['Building names', '建筑名称'],
  ['Street signs', '路牌'], ['VR headset', 'VR 头显'], ['VR view', 'VR 视角'], ['First person', '第一人称'], ['Behind robot', '机器人身后'], ['On', '开'], ['Off', '关'],
  ['Metric', '公制'], ['Imperial', '英制'], ['Live', '实时'],
  // Photo mode
  ['Depth of field', '景深'], ['Focus', '对焦'], ['Zoom', '缩放'], ['Grid', '网格'], ['Your photos will show up here.', '拍的照片会显示在这里。'],
  ['choose', '选择'], ['change', '调整'], ['take the picture', '拍照'], ['open', '打开'], ['Saved to Photos', '已保存到相册'],
  // Keys and actions (settings → controls)
  ['Move forward', '前进'], ['Gas, pedal, throttle up, dive the wingsuit', '油门、蹬车、加速、翼装俯冲'], ['Move back', '后退'], ['Brake, reverse, throttle down', '刹车、倒车、减速'],
  ['Move left', '向左'], ['Move right', '向右'], ['Steer, bank, carve', '转向、侧倾、压弯'], ['Run', '跑'], ['Afterburner, boost, sprint', '加力、加速、冲刺'], ['Jump', '跳'],
  ['Hold in the air to fire the thrusters · ollie, handbrake, pull up', '在空中按住启动推进器 · 豚跳、手刹、拉起'], ['Interact', '交互'], ['Enter buildings, talk, use', '进入建筑、对话、使用'],
  ['Wave', '挥手'], ['Sit down', '坐下'], ['Cut the thrusters', '关闭推进器'], ['Dive · push the nose down', '俯冲 · 压低机头'], ['Wingsuit', '翼装'], ['Open or stow it in the air', '在空中打开或收起'],
  ['Autopilot', '自动驾驶'], ['Fly to the waypoint', '飞往路标'], ['Phone', '手机'], ['Agents, projects, maps, home', '比赛、Agent、动态、地图'], ['Directory', '目录'],
  ['Your projects · fast travel', '建筑 · 快速传送'], ['Photo mode', '拍照模式'], ['Time-lapse', '延时摄影'], ['Skip 3 hours ahead', '快进 3 小时'], ['Get off · bail out', '下车 · 跳伞'],
  ['Moving', '移动'], ['Flying', '飞行'], ['World', '世界'], ['Vehicles', '交通工具'],
  // Loading
  ['Filling the streets…', '正在布置街道…'], ['Streaming the map…', '正在加载地图…'], ['Flying there…', '正在飞过去…'], ['Preparing Agent Tower…', '正在准备 Agent 大厦…'],
  // Arena tower card in the city
  ['Unofficial Agent competition venue. Verified .ai participants; the prize pool is the on-chain vault.', '非官方 Agent 竞技场馆。参赛者经 .ai 身份验证；奖池以链上金库为准。'],
  ['Agent Economy', 'Agent 经济'],
  // Landmarks with a standard Chinese name
  ['Times Square', '时代广场'], ['Central Park', '中央公园'], ['Golden Gate Bridge', '金门大桥'], ['Russian Hill', '俄罗斯山'], ['Hollywood Sign', '好莱坞标志'],
  ['Grand Canyon', '大峡谷'], ['Niagara Falls', '尼亚加拉瀑布'], ['Copacabana', '科帕卡巴纳'], ['Machu Picchu', '马丘比丘'], ['Big Ben', '大本钟'],
  ['Eiffel Tower', '埃菲尔铁塔'], ['Colosseum', '罗马斗兽场'], ['Santorini', '圣托里尼'], ['Burj Khalifa', '哈利法塔'], ['Downtown Dubai', '迪拜市中心'],
  ['Dubai Marina', '迪拜码头'], ['Dubai, UAE', '阿联酋迪拜'], ['Dubai Mall', '迪拜购物中心'], ['The Dubai Mall', '迪拜购物中心'], ['Dubai Fountain', '迪拜音乐喷泉'], ['The Dubai Fountain', '迪拜音乐喷泉'],
  ['Shibuya Crossing', '涩谷十字路口'], ['Mount Fuji', '富士山'], ['Marina Bay', '滨海湾'], ['Singapore', '新加坡'], ['Victoria Harbour', '维多利亚港'],
  ['Sydney Opera House', '悉尼歌剧院'], ['Table Mountain', '桌山'], ['Pyramids of Giza', '吉萨金字塔'], ['New York City', '纽约'], ['San Francisco', '旧金山'],
  ['Miami', '迈阿密'], ['Boston', '波士顿'], ['Dubai', '迪拜'],
]);

addPatterns([
  [/^(\d+) floors?$/, '$1 层'],
  [/^(?:Floor|floor) (\d+)$/, '$1 楼'],
  [/^Building on (.+)$/, '$1 旁的建筑'],
  [/^Go inside (.+)$/, '进入 $1'],
  [/^Enter (.+)$/, '进入 $1'],
  [/^(.+) HQ$/, '$1 总部'],
  [/^(\d+):(\d{2}) (AM|PM)$/, (_m, h, mm, ap) => `${String((Number(h) % 12) + (ap === 'PM' ? 12 : 0)).padStart(2, '0')}:${mm}`],
  [/^(\S+) to skip ahead$/, '按 $1 快进'],
  [/^wind (.+) from the (N|NE|E|SE|S|SW|W|NW)$/, (_m, v, d) => `${DIR[d]}风 ${v}`],
  [/^([\d.,]+ (?:km|m|mi|ft)) away$/, '距离 $1'],
  [/^Finding (.+) on the map…$/, '正在地图上查找 $1…'],
  [/^Streaming (.+) from OpenStreetMap…$/, '正在从 OpenStreetMap 加载 $1…'],
  [/^Streaming the map: tiles (\d+)\/(\d+)…$/, '正在加载地图：瓦片 $1/$2…'],
  [/^Streaming (.+): map tiles (\d+)\/(\d+)…$/, '正在加载 $1：地图瓦片 $2/$3…'],
  [/^Looking farther out for buildings \((\d+) m\)…$/, '正在向外查找建筑（$1 米）…'],
  [/^Couldn't get there: (.+)$/, '无法到达：$1'],
  [/^Couldn't go inside: (.+)$/, '无法进入：$1'],
  [/^Time-lapse on \((.+) to stop\)$/, '延时摄影已开启（按 $1 停止）'],
  [/^Time-lapse on \($/, '延时摄影已开启（按'],
  [/^to stop\)$/, '停止）'],
  [/^Welcome back\. You're where you left off:$/, '欢迎回来。你回到了上次的位置：'],
  [/^\. Press$/, '。按'],
  [/^at the door\.$/, '在门口进入。'],
  [/^Something went wrong: (.+)$/, '出错了：$1'],
]);
