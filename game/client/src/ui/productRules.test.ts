// Confirmed product rules: people explore free, only Agent IDs run shops, no custodial keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = ['ui/arenaPhone.ts', 'ui/tycoon.ts', 'ui/settings.ts', 'landing/index.ts', 'interior.ts', 'i18n-zh.ts', 'i18n-zh-city.ts'];
const src = FILES.map((f) => [f, readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')] as const);
const BANNED = [/车队/, /车主/, /预算授权/, /消费预算/, /报名费 BNB/, /Entry fee BNB/, /2% 买卖税设想/, /模拟收益/, /模拟净收益/, /续费/, /Budget permit/, /Fleet (mode|live|standings)/];

test('no fleet-owner, budget or paid-entry copy reaches the UI', () => {
  for (const [file, text] of src) {
    for (const re of BANNED) assert.doesNotMatch(text, re, `${file} contains ${re}`);
  }
});

test('the phone shows the tycoon city, how to send an Agent and how people sponsor an event', () => {
  const phone = src.find(([f]) => f === 'ui/arenaPhone.ts')![1];
  assert.match(phone, /const DOCK = \['city', 'sponsor', 'ranking', 'guide'\]/);
  assert.match(phone, /function renderSponsor/);
  assert.match(phone, /只有最后赢的人付钱/, 'the sponsor app says only the winner pays');
  assert.match(phone, /function renderEconomy/);
  assert.match(phone, /80% 销毁/, 'the phone states where spent tokens go');
  assert.match(phone, /function renderRanking/);
  assert.match(phone, /function renderScreens/);
  assert.doesNotMatch(phone, /dispatch|bounty|Workboard|ride/i, 'no retired game modes on the phone');
  assert.doesNotMatch(phone, /10 万平台币|100k platform tokens|20% 创建者/);
  assert.match(phone, /data-ty-lot/);
  assert.match(phone, /data-ty-go/);
  assert.match(phone, /Official Agentic Wallet setup/);
  assert.match(phone, /city coins have no cash value|City coins have no cash value/i);
});

test('the landing introduces the tycoon city and official Agent onboarding', () => {
  const landing = src.find(([f]) => f === 'landing/index.ts')![1];
  assert.match(landing, /People explore\. Agents compete\./);
  assert.match(landing, /Explore the city/);
  assert.match(landing, /not investment advice/);
  assert.doesNotMatch(landing, /probeBounty\(\)|probeRide\(\)|openAgentInstructions/);
});

test('spectators cannot claim tasks from the browser', () => {
  const phone = src.find(([f]) => f === 'ui/arenaPhone.ts')![1];
  assert.doesNotMatch(phone, /fetch\(/, 'the phone only reads the shared city snapshot');
  for (const [file, text] of src) {
    assert.doesNotMatch(text, /fetch\([^)]*\/(dispatch\/(check-in|observe|me|actions)|bounty\/tasks\/[^'"]+\/(accept|steps|complete)|rounds\/current\/join|submissions)/, `${file} calls an Agent-only route`);
    assert.doesNotMatch(text, /signTypedData|eth_sign|personal_sign/, `${file} asks for a signature`);
  }
});

test('old tab ids open the matching app', async () => {
  const { arenaAppOf } = await import('./arenaApps.ts');
  assert.equal(arenaAppOf('home'), 'springboard');
  assert.equal(arenaAppOf('career'), 'city');
  assert.equal(arenaAppOf('delivery'), 'city');
  assert.equal(arenaAppOf('projects'), 'guide');
  assert.equal(arenaAppOf('map'), 'city');
  assert.equal(arenaAppOf('watch'), 'ranking');
  assert.equal(arenaAppOf('wallet'), 'rewards');
  assert.equal(arenaAppOf('nope'), 'springboard');
});

test('phones get touch controls and never start behind the full-screen phone', () => {
  const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  assert.match(read('ui/phone.ts'), /loadDock\(\) !== 'min' && window\.innerWidth > 720 && window\.innerHeight > 560\) open\(/);
  assert.match(read('main.ts'), /s\.phoneApp && window\.innerWidth > 720/);
  assert.match(read('main.ts'), /installTouch\(\{/);
  const touch = read('touch.ts');
  for (const k of ["data-hold=\"Space\"", "data-tap=\"KeyE\"", "data-tap=\"KeyM\"", "data-act=\"phone\"", "data-act=\"ride\""]) assert.ok(touch.includes(k), k);
});
