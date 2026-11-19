// node --import tsx --test client/src/ui/*.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { zhFor } from '../i18n.ts';
import '../i18n-zh.ts';

test('building labels: floors and areas translate, proper names stay', () => {
  assert.equal(zhFor('6 floors · Burj Khalifa'), '6 层 · 哈利法塔');
  assert.equal(zhFor('1 floor'), '1 层');
  assert.equal(zhFor('The Waterfall'), null);
  assert.equal(zhFor('Building on Sheikh Mohammed bin Rashid Boulevard'), 'Sheikh Mohammed bin Rashid Boulevard 旁的建筑');
  assert.equal(zhFor('Emaar Square · 12 floors'), 'Emaar Square · 12 层');
  assert.equal(zhFor('Go inside Souk Al Bahar'), '进入 Souk Al Bahar');
  assert.equal(zhFor('offices · 20 floors'), '写字楼 · 20 层');
});

test('lift, rooms and interactions', () => {
  assert.equal(zhFor('Call the lift'), '呼叫电梯');
  assert.equal(zhFor('Choose a floor'), '选择楼层');
  assert.equal(zhFor('Ground floor · lobby'), '首层 · 大堂');
  assert.equal(zhFor('Floor 7 · guest rooms'), '7 楼 · 客房');
  assert.equal(zhFor('Roof terrace · step outside on top'), '屋顶露台 · 到楼顶外面');
});

test('HUD: clock, weather, distance, loading', () => {
  assert.equal(zhFor('4:41 PM'), '16:41');
  assert.equal(zhFor('12:05 AM'), '00:05');
  assert.equal(zhFor('4:41 PM  ·  T to skip ahead'), '16:41  ·  按 T 快进');
  assert.equal(zhFor('Sunny · 31 °C · wind 14 km/h from the NW'), '晴 · 31 °C · 西北风 14 km/h');
  assert.equal(zhFor('1.2 km away'), '距离 1.2 km');
  assert.equal(zhFor('Streaming the map: tiles 3/40…'), '正在加载地图：瓦片 3/40…');
});

test('keeps surrounding whitespace and leaves Chinese alone', () => {
  assert.equal(zhFor('  Flying to '), '  正在飞往 ');
  assert.equal(zhFor('本轮比赛'), null);
  assert.equal(zhFor('launch.ai'), null);
});

test('3D textures and the ordinary city mode', async () => {
  await import('../i18n-zh-city.ts');
  assert.equal(zhFor('RECEPTION'), '前台');
  assert.equal(zhFor('AGENT HEADQUARTERS  ·  DUBAI'), 'Agent 智能总部  ·  迪拜');
  assert.equal(zhFor('BINANCE'), null);
  assert.equal(zhFor('3h ago'), '3 小时前');
  assert.equal(zhFor('City Directory'), '城市目录');
  assert.equal(zhFor('12 project headquarters in New York City'), 'New York City 的 12 座项目总部');
  assert.equal(zhFor('Avery'), null, 'people keep their names');
});
