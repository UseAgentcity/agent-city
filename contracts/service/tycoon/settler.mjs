// The automatic settler: run by the operator, it keeps every season moving without anyone at the keyboard.
//   day 7 over, not posted     → wait until the season's logs are all in, compute, write the claims file, publish
//   posted, window passed      → finalize (claims open)
//   challenged                 → recompute and re-post (up to `maxReposts` times a season, then stop and alert)
//   claim window over          → release unclaimed BNB back to the pool
//   posted but no claims file  → recompute it (after a restart) and check it against the posted root
// Each post records the season budget in its result URI, so anyone can recompute the same root later.
import fs from 'node:fs';
import { ethers } from 'ethers';
import { computeSettlement, settlementFile, writeSettlement, SETTLEMENT_DIR } from './settlement.mjs';

const ABI = [
  'function clock() view returns (uint256 season, uint256 day)',
  'function seasonEnd(uint256) view returns (uint256)',
  'function seasonBudget() view returns (uint256)',
  'function CHALLENGE_WINDOW() view returns (uint256)',
  'function seasonInfo(uint256) view returns (tuple(uint256 deposits, uint256 sponsorBids, bytes32 root, uint256 bnbTotal, uint256 bnbClaimed, uint256 tokensSpent, uint256 refunds, uint256 refundsClaimed, uint64 publishedAt, uint64 claimUntil, bool challenged, bool finalized, bool released, bool abandoned, string resultUri))',
  'function publish(uint256,bytes32,uint256,uint256,uint256,string)',
  'function finalize(uint256)',
  'function release(uint256)',
];

/** The budget a post was computed with, from its result URI (`…season-N.json?budget=<wei>`). */
export const budgetFromUri = (uri) => {
  const m = /[?&]budget=(\d+)/.exec(uri ?? '');
  return m ? BigInt(m[1]) : null;
};

/**
 * @param {{signer: ethers.Signer, address: string, watch: object, resultBase?: string, dir?: string, lookBack?: number, maxReposts?: number, log?: (msg: string) => void}} o
 */
export function createSettler({ signer, address, watch, resultBase = '', dir = SETTLEMENT_DIR, lookBack, maxReposts = 3, log = console.log }) {
  const city = new ethers.Contract(address, ABI, signer);
  const provider = signer.provider;
  // Look back far enough to cover the 14-day rescue limit (capped at 200 seasons, about 8 days at 1 hour a season).
  lookBack ??= Math.min(200, Math.max(2, Math.ceil((15 * 86_400_000) / (watch.dayMs * 8))));
  const reposts = new Map(), said = new Set();
  /** Final seasons whose claim window is still running: checked every pass until released, however old. */
  const open = new Set();
  let window = null;
  /** Logs a problem once per season and kind, so a stuck season does not flood the log every minute. */
  const once = (key, msg) => { if (!said.has(key)) { said.add(key); log(msg); } };
  const send = async (what, p) => { const tx = await p; log(`${what}: ${tx.hash}`); await tx.wait(); };

  async function post(season, end) {
    // Every plan for the season is in a block at or before its end: wait until the watcher has read past it.
    await watch.sync();
    const head = await provider.getBlock(watch.head());
    if (!head || head.timestamp < end) return false;
    const budget = await city.seasonBudget();
    const s = computeSettlement(watch, season, budget);
    if (!s.root) { once(`empty:${season}`, `season ${season}: nothing to settle (no deposits, no winners)`); return false; }
    writeSettlement(watch, season, budget, s, dir);
    await send(`season ${season}: published ${ethers.formatEther(s.bnbTotal)} BNB to ${s.claims.length} Agents`,
      city.publish(season, s.root, s.bnbTotal, s.tokensSpent, s.refunds, `${resultBase}season-${season}.json?budget=${budget}`));
    return true;
  }

  /** One pass over recent seasons; returns what it did. Safe to call as often as you like. */
  async function tick() {
    window ??= Number(await city.CHALLENGE_WINDOW());
    const [current] = (await city.clock()).map(Number);
    const now = (await provider.getBlock('latest')).timestamp;
    const done = [];
    const seasons = new Set(open);
    for (let season = Math.max(1, current - lookBack); season <= current; season++) seasons.add(season);
    for (const season of [...seasons].sort((p, q) => p - q)) {
      const end = Number(await city.seasonEnd(season));
      if (now < end) continue;
      const x = await city.seasonInfo(season);
      if (x.abandoned || x.released) { open.delete(season); continue; }
      try {
        if (x.finalized) {
          if (now <= Number(x.claimUntil)) { open.add(season); await ensureFile(season, x); continue; }
          open.delete(season);
          if (x.bnbTotal > x.bnbClaimed) { await send(`season ${season}: released unclaimed BNB`, city.release(season)); done.push(`release ${season}`); }
          continue;
        }
        if (Number(x.publishedAt) === 0) { if (await post(season, end)) done.push(`publish ${season}`); continue; }
        if (x.challenged) {
          const n = reposts.get(season) ?? 0;
          if (n >= maxReposts) { once(`stuck:${season}`, `season ${season}: challenged again after ${n} re-posts; stopped, check it by hand`); continue; }
          reposts.set(season, n + 1);
          log(`season ${season}: challenged, recomputing and re-posting (${n + 1}/${maxReposts})`);
          if (await post(season, end)) done.push(`repost ${season}`);
          continue;
        }
        await ensureFile(season, x);
        if (now >= Number(x.publishedAt) + window) { await send(`season ${season}: finalized, claims open`, city.finalize(season)); done.push(`finalize ${season}`); open.add(season); }
      } catch (e) {
        log(`season ${season}: ${e.shortMessage ?? e.message}`);
      }
    }
    return done;
  }

  /** After a restart: rebuild a posted season's claims file from the chain and check it matches the posted root. */
  async function ensureFile(season, x) {
    if (fs.existsSync(settlementFile(season, dir))) return;
    const budget = budgetFromUri(x.resultUri);
    if (budget == null) { once(`nobudget:${season}`, `season ${season}: no claims file and no budget in its result URI; run settle.mjs by hand`); return; }
    await watch.sync();
    const s = computeSettlement(watch, season, budget);
    if (String(s.root).toLowerCase() !== String(x.root).toLowerCase()) { once(`mismatch:${season}`, `season ${season}: recomputed root ${s.root} does not match the posted ${x.root}`); return; }
    writeSettlement(watch, season, budget, s, dir);
    log(`season ${season}: rebuilt the claims file`);
  }

  return { tick };
}
