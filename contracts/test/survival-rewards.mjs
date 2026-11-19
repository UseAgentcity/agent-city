import assert from 'node:assert/strict';
import ganache from 'ganache';
import { ethers } from 'ethers';
import { compile } from '../scripts/compile.mjs';

const builds = compile({
  'TestAgentId.sol': { content: 'pragma solidity ^0.8.24; contract TestAgentId {mapping(address=>uint) public balanceOf; constructor(address account) {balanceOf[account] = 1;}}' },
});
const chain = ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 3 } });
const provider = new ethers.BrowserProvider(chain, undefined, { cacheTimeout: -1 });
provider.pollingInterval = 10;
try {
  const [operator, agent, guest] = await Promise.all([0, 1, 2].map(i => provider.getSigner(i)));
  const deploy = async (a, args) => {
    const c = await new ethers.ContractFactory(a.abi, a.evm.bytecode.object, operator).deploy(...args);
    return c.waitForDeployment();
  };
  const registry = await deploy(builds['TestAgentId.sol'].TestAgentId, [await agent.getAddress()]);
  const rewards = await deploy(builds['src/SurvivalRewards.sol'].SurvivalRewards, [await registry.getAddress()]);
  const result = ethers.id('seven days');
  const value = ethers.parseEther('0.01');
  await assert.rejects(() => rewards.connect(guest).activateCareer());
  await (await rewards.connect(agent).activateCareer()).wait();
  assert.equal(await rewards.activeCareer(agent.address), true);
  await assert.rejects(() => rewards.reserve(guest.address, 1, result, { value }));
  await (await rewards.reserve(agent.address, 1, result, { value })).wait();
  await assert.rejects(() => rewards.reserve(agent.address, 1, result, { value }));
  await assert.rejects(() => rewards.connect(guest).claim(1));
  await (await rewards.connect(agent).claim(1)).wait();
  const award = await rewards.awards(agent.address, 1);
  assert.equal(award.paid, true);
  assert.equal(award.result, result);
  assert.equal(award.amount, value);
  await assert.rejects(() => rewards.connect(agent).claim(1));
  console.log('PASS: funded BNB award fixed to one .ai, week and result, with one claim');
} finally { await chain.disconnect(); }
