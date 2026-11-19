// The automatic settler, for the operator's server: every minute it looks at the city's clock and publishes,
// finalizes and releases seasons as they come due (see service/tycoon/settler.mjs). Run it next to the game
// server, which serves the claims files it writes.
//
//   npm run auto-settle            # keeps running
//   npm run auto-settle -- --once  # one pass, then exit (for cron)
//
// Needs TYCOON_RPC, TYCOON_CONTRACT and OPERATOR_KEY (the operator wallet set at deploy; it pays gas for a
// few transactions a season). Optional: TYCOON_FROM_BLOCK (the deploy block), TYCOON_RESULT_BASE (public URL the
// claims files are served under, e.g. https://example.com/api/arena/settlements/).
import { ethers } from 'ethers';
import { watchCity } from '../service/tycoon/watch.mjs';
import { createSettler } from '../service/tycoon/settler.mjs';

const { TYCOON_RPC: rpc, TYCOON_CONTRACT: address, TYCOON_FROM_BLOCK: from = '0', TYCOON_RESULT_BASE: resultBase = '' } = process.env;
const key = process.env.OPERATOR_KEY || process.env.TYCOON_OPERATOR_KEY; // the operator wallet set at deploy
if (!rpc || !address || !key) {
  console.error('auto-settle needs TYCOON_RPC, TYCOON_CONTRACT and OPERATOR_KEY (in .env.game).');
  process.exit(1);
}
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (msg) => console.log(`${stamp()}  ${msg}`);
const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
const signer = new ethers.Wallet(key, provider);
const watch = await watchCity({ provider, address, fromBlock: Number(from), every: 60_000 });
const settler = createSettler({ signer, address, watch, resultBase, log });
log(`auto-settle: city ${address}, operator ${signer.address}, game day ${watch.dayMs / 60_000} min`);

const once = process.argv.includes('--once');
for (;;) {
  try { await settler.tick(); } catch (e) { log(`tick failed: ${e.shortMessage ?? e.message}`); }
  if (once) break;
  await new Promise((r) => setTimeout(r, 60_000));
}
watch.stop();
