// A season's settlement, computed from the chain: replay its logs through the engine, work out every Agent's BNB
// award and deposit refund, and write game-data/settlements/season-N.json (served at /api/arena/claim). Shared
// by the one-off settle script and the automatic settler, so both always post the same thing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { depositsFromLogs, replaySeason, settleSeason } from './chain.mjs';
import { DAYS } from './engine.mjs';

export const SETTLEMENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'game-data', 'settlements');

const json = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2);

/**
 * @param {object} watch  watchCity(...) after it has read the season's logs
 * @param {number} season
 * @param {bigint} budgetWei  the contract's seasonBudget() (at posting time; for a re-check, the posted total's budget)
 */
export function computeSettlement(watch, season, budgetWei) {
  const played = replaySeason(watch.address, season, watch.events(season), DAYS);
  const s = settleSeason(played, { season, budgetWei, depositsWei: depositsFromLogs(watch.logs(), season) });
  return { ...s, played };
}

/** Writes the season's file (claims, proofs and standings). Returns its path. */
export function writeSettlement(watch, season, budgetWei, s, dir = SETTLEMENT_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `season-${season}.json`);
  const { played, ...rest } = s;
  fs.writeFileSync(file, json({ season, contract: watch.address, budgetWei, ...rest, standings: played.standings.map(({ history, ...x }) => x) }));
  return file;
}

export const settlementFile = (season, dir = SETTLEMENT_DIR) => path.join(dir, `season-${season}.json`);
export const summary = (season, s) => json({ season, root: s.root, bnbTotal: s.bnbTotal, tokensSpent: s.tokensSpent, refunds: s.refunds, claims: s.claims.length });
