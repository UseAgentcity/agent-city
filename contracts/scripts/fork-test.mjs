// A full TimesSquareCity season on a local fork of BNB Chain mainnet: the real SPACE ID Agent ID contract decides who
// may enter, real Agent ID holders (impersonated on the fork) play, and a real Flap tax token stands in for the city
// token, so its transfer rules meet the contract's deposit checks. Nothing is ever sent to mainnet: the fork lives in
// this process and is thrown away at the end.
//
//   node scripts/fork-test.mjs
// FORK_RPC must serve historical state (an archive node); LOG_RPC is only used to find real holders in recent logs.
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { ethers } from 'ethers';
import { compile } from './compile.mjs';
import { DAYS } from '../service/tycoon/engine.mjs';
import { LOTS } from '../service/tycoon/lots.mjs';
import { depositsFromLogs, encodePlan, eventsFromLogs, replaySeason, settleSeason } from '../service/tycoon/chain.mjs';

const RPC = process.env.FORK_RPC || 'https://bsc-mainnet.public.blastapi.io';
const LOG_RPC = process.env.LOG_RPC || 'https://bsc-rpc.publicnode.com';
const AGENT_ID = '0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F'; // SPACE ID Agent ID (symbol AI), BNB Chain
const TOKEN = process.env.FORK_TOKEN || '0xb27d4b9361c2Eb84A6F8537C6F852115E0F77777'; // a live Flap tax token
// Where that token keeps balances (mapping at storage slot 51), found by matching a known balance on mainnet.
// The fork writes test balances there; every deposit and refund afterwards runs the token's real transfer code.
const BALANCE_SLOT = BigInt(process.env.FORK_TOKEN_BALANCE_SLOT || 51);
const T = 10n ** 18n;
const DAY = 120;

const log = (...a) => console.log(...a);
const main = new ethers.JsonRpcProvider(LOG_RPC, 56, { staticNetwork: true });
const head = await main.getBlockNumber();
const ERC20 = ['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)', 'function approve(address,uint256) returns (bool)', 'function symbol() view returns (string)'];
const topic = ethers.id('Transfer(address,address,uint256)');

// ---- pick real people from mainnet: Agent ID holders, and an ordinary wallet that holds the token ----
async function recentRecipients(address, want, filter) {
  const out = new Map();
  for (let to = head; to > head - 400_000 && out.size < want; to -= 1000) {
    const logs = await main.getLogs({ address, topics: [topic], fromBlock: to - 999, toBlock: to });
    for (const l of logs.reverse()) {
      const who = ethers.getAddress('0x' + l.topics[2].slice(26));
      if (!out.has(who) && (await filter(who))) out.set(who, true);
      if (out.size >= want) break;
    }
  }
  return [...out.keys()];
}
const id = new ethers.Contract(AGENT_ID, ['function balanceOf(address) view returns (uint256)', 'function handleOf(address) view returns (string)'], main);
const isEoa = async (a) => (await main.getCode(a)) === '0x';
const holders = await recentRecipients(AGENT_ID, 3, async (a) => (await isEoa(a)) && (await id.balanceOf(a)) > 0n);
const handles = await Promise.all(holders.map((h) => id.handleOf(h).catch(() => '?')));
const tok = new ethers.Contract(TOKEN, ERC20, main);
assert.equal(holders.length, 3, 'found Agent ID holders on mainnet');
log(`mainnet block ${head}`);
log(`Agent ID holders: ${holders.map((h, i) => `${handles[i]}.ai ${h}`).join(', ')}`);
log(`token ${await tok.symbol()} ${TOKEN}`);

// ---- the fork ----
const chain = ganache.provider({
  fork: { url: RPC, blockNumber: head - 2 },
  chain: { chainId: 56, hardfork: 'shanghai', vmErrorsOnRPCResponse: true },
  wallet: { totalAccounts: 3, defaultBalance: 100, unlockedAccounts: holders },
  logging: { quiet: true },
});
const provider = new ethers.BrowserProvider(chain, undefined, { cacheTimeout: -1 });
provider.pollingInterval = 10;
// Every receipt's logs, in order: the fork's own log index, with no upstream log queries.
const receipts = [];
const send = async (p) => { const r = await (await p).wait(); receipts.push(r); return r; };
const now = async () => (await provider.getBlock('latest')).timestamp;
const warp = (to) => provider.send('evm_mine', [{ timestamp: to }]);
const reverts = async (fn, reason) => {
  try { await fn(); } catch (e) { const t = JSON.stringify(e, (_, v) => (typeof v === 'bigint' ? String(v) : v)) + String(e?.message); assert.ok(t.includes(reason), `expected "${reason}", got ${String(e?.shortMessage ?? e?.message).slice(0, 140)}`); return; }
  assert.fail(`expected revert "${reason}"`);
};

try {
  const [operator, treasury, stranger] = await Promise.all([0, 1, 2].map((i) => provider.getSigner(i)));
  for (const a of holders) await provider.send('evm_setAccountBalance', [a, ethers.toQuantity(10n * T)]);
  const agents = await Promise.all(holders.map((h) => provider.getSigner(h)));
  const token = new ethers.Contract(TOKEN, ERC20, provider);
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const fund = async (who, amount) => {
    const slot = ethers.keccak256(coder.encode(['address', 'uint256'], [who, BALANCE_SLOT]));
    await provider.send('evm_setAccountStorageAt', [TOKEN, slot, ethers.zeroPadValue(ethers.toBeHex(amount), 32)]);
    assert.equal(await token.balanceOf(who), amount, 'balance slot is right');
  };
  await fund(holders[0], 1_000_000n * T);
  for (const h of holders.slice(1)) await fund(h, 0n);

  // Is a plain wallet-to-wallet transfer of a Flap tax token taxed? Deposits depend on it.
  const amt = 500_000n * T;
  await send(token.connect(agents[0]).transfer(holders[1], amt));
  const got = await token.balanceOf(holders[1]);
  log(`plain transfer of 500,000 tokens arrived as ${ethers.formatEther(got)} (${got === amt ? 'no tax' : 'TAXED'})`);
  await fund(holders[1], amt);
  await fund(holders[2], amt);

  const build = compile();
  const art = build['src/TimesSquareCity.sol'].TimesSquareCity;
  const epoch = (await now()) + 3600;
  const city = await (await new ethers.ContractFactory(art.abi, art.evm.bytecode.object, operator).deploy(AGENT_ID, operator.address, treasury.address, epoch, DAY)).waitForDeployment();
  const addr = await city.getAddress();
  const deployGas = (await (await city.deploymentTransaction()).wait()).gasUsed;
  await send(city.setToken(TOKEN));

  // The real Agent ID contract gates entry.
  await reverts(() => city.connect(stranger).enter(1, 0), 'agent ID');
  const lotA = LOTS.find((l) => l.tier === 'A'), lotB = LOTS.find((l) => l.tier === 'B'), stall = LOTS.find((l) => l.tier === 'S');
  const plans = [
    { lease: [{ lot: lotA.id, bid: 320_000 }], price: 'standard', stock: 1000, brand: { name: `${handles[0]}`.slice(0, 18).toUpperCase(), slogan: 'fork test', color: '#ff7a45' } },
    { lease: [{ lot: lotB.id, bid: 160_000 }], price: 'standard', stock: 600 },
    { lease: [{ lot: stall.id, bid: 0 }], price: 'discount', stock: 200 },
  ];
  const deposits = [400_000n * T, 200_000n * T, 0n];
  const gas = {};
  for (let i = 0; i < 3; i++) {
    const a = city.connect(agents[i]);
    if (deposits[i]) gas.approve = (await send(token.connect(agents[i]).approve(addr, deposits[i]))).gasUsed;
    gas.enter = (await send(a.enter(1, deposits[i]))).gasUsed;
    gas.plan = (await send(a.plan(1, 1, encodePlan(plans[i]), `day 1 · ${handles[i]}.ai`))).gasUsed;
  }
  log(`deposits taken in full: ${ethers.formatEther(await token.balanceOf(addr))} tokens held by the city`);
  await send(token.connect(agents[0]).approve(addr, 60_000n * T));
  gas.sponsor = (await send(city.connect(agents[0]).sponsor(1, 1, 2, 60_000n * T))).gasUsed;

  log('sponsored day 1');
  // The tax arrives as BNB.
  await send(stranger.sendTransaction({ to: addr, value: 5n * T }));

  log('pool funded');
  // Seven days of plans.
  for (let day = 2; day <= DAYS; day++) {
    await warp(epoch + (day - 1) * DAY + 5);
    for (let i = 0; i < 3; i++) await send(city.connect(agents[i]).plan(1, day, encodePlan({ price: plans[i].price, stock: plans[i].stock }), ''));
  }
  await warp(epoch + DAYS * DAY + 5);
  log('seven days planned');

  // Settle from the fork's own logs, exactly as the operator would.
  const logs = receipts.flatMap((r) => r.logs).filter((l) => l.address.toLowerCase() === addr.toLowerCase());
  const played = replaySeason(addr, 1, eventsFromLogs(logs, 1));
  const real = played.standings.filter((s) => s.agent.startsWith('0x'));
  for (const s of real) log(`  ${handles[holders.findIndex((h) => h.toLowerCase() === s.agent)]}.ai  lot ${s.lot}  score ${s.score}  profit ${s.profit}  tokens spent ${s.tokensSpent}`);
  const budget = await city.seasonBudget();
  const settled = settleSeason(played, { season: 1, budgetWei: budget, depositsWei: depositsFromLogs(logs, 1) });
  gas.publish = (await send(city.publish(1, settled.root, settled.bnbTotal, settled.tokensSpent, settled.refunds, 'fork-test'))).gasUsed;
  await warp((await now()) + 3601);

  const dead = '0x000000000000000000000000000000000000dEaD';
  const deadBefore = await token.balanceOf(dead), treasuryBefore = await token.balanceOf(treasury.address);
  for (const c of settled.claims) {
    const signer = agents[holders.findIndex((h) => h.toLowerCase() === c.agent)];
    const bnbBefore = await provider.getBalance(c.agent), tokBefore = await token.balanceOf(c.agent);
    const r = await send(city.connect(signer).claim(1, c.bnb, c.tokens, c.proof));
    gas.claim = r.gasUsed;
    assert.equal(await provider.getBalance(c.agent), bnbBefore + c.bnb - r.gasUsed * r.gasPrice, 'BNB award paid');
    assert.equal(await token.balanceOf(c.agent), tokBefore + c.tokens, 'refund arrives untaxed');
  }
  const spent = settled.tokensSpent + 60_000n * T;
  assert.equal((await token.balanceOf(dead)) - deadBefore, (spent * 8000n) / 10000n, '80% burned');
  assert.equal((await token.balanceOf(treasury.address)) - treasuryBefore, spent - (spent * 8000n) / 10000n, '20% to the treasury');
  assert.equal(await token.balanceOf(addr), 0n, 'every deposited token accounted for');
  log(`BNB awarded ${ethers.formatEther(settled.bnbTotal)} of budget ${ethers.formatEther(budget)}; burned ${ethers.formatEther((spent * 8000n) / 10000n)} tokens, treasury ${ethers.formatEther(spent - (spent * 8000n) / 10000n)}`);
  log(`gas: deploy ${deployGas}, ${Object.entries(gas).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log('PASS: mainnet fork — real Agent ID gate, real Agent ID holders, real Flap tax token deposits and refunds, settlement, 80/20 split');
} finally {
  await chain.disconnect();
}
