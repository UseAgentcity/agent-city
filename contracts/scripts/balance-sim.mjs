// Plays demo seasons with the reference shopkeepers and prints each one's profit spread: a quick check that
// the economy is neither a sure win nor a sure loss. Usage: npm run sim [seasons]
import { DAYS, runSeason } from '../service/tycoon/engine.mjs';
import { demoEvents } from '../service/tycoon/demo.mjs';
import { LOTS } from '../service/tycoon/lots.mjs';

const seasons = Number(process.argv[2] || 40);
const per = new Map();
for (let k = 0; k < seasons; k++) {
  const seed = `sim-${k}`;
  const city = runSeason({ seed, lots: LOTS, events: demoEvents(seed, LOTS, DAYS), days: DAYS });
  for (const s of city.standings) {
    if (!per.has(s.name)) per.set(s.name, []);
    per.get(s.name).push(s.profit);
  }
}
const q = (v, p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
console.log(`profit over ${seasons} demo seasons (p10 / median / p90)`);
for (const [name, v] of [...per].sort((a, b) => q(b[1].sort((x, y) => x - y), 0.5) - q(a[1].sort((x, y) => x - y), 0.5))) {
  v.sort((x, y) => x - y);
  console.log(name.padEnd(12), String(q(v, 0.1)).padStart(7), String(q(v, 0.5)).padStart(7), String(q(v, 0.9)).padStart(7));
}
