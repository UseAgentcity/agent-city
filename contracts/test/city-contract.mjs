// TimesSquareCity on a local Ganache chain: entry, plans, sponsorship, settlement from the real engine, the
// challenge window, claims, the 80/20 split, expiry and the abandoned-season rescue. Never touches a real network.
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { ethers } from 'ethers';
import { compile } from '../scripts/compile.mjs';
import { DAYS } from '../service/tycoon/engine.mjs';
import { LOTS } from '../service/tycoon/lots.mjs';
import { depositsFromLogs, encodePlan, eventsFromLogs, leafOf, replaySeason, settleSeason } from '../service/tycoon/chain.mjs';

const builds = compile({
  'TestAgentId.sol': { content: 'pragma solidity ^0.8.24; contract TestAgentId { mapping(address=>uint) public balanceOf; constructor(address[] memory a) { for (uint i; i < a.length; i++) balanceOf[a[i]] = 1; } }' },
  'TestCityV2.sol': { content: 'pragma solidity ^0.8.24; import "src/TimesSquareCity.sol"; contract TestCityV2 is TimesSquareCity { function version() external pure returns (string memory) { return "v2"; } }' },
  'TestToken.sol': { content: `pragma solidity ^0.8.24; contract TestToken {
    mapping(address=>uint) public balanceOf; mapping(address=>mapping(address=>uint)) public allowance;
    function mint(address to, uint v) external { balanceOf[to] += v; }
    function approve(address s, uint v) external returns (bool) { allowance[msg.sender][s] = v; return true; }
    function transfer(address to, uint v) external returns (bool) { balanceOf[msg.sender] -= v; balanceOf[to] += v; return true; }
    function transferFrom(address f, address to, uint v) external returns (bool) { allowance[f][msg.sender] -= v; balanceOf[f] -= v; balanceOf[to] += v; return true; } }` },
});
const DAY = 60;
const T = 10n ** 18n;
const chain = ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 6, defaultBalance: 1000 }, chain: { vmErrorsOnRPCResponse: true } });
const provider = new ethers.BrowserProvider(chain, undefined, { cacheTimeout: -1 });
provider.pollingInterval = 10;
const now = async () => (await provider.getBlock('latest')).timestamp;
const warp = async (to) => { await provider.send('evm_mine', [{ timestamp: to }]); };
const send = async (p) => (await p).wait();
/** Expects a revert with this reason (Ganache nests it inside the RPC error). */
const reverts = async (fn, reason) => {
  try { await fn(); } catch (e) {
    const text = JSON.stringify(e, (_, v) => (typeof v === 'bigint' ? String(v) : v)) + String(e?.message);
    assert.ok(text.includes(reason), `expected revert "${reason}", got ${String(e?.shortMessage ?? e?.message).slice(0, 160)}`);
    return;
  }
  assert.fail(`expected revert "${reason}"`);
};

try {
  const [operator, a, b, guest, treasury, sponsorAcc] = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => provider.getSigner(i)));
  const deploy = async (art, args) => (await new ethers.ContractFactory(art.abi, art.evm.bytecode.object, operator).deploy(...args)).waitForDeployment();
  const registry = await deploy(builds['TestAgentId.sol'].TestAgentId, [[a.address, b.address]]);
  const token = await deploy(builds['TestToken.sol'].TestToken, []);
  const epoch = (await now()) + 600;
  // Behind a proxy: the implementation, then CityProxy(implementation, initialize(...)); the city is the proxy.
  const City = builds['src/TimesSquareCity.sol'].TimesSquareCity;
  const impl = await deploy(City, []);
  const init = new ethers.Interface(City.abi).encodeFunctionData('initialize', [await registry.getAddress(), operator.address, treasury.address, epoch, DAY]);
  const proxy = await deploy(builds['src/CityProxy.sol'].CityProxy, [await impl.getAddress(), init]);
  const city = new ethers.Contract(await proxy.getAddress(), City.abi, operator);
  // The implementation can never be initialized or used on its own, and the proxy only once.
  await assert.rejects(() => impl.initialize(registry.getAddress(), operator.address, treasury.address, epoch, DAY));
  await assert.rejects(() => city.initialize(registry.getAddress(), guest.address, guest.address, epoch, DAY));
  const addr = await city.getAddress();
  const as = (s) => city.connect(s);
  for (const s of [a, b, guest, sponsorAcc]) {
    await send(token.mint(s.address, 2_000_000n * T));
    await send(token.connect(s).approve(addr, ethers.MaxUint256));
  }

  // Only the operator sets the token, and only once.
  await assert.rejects(() => as(guest).setToken(token.getAddress()));
  await reverts(() => as(a).enter(1, 1n * T), 'no token yet');
  await send(city.setToken(token.getAddress()));
  await assert.rejects(() => city.setToken(token.getAddress()));

  // Before season 1: entries, day 1 plans and day 1 sponsorship are open; nothing else is.
  assert.deepEqual((await city.clock()).map(Number), [1, 0]);
  await reverts(() => as(guest).enter(1, 0), 'agent ID');
  await send(as(a).enter(1, 400_000n * T));
  await reverts(() => as(a).enter(1, 0), 'already entered');
  const lot = LOTS.find((l) => l.tier === 'A');
  const planA = encodePlan({ lease: [{ lot: lot.id, bid: 300_000 }], price: 'standard', stock: 1000, brand: { name: 'NOVA BREW', slogan: 'test', color: '#ff7a45' } });
  const tx = await send(as(a).plan(1, 1, planA, 'opening day'));
  const planGas = tx.gasUsed;
  await reverts(() => as(a).plan(1, 1, planA, 'again'), 'already planned');
  await reverts(() => as(a).plan(1, 2, planA, ''), 'not open');
  await reverts(() => as(b).plan(1, 1, planA, ''), 'not entered');
  // Sponsorship: the leading bid is held; an outbid sponsor gets its tokens back at once.
  const before = await token.balanceOf(guest.address);
  await reverts(() => as(guest).sponsor(1, 1, 2, 10_000n * T), 'bid too low');
  await send(as(guest).sponsor(1, 1, 2, 50_000n * T));
  await send(as(sponsorAcc).sponsor(1, 1, 3, 60_000n * T));
  assert.equal(await token.balanceOf(guest.address), before, 'outbid sponsor refunded');
  await reverts(() => as(guest).sponsor(1, 2, 2, 70_000n * T), 'not open');

  // b joins with nothing (a free stall) before the season opens.
  await send(as(b).enter(1, 0));
  const stall = LOTS.find((l) => l.tier === 'S');
  const planB = encodePlan({ lease: [{ lot: stall.id, bid: 0 }], price: 'discount', stock: 200 });
  await send(as(b).plan(1, 1, planB, 'hot cocoa'));
  // Season 1, day 1: the lease auction has settled; day 1 plans are closed, entries are still open.
  await warp(epoch + 5);
  assert.deepEqual((await city.clock()).map(Number), [1, 1]);
  await reverts(() => as(a).plan(1, 1, planA, 'too late'), 'not open');
  // The token's trading tax arrives as plain BNB.
  await send(guest.sendTransaction({ to: addr, value: ethers.parseEther('10') }));
  assert.equal(await city.seasonBudget(), ethers.parseEther('1'), '10% of the free pool');

  // Days 2-7: a plan a day (a shop only restocks on days its Agent plans).
  await warp(epoch + DAY + 5);
  await reverts(() => as(a).plan(1, 1, planA, ''), 'not open');
  for (let day = 2; day <= DAYS; day++) {
    await warp(epoch + (day - 1) * DAY + 5);
    await send(as(a).plan(1, day, encodePlan({ price: 'standard', stock: 1000 }), `day ${day}`));
    await send(as(b).plan(1, day, encodePlan({ price: 'discount', stock: 200 }), ''));
  }
  await reverts(() => city.publish(1, ethers.id('x'), 0, 0, 400_000n * T, ''), 'season running');
  await warp(epoch + DAYS * DAY + 5);
  assert.deepEqual((await city.clock()).map(Number), [1, 8]);

  // Replay the logs through the engine and settle.
  const logs = await provider.getLogs({ address: addr, fromBlock: 0, toBlock: 'latest' });
  const events = eventsFromLogs(logs, 1);
  assert.equal(events.filter((e) => e.type === 'enter').length, 2);
  assert.equal(events.filter((e) => e.type === 'plan').length, 2 + 2 * (DAYS - 1));
  assert.equal(events.filter((e) => e.type === 'sponsor').length, 2);
  // The same replay the API and the settlement run: chain events alongside the demo shopkeepers.
  const played = replaySeason(addr, 1, events);
  assert.ok(played.standings.some((s) => s.agent.startsWith('demo:')), 'demo shopkeepers still trade');
  const sa = played.standings.find((s) => s.agent === a.address.toLowerCase());
  assert.equal(sa.lot, lot.id, 'the engine leased the lot from the on-chain bid');
  assert.equal(played.days[0].sponsor?.who, sponsorAcc.address.toLowerCase(), 'the on-chain sponsor chose day 1');
  const budget = await city.seasonBudget();
  const deposits = depositsFromLogs(logs, 1);
  assert.deepEqual(deposits, { [a.address.toLowerCase()]: (400_000n * T).toString(), [b.address.toLowerCase()]: '0' });
  const settled = settleSeason(played, { season: 1, budgetWei: budget, depositsWei: deposits });
  assert.ok(settled.claims.every((c) => /^0x[0-9a-f]{40}$/.test(c.agent)), 'only real Agent ID wallets are paid');
  assert.equal(settled.tokensSpent + settled.refunds, 400_000n * T);
  assert.ok(settled.bnbTotal > 0n && settled.bnbTotal <= budget);

  // The contract holds the operator to the books.
  await reverts(() => as(guest).publish(1, settled.root, 0, settled.tokensSpent, settled.refunds, ''), 'operator');
  await reverts(() => city.publish(1, settled.root, settled.bnbTotal, settled.tokensSpent, settled.refunds + 1n, ''), 'deposits');
  await reverts(() => city.publish(1, settled.root, budget + 1n, settled.tokensSpent, settled.refunds, ''), 'over budget');
  await send(city.publish(1, ethers.id('wrong'), settled.bnbTotal, settled.tokensSpent, settled.refunds, 'ipfs://wrong'));

  // A challenge holds claims until the operator re-posts.
  await reverts(() => as(guest).challenge(1, 'not mine'), 'challenger');
  await send(as(b).challenge(1, 'my stall is missing'));
  await warp(epoch + DAYS * DAY + 3600 + 10);
  const claimOf = (s) => settled.claims.find((c) => c.agent === s.address.toLowerCase());
  const ca = claimOf(a);
  await reverts(() => as(a).claim(1, ca.bnb, ca.tokens, ca.proof), 'not ready');
  await send(city.publish(1, settled.root, settled.bnbTotal, settled.tokensSpent, settled.refunds, 'ipfs://results'));
  await reverts(() => city.finalize(1), 'not ready');
  await warp((await now()) + 3601);

  // Claims: BNB award plus unspent deposit; the season's spending is split 80/20 on the way.
  const dead = '0x000000000000000000000000000000000000dEaD';
  const bnbBefore = await provider.getBalance(a.address);
  const tokBefore = await token.balanceOf(a.address);
  const r = await send(as(a).claim(1, ca.bnb, ca.tokens, ca.proof));
  const gas = r.gasUsed * r.gasPrice;
  assert.equal(await provider.getBalance(a.address), bnbBefore + ca.bnb - gas, 'BNB award paid');
  assert.equal(await token.balanceOf(a.address), tokBefore + ca.tokens, 'unspent deposit returned');
  const spent = settled.tokensSpent + 60_000n * T; // deposit spending + the winning sponsor bid
  assert.equal(await token.balanceOf(dead), (spent * 8000n) / 10000n, '80% burned');
  assert.equal(await token.balanceOf(treasury.address), spent - (spent * 8000n) / 10000n, '20% to the treasury');
  assert.equal(await token.balanceOf(addr), 0n + (ca.tokens === settled.refunds ? 0n : settled.refunds - ca.tokens), 'the contract keeps only what is still owed');
  await reverts(() => as(a).claim(1, ca.bnb, ca.tokens, ca.proof), 'claimed');
  await reverts(() => as(b).claim(1, ca.bnb, ca.tokens, ca.proof), 'proof');
  await reverts(() => as(b).claim(1, 1n, 0n, [ ]), 'proof');

  // Unclaimed awards go back to the pool after 7 days.
  const reservedBefore = await city.reserved();
  await reverts(() => city.release(1), 'not yet');
  await warp((await now()) + 7 * 86400 + 10);
  await send(as(guest).release(1));
  const info = await city.seasonInfo(1);
  assert.equal(await city.reserved(), reservedBefore - (info.bnbTotal - info.bnbClaimed));
  assert.ok(info.finalized && info.released);

  // Season 2 that nobody settles: after 14 days everyone takes back exactly what they put in.
  const s2 = Number((await city.clock())[0]) + 1;
  const len = DAY * (DAYS + 1);
  await warp(epoch + (s2 - 1) * len - DAY + 5); // the settling day before it
  await send(as(a).enter(s2, 123_000n * T));
  await send(as(sponsorAcc).sponsor(s2, 1, 4, 55_000n * T));
  await reverts(() => as(a).rescue(s2), 'not abandoned');
  await warp(epoch + (s2 - 1) * len + DAYS * DAY + 14 * 86400 + 10);
  const ta = await token.balanceOf(a.address), ts = await token.balanceOf(sponsorAcc.address);
  await send(as(a).rescue(s2));
  await send(as(sponsorAcc).rescue(s2));
  assert.equal(await token.balanceOf(a.address), ta + 123_000n * T, 'deposit rescued');
  assert.equal(await token.balanceOf(sponsorAcc.address), ts + 55_000n * T, 'sponsor bid rescued');
  await reverts(() => as(a).rescue(s2), 'nothing');
  await reverts(() => city.publish(s2, ethers.id('late'), 0, 0, 123_000n * T, ''), 'final');
  assert.equal(leafOf(1, a.address, ca.bnb, ca.tokens), ca.leaf);

  // ---- upgrades: the deploying wallet, at any time; handover in two steps; freezing ends them ----
  const V2 = builds['TestCityV2.sol'].TestCityV2;
  const v2 = await deploy(V2, []);
  const other = await deploy(V2, []);
  assert.equal(await city.upgradeAdmin(), operator.address, 'the deployer is the upgrade admin');
  await reverts(() => as(guest).upgradeToAndCall(v2.getAddress(), '0x'), 'upgrade admin');
  const poolBefore = await provider.getBalance(addr), reservedNow = await city.reserved();
  await send(city.upgradeToAndCall(v2.getAddress(), '0x'));
  const upgraded = new ethers.Contract(addr, V2.abi, operator);
  assert.equal(await upgraded.version(), 'v2');
  assert.equal(await provider.getBalance(addr), poolBefore, 'the pool is where it was');
  assert.equal(await upgraded.reserved(), reservedNow);
  assert.ok((await upgraded.seasonInfo(1)).finalized, 'past seasons intact');
  assert.equal(await upgraded.entered(1, a.address), true);
  await send(guest.sendTransaction({ to: addr, value: ethers.parseEther('1') }));
  assert.equal(await provider.getBalance(addr), poolBefore + ethers.parseEther('1'), 'tax still arrives at the same address');
  await send(upgraded.transferUpgradeAdmin(guest.address));
  await reverts(() => as(b).acceptUpgradeAdmin(), 'not proposed');
  await send(upgraded.connect(guest).acceptUpgradeAdmin());
  assert.equal(await upgraded.upgradeAdmin(), guest.address);
  await reverts(() => upgraded.upgradeToAndCall(other.getAddress(), '0x'), 'upgrade admin');
  await send(upgraded.connect(guest).freezeUpgrades());
  assert.equal(await upgraded.upgradeAdmin(), ethers.ZeroAddress);
  await reverts(() => upgraded.connect(guest).upgradeToAndCall(other.getAddress(), '0x'), 'upgrade admin');

  console.log(`PASS: city contract — Agent ID entry, deposits, one plan per day (${planGas} gas), sponsorship refunds, engine replay from logs, books check, budget cap, challenge and re-post, claims with 80/20 split, expiry, rescue; proxy upgradable by the deployer with state and pool intact, admin handover, freeze`);
} finally { await chain.disconnect(); }
