// Settles a finished season of TimesSquareCity: replays its logs through the engine, works out every Agent's BNB
// award and deposit refund, writes game-data/settlements/season-N.json (served at /api/arena/claim) and prints the
// publish() arguments. Anyone can run it without --send to check the operator's post against the chain: a posted
// season is recomputed with the budget its result URI records, and the roots compared.
//
//   node --env-file=.env.game scripts/settle.mjs <season>          # compute and write, read-only
//   node --env-file=.env.game scripts/settle.mjs <season> --send   # also publish (needs OPERATOR_KEY)
import { ethers } from 'ethers';
import { CITY_ABI } from '../service/tycoon/chain.mjs';
import { watchCity } from '../service/tycoon/watch.mjs';
import { computeSettlement, summary, writeSettlement } from '../service/tycoon/settlement.mjs';
import { budgetFromUri } from '../service/tycoon/settler.mjs';

const season = Number(process.argv[2]);
const send = process.argv.includes('--send');
const { TYCOON_RPC: rpc, TYCOON_CONTRACT: address, TYCOON_FROM_BLOCK: from = '0', TYCOON_RESULT_BASE: resultBase = '' } = process.env;
const key = process.env.OPERATOR_KEY || process.env.TYCOON_OPERATOR_KEY; // the operator wallet set at deploy
if (!Number.isInteger(season) || season < 1 || !rpc || !address) {
  console.error('usage: settle.mjs <season> [--send]   (needs TYCOON_RPC and TYCOON_CONTRACT)');
  process.exit(1);
}
const w = await watchCity({ rpc, address, fromBlock: Number(from), every: 3_600_000 });
w.stop();
const provider = new ethers.JsonRpcProvider(rpc);
const cityRead = new ethers.Contract(address, [...CITY_ABI, 'function seasonEnd(uint256) view returns (uint256)', 'function seasonInfo(uint256) view returns (tuple(uint256 deposits, uint256 sponsorBids, bytes32 root, uint256 bnbTotal, uint256 bnbClaimed, uint256 tokensSpent, uint256 refunds, uint256 refundsClaimed, uint64 publishedAt, uint64 claimUntil, bool challenged, bool finalized, bool released, bool abandoned, string resultUri))'], provider);
const end = Number(await cityRead.seasonEnd(season));
if (Date.now() / 1000 < end) { console.error(`Season ${season} is still running (day 7 ends ${new Date(end * 1000).toISOString()}).`); process.exit(1); }

// Checking a post: recompute with the budget it recorded and compare roots. Otherwise use today's budget.
const posted = await cityRead.seasonInfo(season);
const postedBudget = Number(posted.publishedAt) ? budgetFromUri(posted.resultUri) : null;
const budget = postedBudget ?? await cityRead.seasonBudget();
const s = computeSettlement(w, season, budget);
if (!s.root) { console.log(`Season ${season}: nothing to settle (no deposits, no winners).`); process.exit(0); }
writeSettlement(w, season, budget, s);
console.log(summary(season, s));
if (postedBudget != null) console.log(s.root.toLowerCase() === posted.root.toLowerCase() ? 'matches the posted root' : `DOES NOT MATCH the posted root ${posted.root}`);
if (send) {
  if (!key) { console.error('OPERATOR_KEY is not set.'); process.exit(1); }
  const signer = new ethers.Wallet(key, provider);
  const c = new ethers.Contract(address, ['function publish(uint256,bytes32,uint256,uint256,uint256,string)'], signer);
  const tx = await c.publish(season, s.root, s.bnbTotal, s.tokensSpent, s.refunds, `${resultBase}season-${season}.json?budget=${budget}`);
  console.log('publish tx', tx.hash);
  await tx.wait();
}
