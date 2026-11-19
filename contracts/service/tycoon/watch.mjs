// Follows TimesSquareCity on BNB Chain: reads its clock once, then polls its logs in block ranges small enough
// for public RPCs, and the BNB it holds. Read-only: it never signs anything.
import { ethers } from 'ethers';
import { CITY_ABI, eventsFromLogs } from './chain.mjs';

const ABI = [...CITY_ABI, 'function epoch() view returns (uint256)', 'function dayLength() view returns (uint256)', 'function reserved() view returns (uint256)'];

/**
 * @param {{rpc?: string, provider?: ethers.AbstractProvider, address: string, fromBlock?: number, every?: number, step?: number}} o
 * @returns {Promise<{epoch: number, dayMs: number, address: string, revision: () => number, events: (season: number) => object[], logs: () => object[], pool: () => ({bnbWei: string, reservedWei: string} | null), head: () => number, sync: () => Promise<void>, stop: () => void}>}
 */
export async function watchCity({ rpc, provider: given, address, fromBlock = 0, every = 15_000, step = 4_000 }) {
  const provider = given ?? new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  const city = new ethers.Contract(address, ABI, provider);
  const [epoch, dayLength] = await Promise.all([city.epoch(), city.dayLength()]);
  const logs = [];
  let next = fromBlock, revision = 0, pool = null, timer = null, busy = null;
  /** Reads every log up to the chain head; a call while one is running waits for that one. */
  function poll() {
    busy ??= pull().finally(() => { busy = null; });
    return busy;
  }
  async function pull() {
    try {
      const head = await provider.getBlockNumber();
      while (next <= head) {
        const to = Math.min(head, next + step - 1);
        const got = await provider.getLogs({ address, fromBlock: next, toBlock: to });
        if (got.length) { logs.push(...got); revision++; }
        next = to + 1;
      }
      const [bal, reserved] = await Promise.all([provider.getBalance(address), city.reserved()]);
      pool = { bnbWei: bal.toString(), reservedWei: reserved.toString() };
    } catch (e) {
      console.warn('city watch:', e.shortMessage ?? e.message);
    }
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
    /** The last block whose logs are all in. */
    head: () => next - 1,
    sync: poll,
    stop: () => clearInterval(timer),
  };
}
