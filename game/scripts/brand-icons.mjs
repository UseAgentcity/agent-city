// Writes the Agent City mark's icon files from its one definition (client/src/brand.ts):
// public/brand/agent-city.svg (favicon, rounded tile) and agent-city-square.svg (full bleed, for touch icons).
// The 180 px touch icon PNG is rendered from the square SVG (on macOS: qlmanage; see the README line below).
//   node scripts/brand-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brandSvg } from '../client/src/brand.ts';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'public', 'brand');
fs.writeFileSync(path.join(dir, 'agent-city.svg'), brandSvg('rounded'));
fs.writeFileSync(path.join(dir, 'agent-city-square.svg'), brandSvg('square'));
console.log('wrote agent-city.svg and agent-city-square.svg in', dir);
