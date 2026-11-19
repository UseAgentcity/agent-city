// Plays demo seasons with the reference shopkeepers and prints, per shop: the season score (what ranks),
// city-coin profit and tokens spent; then the city's token flows. Usage: npm run sim [seasons]
import { DAYS, runSeason } from '../service/tycoon/engine.mjs';
import { demoEvents } from '../service/tycoon/demo.mjs';
import { LOTS } from '../service/tycoon/lots.mjs';

const seasons = Number(process.argv[2] || 40);
const per = new Map();
const flow = { total: 0, burned: 0, treasury: 0, sponsored: 0 };
for (let k = 0; k < seasons; k++) {
  const seed = `sim-${k}`;
  const city = runSeason({ seed, lots: LOTS, events: demoEvents(seed, LOTS, DAYS), days: DAYS });
  for (const s of city.standings) {
    if (!per.has(s.name)) per.set(s.name, { score: [], profit: [], spent: [], top: 0 });
    const p = per.get(s.name);
    p.score.push(s.score); p.profit.push(s.profit); p.spent.push(s.tokensSpent);
    if (city.standings.indexOf(s) < Math.ceil(city.standings.length * 0.3)) p.top++;
  }
  flow.total += city.tokens.total; flow.burned += city.tokens.burned; flow.treasury += city.tokens.treasury;
  flow.sponsored += city.days.filter((d) => d.sponsor).length;
}
const med = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
const k = (n) => `${Math.round(n / 1000)}k`;
console.log(`${seasons} demo seasons — medians per shop`);
console.log('shop'.padEnd(12), 'score'.padStart(6), 'profit'.padStart(8), 'tokens'.padStart(8), 'top30%'.padStart(7));
for (const [name, p] of [...per].sort((a, b) => med(b[1].score) - med(a[1].score))) {
  console.log(name.padEnd(12), String(med(p.score)).padStart(6), String(med(p.profit)).padStart(8), k(med(p.spent)).padStart(8), `${Math.round((100 * p.top) / seasons)}%`.padStart(7));
}
console.log(`\ntokens per season: spent ${k(flow.total / seasons)}, burned ${k(flow.burned / seasons)}, treasury ${k(flow.treasury / seasons)}; sponsored days ${(flow.sponsored / seasons).toFixed(1)} of ${DAYS}`);
