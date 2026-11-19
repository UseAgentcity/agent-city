import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';

/** Resolves `@openzeppelin/...` and `src/...` imports for solc. */
function findImports(name) {
  for (const base of ['node_modules', '.']) {
    const file = path.join(base, name);
    if (fs.existsSync(file)) return { contents: fs.readFileSync(file, 'utf8') };
  }
  return { error: `not found: ${name}` };
}

/** Compiles every contract in src/ (plus any extra test sources) and writes ABI and bytecode to artifacts/. */
export function compile(extraSources = {}) {
  const sources = { ...extraSources };
  for (const f of fs.readdirSync('src').filter((f) => f.endsWith('.sol'))) sources[`src/${f}`] = { content: fs.readFileSync(`src/${f}`, 'utf8') };
  const result = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  }), { import: findImports }));
  const errors = (result.errors || []).filter(e => e.severity === 'error');
  if (errors.length) throw Error(errors.map(e => e.formattedMessage).join('\n'));
  fs.mkdirSync('artifacts', { recursive: true });
  for (const cs of Object.values(result.contracts)) for (const [name, c] of Object.entries(cs)) {
    if (c.evm.bytecode.object) fs.writeFileSync(`artifacts/${name}.json`, JSON.stringify(c, null, 2));
  }
  return result.contracts;
}
if (process.argv[1]?.endsWith('compile.mjs')) { compile(); console.log('Contracts compiled'); }
