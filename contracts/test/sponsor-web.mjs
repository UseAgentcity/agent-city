// The phone's "sponsor an event" flow (game/client/src/ui/sponsorTx.ts) against TimesSquareCity on a local Ganache
// chain, through an EIP-1193 provider like a browser wallet: a person with no Agent ID approves and bids, is
// outbid and refunded, and the flow stops before the wallet when the token is not set, the bid is too low or the
// balance is short. Never touches a real network.
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { ethers } from 'ethers';
import { compile } from '../scripts/compile.mjs';
import { sponsorEvent, topBid, SponsorError } from '../../game/client/src/ui/sponsorTx.ts';

const builds = compile({
  'TestAgentId.sol': { content: 'pragma solidity ^0.8.24; contract TestAgentId { mapping(address=>uint) public balanceOf; constructor(address[] memory a) { for (uint i; i < a.length; i++) balanceOf[a[i]] = 1; } }' },
  'TestToken.sol': { content: `pragma solidity ^0.8.24; contract TestToken {
    mapping(address=>uint) public balanceOf; mapping(address=>mapping(address=>uint)) public allowance;
    function mint(address to, uint v) external { balanceOf[to] += v; }
    function approve(address s, uint v) external returns (bool) { allowance[msg.sender][s] = v; return true; }
    function transfer(address to, uint v) external returns (bool) { balanceOf[msg.sender] -= v; balanceOf[to] += v; return true; }
    function transferFrom(address f, address to, uint v) external returns (bool) { allowance[f][msg.sender] -= v; balanceOf[f] -= v; balanceOf[to] += v; return true; } }` },
});
const DAY = 60, T = 10n ** 18n;
const chain = ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 4, defaultBalance: 1000 }, chain: { vmErrorsOnRPCResponse: true } });
const provider = new ethers.BrowserProvider(chain, undefined, { cacheTimeout: -1 });
provider.pollingInterval = 10;
const now = async () => (await provider.getBlock('latest')).timestamp;
// Move the chain's clock itself (not just one block's stamp), so the wallet's own transactions land after it.
const warp = async (to) => { await provider.send('evm_increaseTime', [to - (await now())]); await provider.send('evm_mine', []); };
const send = async (p) => (await p).wait();

/** A browser-wallet stand-in over the same EIP-1193 interface the page uses. */
const walletOf = (account) => ({
  account: account.toLowerCase(),
  call: (to, data) => chain.request({ method: 'eth_call', params: [{ to, data }, 'latest'] }),
  async send(to, data) {
    const hash = await chain.request({ method: 'eth_sendTransaction', params: [{ from: account, to, data, gas: '0x7a120' }] }); // Ganache under-estimates this call; a real wallet asks the node
    const r = await chain.request({ method: 'eth_getTransactionReceipt', params: [hash] });
    if (r.status !== '0x1') throw new Error('reverted');
    return hash;
  },
});

try {
  const [operator, agent, alice, bob] = await Promise.all([0, 1, 2, 3].map((i) => provider.getSigner(i)));
  const deploy = async (art, args) => (await new ethers.ContractFactory(art.abi, art.evm.bytecode.object, operator).deploy(...args)).waitForDeployment();
  const registry = await deploy(builds['TestAgentId.sol'].TestAgentId, [[agent.address]]); // alice and bob hold no Agent ID
  const token = await deploy(builds['TestToken.sol'].TestToken, []);
  const epoch = (await now()) + 600;
  const City = builds['src/TimesSquareCity.sol'].TimesSquareCity;
  const impl = await deploy(City, []);
  const init = new ethers.Interface(City.abi).encodeFunctionData('initialize', [await registry.getAddress(), operator.address, operator.address, epoch, DAY]);
  const proxy = await deploy(builds['src/CityProxy.sol'].CityProxy, [await impl.getAddress(), init]);
  const city = new ethers.Contract(await proxy.getAddress(), City.abi, operator);
  const addr = (await city.getAddress()).toLowerCase();
  await warp(epoch + 5); // day 1 of season 1: day 2's event is up for bids
  const A = walletOf(alice.address), B = walletOf(bob.address);
  const bid = { city: addr, season: 1, day: 2, eventId: 4 }; // 4 = rain

  // No token yet: stops before the wallet is asked for anything.
  await assert.rejects(() => sponsorEvent(A, { ...bid, tokens: 60_000 }), (e) => e instanceof SponsorError && e.message === 'no-token');
  await send(city.setToken(token.getAddress()));
  await send(token.mint(alice.address, 100_000n * T));
  await send(token.mint(bob.address, 1_000_000n * T));

  // A person with no Agent ID approves and bids; the steps come in order.
  const steps = [];
  await sponsorEvent(A, { ...bid, tokens: 60_000 }, (s) => steps.push(s));
  assert.deepEqual(steps, ['check', 'approve', 'bid', 'done'], 'approve, then bid');
  let lead = await topBid(A, addr, 1, 2);
  assert.equal(lead.who, alice.address.toLowerCase());
  assert.equal(lead.amount, 60_000n * T);
  assert.equal(lead.eventId, 4);
  assert.equal(await token.balanceOf(alice.address), 40_000n * T, 'the bid is held');

  // Too low and too poor are caught before the wallet.
  await assert.rejects(() => sponsorEvent(B, { ...bid, tokens: 60_000 }), (e) => e.message === 'too-low');
  await assert.rejects(() => sponsorEvent(A, { ...bid, tokens: 200_000 }), (e) => e.message === 'balance');

  // Outbid: Bob takes the lead for tourists, Alice's tokens come straight back.
  await sponsorEvent(B, { ...bid, eventId: 3, tokens: 80_000 });
  lead = await topBid(B, addr, 1, 2);
  assert.equal(lead.who, bob.address.toLowerCase());
  assert.equal(lead.eventId, 3);
  assert.equal(await token.balanceOf(alice.address), 100_000n * T, 'the outbid person is refunded in full');

  // A second bid by the same person reuses the allowance only if it covers it; here it asks again.
  const again = [];
  await sponsorEvent(A, { ...bid, tokens: 90_000 }, (s) => again.push(s));
  assert.ok(again.includes('approve') && again.at(-1) === 'done', 'a bigger bid asks for a bigger allowance');
  console.log('PASS: phone sponsor flow — a person without an Agent ID approves and bids from a browser wallet, is outbid and refunded; no-token, too-low and balance stop before the wallet');
} catch (e) {
  // Ganache errors carry its minified source in the stack: print the message only.
  console.error('FAIL:', String(e?.message ?? e).slice(0, 600));
  process.exitCode = 1;
} finally {
  await chain.disconnect();
}
