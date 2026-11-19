// The automatic settler against TimesSquareCity on a local Ganache chain: it publishes a finished season, waits
// out the challenge window, finalizes, re-posts after a challenge, rebuilds a lost claims file after a restart,
// and releases unclaimed BNB once the claim window is over. Never touches a real network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ganache from 'ganache';
import { ethers } from 'ethers';
import { compile } from '../scripts/compile.mjs';
import { DAYS } from '../service/tycoon/engine.mjs';
import { LOTS } from '../service/tycoon/lots.mjs';
import { encodePlan } from '../service/tycoon/chain.mjs';
import { watchCity } from '../service/tycoon/watch.mjs';
import { budgetFromUri, createSettler } from '../service/tycoon/settler.mjs';

const builds = compile({
  'TestAgentId.sol': { content: 'pragma solidity ^0.8.24; contract TestAgentId { mapping(address=>uint) public balanceOf; constructor(address[] memory a) { for (uint i; i < a.length; i++) balanceOf[a[i]] = 1; } }' },
  'TestToken.sol': { content: `pragma solidity ^0.8.24; contract TestToken {
    mapping(address=>uint) public balanceOf; mapping(address=>mapping(address=>uint)) public allowance;
    function mint(address to, uint v) external { balanceOf[to] += v; }
    function approve(address s, uint v) external returns (bool) { allowance[msg.sender][s] = v; return true; }
    function transfer(address to, uint v) external returns (bool) { balanceOf[msg.sender] -= v; balanceOf[to] += v; return true; }
    function transferFrom(address f, address to, uint v) external returns (bool) { allowance[f][msg.sender] -= v; balanceOf[f] -= v; balanceOf[to] += v; return true; } }` },
});
const DAY = 60;
const T = 10n ** 18n;
const chain = ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 5, defaultBalance: 1000 }, chain: { vmErrorsOnRPCResponse: true } });
const provider = new ethers.BrowserProvider(chain, undefined, { cacheTimeout: -1 });
provider.pollingInterval = 10;
const now = async () => (await provider.getBlock('latest')).timestamp;
const warp = async (to) => { await provider.send('evm_mine', [{ timestamp: to }]); };
const send = async (p) => (await p).wait();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settle-'));
const said = [];

try {
  const [operator, a, b, guest, treasury] = await Promise.all([0, 1, 2, 3, 4].map((i) => provider.getSigner(i)));
  const deploy = async (art, args) => (await new ethers.ContractFactory(art.abi, art.evm.bytecode.object, operator).deploy(...args)).waitForDeployment();
  const registry = await deploy(builds['TestAgentId.sol'].TestAgentId, [[a.address, b.address, guest.address]]);
  const token = await deploy(builds['TestToken.sol'].TestToken, []);
  const epoch = (await now()) + 600;
  const City = builds['src/TimesSquareCity.sol'].TimesSquareCity;
  const impl = await deploy(City, []);
  const init = new ethers.Interface(City.abi).encodeFunctionData('initialize', [await registry.getAddress(), operator.address, treasury.address, epoch, DAY]);
  const proxy = await deploy(builds['src/CityProxy.sol'].CityProxy, [await impl.getAddress(), init]);
  const city = new ethers.Contract(await proxy.getAddress(), City.abi, operator);
  const addr = await city.getAddress();
  await send(city.setToken(token.getAddress()));
  for (const s of [a, b, guest]) {
    await send(token.mint(s.address, 2_000_000n * T));
    await send(token.connect(s).approve(addr, ethers.MaxUint256));
  }
  await send(operator.sendTransaction({ to: addr, value: 10n * T })); // the prize pool

  /** Two Agents play a whole season: a storefront and a street cart, a plan every day. */
  const lot = LOTS.find((l) => l.tier === 'A');
  const playSeason = async (season) => {
    const start = epoch + (season - 1) * DAY * (DAYS + 1);
    if (season > 1) await warp(start - DAY + 5); // day 1 plans go in on the previous settling day
    await send(city.connect(a).enter(season, 400_000n * T));
    await send(city.connect(b).enter(season, 0));
    await send(city.connect(a).plan(season, 1, encodePlan({ lease: [{ lot: lot.id, bid: 300_000 }], price: 'standard', stock: 1000 }), 'open'));
    await send(city.connect(b).plan(season, 1, encodePlan({ lease: [{ lot: 'cart' }], price: 'standard', stock: 200 }), 'cart'));
    for (let d = 2; d <= DAYS; d++) {
      await warp(start + (d - 1) * DAY + 5);
      await send(city.connect(a).plan(season, d, encodePlan({ price: 'standard', stock: 1000 }), ''));
      await send(city.connect(b).plan(season, d, encodePlan({ price: 'standard', stock: 200 }), ''));
    }
    return start + DAYS * DAY; // the season's end
  };

  const watch = await watchCity({ provider, address: addr, every: 3_600_000 });
  const settler = createSettler({ signer: operator, address: addr, watch, dir, log: (m) => said.push(m) });
  const info = (s) => city.seasonInfo(s);

  // Before season 1 ends: nothing to do.
  const end1 = await playSeason(1);
  assert.deepEqual(await settler.tick(), [], 'nothing while the season runs');

  // Day 7 over: it publishes, writes the claims file and records the budget in the result URI.
  await warp(end1 + 10);
  assert.deepEqual(await settler.tick(), ['publish 1']);
  const x1 = await info(1);
  assert.ok(Number(x1.publishedAt) > 0 && !x1.finalized, 'posted, not final');
  assert.ok(budgetFromUri(x1.resultUri) > 0n, 'the budget is in the result URI');
  const file1 = path.join(dir, 'season-1.json');
  const claims1 = JSON.parse(fs.readFileSync(file1, 'utf8')).claims;
  assert.ok(claims1.some((c) => BigInt(c.bnb) > 0n) && claims1.length === 2, 'both Agents have a claim');
  assert.deepEqual(await settler.tick(), [], 'no second post, no early finalize inside the window');

  // A restart loses the file: the next pass rebuilds it from the chain and it matches the posted root.
  fs.rmSync(file1);
  await settler.tick();
  assert.ok(fs.existsSync(file1) && said.some((m) => m.includes('rebuilt the claims file')), 'claims file rebuilt');

  // The window passes: it finalizes, and an Agent claims with the file it wrote.
  await warp(Number(x1.publishedAt) + 3600 + 1);
  assert.deepEqual(await settler.tick(), ['finalize 1']);
  assert.ok((await info(1)).finalized, 'final');
  const mine = JSON.parse(fs.readFileSync(file1, 'utf8')).claims.find((c) => c.agent === a.address.toLowerCase());
  const before = await provider.getBalance(a.address);
  await send(city.connect(a).claim(1, mine.bnb, mine.tokens, mine.proof));
  assert.ok((await provider.getBalance(a.address)) > before, 'the Agent got its BNB');

  // Season 2: an Agent challenges the post; the settler re-posts, then finalizes after a clean window.
  const end2 = await playSeason(2);
  await warp(end2 + 10);
  assert.deepEqual(await settler.tick(), ['publish 2']);
  await send(city.connect(b).challenge(2, 'checking'));
  assert.ok((await info(2)).challenged, 'challenged');
  assert.deepEqual(await settler.tick(), ['repost 2']);
  const x2 = await info(2);
  assert.ok(!x2.challenged && !x2.finalized, 're-posted');
  await warp(Number(x2.publishedAt) + 3600 + 1);
  assert.deepEqual(await settler.tick(), ['finalize 2']);

  // After the claim window, season 1's unclaimed BNB (Agent b never claimed) goes back to the pool.
  const x1f = await info(1);
  assert.ok(x1f.bnbTotal > x1f.bnbClaimed, 'something left unclaimed');
  await warp(Number(x1f.claimUntil) + 10);
  const done = await settler.tick();
  assert.ok(done.includes('release 1'), 'released season 1');
  assert.ok((await info(1)).released, 'released on chain');
  // The roles without a shop, end to end through the contract: a shop that takes delivery (leased with an
  // "any storefront" bid: the best free lot), a coffee supplier and a courier. Both trade, both rank in their league, both are paid.
  const [cur] = (await city.clock()).map(Number);
  const S = cur + 1, start = epoch + (S - 1) * DAY * (DAYS + 1);
  await warp(start - DAY + 5);
  for (const [who, dep] of [[a, 400_000n * T], [b, 0n], [guest, 0n]]) await send(city.connect(who).enter(S, dep));
  for (let d = 1; d <= DAYS; d++) {
    if (d > 1) await warp(start + (d - 1) * DAY + 5);
    await send(city.connect(a).plan(S, d, encodePlan({ ...(d === 1 ? { lease: [{ lot: 'any', bid: 300_000 }], delivery: true } : {}), price: 'standard', stock: 3000 }), ''));
    await send(city.connect(b).plan(S, d, encodePlan({ supply: { cat: 'coffee', price: 0.8 } }), 'beans'));
    await send(city.connect(guest).plan(S, d, encodePlan({ deliver: { fee: 0.1 } }), 'rides'));
  }
  await warp(start + DAYS * DAY + 10);
  assert.ok((await settler.tick()).includes(`publish ${S}`), 'the roles season is published');
  const roles = JSON.parse(fs.readFileSync(path.join(dir, `season-${S}.json`), 'utf8'));
  const row = (who) => roles.standings.find((x) => x.agent === who.address.toLowerCase());
  const bnbOf = (who) => BigInt(roles.claims.find((c) => c.agent === who.address.toLowerCase())?.bnb ?? 0);
  assert.ok(row(a).lot && !['cart', 'stall'].includes(row(a).cat), 'the shop got a storefront through "any"');
  assert.equal(row(b).cat, 'supplier', 'b is a supplier');
  assert.equal(row(guest).cat, 'courier', 'guest is a courier');
  assert.ok(row(b).profit > 0 && row(guest).profit > 0, 'supplier and courier both earned city coins');
  assert.ok(bnbOf(b) > 0n && bnbOf(guest) > 0n, 'supplier and courier both get BNB (the trade league)');
  watch.stop();
  console.log('PASS: auto-settler — publishes a finished season with its budget in the URI, waits out the challenge window, finalizes, re-posts after a challenge, rebuilds a lost claims file, releases unclaimed BNB; a supplier and a courier play through the contract and are paid');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
  await chain.disconnect();
}
