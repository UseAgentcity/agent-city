// The Agent skill's dependency-free encoder must produce exactly the calldata ethers does, byte for byte.
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { checkPlan, encodeApprove, encodeClaim, encodeEnter, encodeLeave, encodePlan, encodeSponsor, planTarget, toWei } from '../../skills/times-square-tycoon/scripts/city.mjs';

const i = new ethers.Interface([
  'function enter(uint256,uint256)', 'function plan(uint256,uint256,bytes,string)', 'function sponsor(uint256,uint256,uint8,uint256)',
  'function claim(uint256,uint256,uint256,bytes32[])', 'function approve(address,uint256)', 'function leave(uint256)',
]);
const u8 = (s) => new TextEncoder().encode(s);
assert.equal(encodeEnter(3, toWei('400000')), i.encodeFunctionData('enter', [3, ethers.parseEther('400000')]));
assert.equal(encodeEnter(1, 0n), i.encodeFunctionData('enter', [1, 0]));
assert.equal(toWei('1.5'), ethers.parseEther('1.5'));
for (const [actions, memo] of [[{}, ''], [{ price: 'premium', stock: 900 }, '今晚开演 · 散场来一杯'], [{ lease: [{ lot: 'sq-c1', bid: 300000 }], brand: { name: 'NOVA', slogan: 'x'.repeat(28), color: '#ff7a45' } }, 'a'.repeat(160)]]) {
  const bytes = u8(JSON.stringify(actions));
  assert.equal(encodePlan(7, 2, bytes, u8(memo)), i.encodeFunctionData('plan', [7, 2, bytes, memo]), `plan ${JSON.stringify(actions)}`);
}
assert.equal(encodeSponsor(2, 5, 4, toWei('60000')), i.encodeFunctionData('sponsor', [2, 5, 4, ethers.parseEther('60000')]));
const proof = [ethers.id('a'), ethers.id('b'), ethers.id('c')];
assert.equal(encodeClaim(4, 123n, 456n, proof), i.encodeFunctionData('claim', [4, 123n, 456n, proof]));
assert.equal(encodeClaim(4, 0n, 9n, []), i.encodeFunctionData('claim', [4, 0n, 9n, []]));
assert.equal(encodeLeave(12), i.encodeFunctionData('leave', [12]));
const spender = '0x000000000000000000000000000000000000dEaD';
assert.equal(encodeApprove(spender, toWei('10')), i.encodeFunctionData('approve', [spender, ethers.parseEther('10')]));

// Plans are checked before they cost gas.
assert.deepEqual(checkPlan({ price: 'standard', stock: 500 }), []);
assert.ok(checkPlan({ price: 'cheap' }).length);
assert.ok(checkPlan({ ad: { screen: 1, bid: 20000, title: 'see t.me/x' } }).some((p) => p.includes('plain text')));
assert.ok(checkPlan({ ad: { screen: 1, bid: 20000, title: 'Binance 同款' } }).some((p) => p.includes('brands')));
assert.ok(checkPlan({ stock: 1 }, 'x'.repeat(161)).some((p) => p.includes('memo')));
// The plan window follows the contract: day 1 only on the settling day before; day 1 itself points at day 2.
assert.deepEqual(planTarget({ id: 4, day: null, settling: true }), { season: 5, day: 1, openNow: true });
assert.equal(planTarget({ id: 4, day: 1, settling: false, dayEndsAt: 9 }).day, 2);
assert.deepEqual(planTarget({ id: 4, day: 3, settling: false }), { season: 4, day: 3, openNow: true });
console.log('PASS: skill encoder matches ethers for enter, plan (UTF-8), sponsor, claim, approve, leave; plan checks; plan window');
