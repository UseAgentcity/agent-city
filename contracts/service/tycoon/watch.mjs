// Follows TimesSquareCity on BNB Chain: reads its clock once, then polls its logs in block ranges small enough
// for public RPCs, and the BNB it holds. Read-only: it never signs anything.
import { ethers } from 'ethers';
import { CITY_ABI, eventsFromLogs } from './chain.mjs';

const ABI = [...CITY_ABI, 'function epoch() view returns (uint256)', 'function dayLength() view returns (uint256)', 'function reserved() view returns (uint256)',
  'function upgradeAdmin() view returns (address)'];

/**
 * @param {{rpc: string, address: string, fromBlock?: number, every?: number, step?: number}} o
 * @returns {Promise<{epoch: number, dayMs: number, address: string, revision: () => number, events: (season: number) => object[], logs: () => object[], pool: () => ({bnbWei: string, reservedWei: string} | null), stop: () => void}>}
 */
export async function watchCity({ rpc, address, fromBlock = 0, every = 15_000, step = 4_000 }) {
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  const city = new ethers.Contract(address, ABI, provider);
  const [epoch, dayLength] = await Promise.all([city.epoch(), city.dayLength()]);
  const logs = [];
  let next = fromBlock, revision = 0, pool = null, timer = null, busy = false;
  async function poll() {
    if (busy) return;
    busy = true;
    try {
      const head = await provider.getBlockNumber();
      while (next <= head) {
        const to = Math.min(head, next + step - 1);
        const got = await provider.getLogs({ address, fromBlock: next, toBlock: to });
        if (got.length) { logs.push(...got); revision++; }
        next = to + 1;
      }
      const [bal, reserved, admin] = await Promise.all([provider.getBalance(address), city.reserved(), city.upgradeAdmin()]);
      // Who can upgrade the contract is shown publicly next to the pool it could touch.
      pool = { bnbWei: bal.toString(), reservedWei: reserved.toString(), upgradeAdmin: admin === ethers.ZeroAddress ? null : admin };
    } catch (e) {
      console.warn('city watch:', e.shortMessage ?? e.message);
    } finally { busy = false; }
  }
  await poll();
  timer = setInterval(poll, every);
  timer.unref?.();
  return {
    epoch: Number(epoch) * 1000, dayMs: Number(dayLength) * 1000, address: address.toLowerCase(),
    revision: () => revision,
    events: (season) => eventsFromLogs(logs, season),
    logs: () => logs,
    pool: () => pool,
    stop: () => clearInterval(timer),
  };
}
