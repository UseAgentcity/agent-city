// Settles a finished season of TimesSquareCity: replays its logs through the engine, works out every Agent's BNB
// award and deposit refund, writes game-data/settlements/season-N.json (served at /api/arena/claim) and prints the
// publish() arguments. Anyone can run it without --send to check the operator's post against the chain.
//
//   node --env-file=.env.game scripts/settle.mjs <season>          # compute and write, read-only
//   node --env-file=.env.game scripts/settle.mjs <season> --send   # also publish (needs TYCOON_OPERATOR_KEY)
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import { CITY_ABI, depositsFromLogs, replaySeason, settleSeason } from '../service/tycoon/chain.mjs';
import { watchCity } from '../service/tycoon/watch.mjs';
import { DAYS } from '../service/tycoon/engine.mjs';

const season = Number(process.argv[2]);
const send = process.argv.includes('--send');
const { TYCOON_RPC: rpc, TYCOON_CONTRACT: address, TYCOON_FROM_BLOCK: from = '0', TYCOON_OPERATOR_KEY: key } = process.env;
if (!Number.isInteger(season) || season < 1 || !rpc || !address) {
  console.error('usage: settle.mjs <season> [--send]   (needs TYCOON_RPC and TYCOON_CONTRACT)');
  process.exit(1);
}
const w = await watchCity({ rpc, address, fromBlock: Number(from), every: 3_600_000 });
w.stop();
const provider = new ethers.JsonRpcProvider(rpc);
const cityRead = new ethers.Contract(address, [...CITY_ABI, 'function seasonEnd(uint256) view returns (uint256)'], provider);
const end = Number(await cityRead.seasonEnd(season));
if (Date.now() / 1000 < end) { console.error(`Season ${season} is still running (day 7 ends ${new Date(end * 1000).toISOString()}).`); process.exit(1); }

const played = replaySeason(w.address, season, w.events(season), DAYS);
const budget = await cityRead.seasonBudget();
const s = settleSeason(played, { season, budgetWei: budget, depositsWei: depositsFromLogs(w.logs(), season) });
if (!s.root) { console.log(`Season ${season}: nothing to settle (no deposits, no winners).`); process.exit(0); }
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2);
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'game-data', 'settlements');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `season-${season}.json`), json({ season, contract: w.address, budgetWei: budget, ...s, standings: played.standings.map(({ history, ...x }) => x) }));
console.log(json({ season, root: s.root, bnbTotal: s.bnbTotal, tokensSpent: s.tokensSpent, refunds: s.refunds, claims: s.claims.length }));
if (send) {
  if (!key) { console.error('TYCOON_OPERATOR_KEY is not set.'); process.exit(1); }
  const signer = new ethers.Wallet(key, provider);
  const c = new ethers.Contract(address, ['function publish(uint256,bytes32,uint256,uint256,uint256,string)'], signer);
  const tx = await c.publish(season, s.root, s.bnbTotal, s.tokensSpent, s.refunds, process.env.TYCOON_RESULT_URI || `season-${season}.json`);
  console.log('publish tx', tx.hash);
  await tx.wait();
}
