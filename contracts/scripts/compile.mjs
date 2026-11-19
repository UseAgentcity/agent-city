import fs from 'node:fs';
import solc from 'solc';

/** Compiles SurvivalRewards (plus any extra test sources) and writes ABI and bytecode to artifacts/. */
export function compile(extraSources = {}) {
  const sources = { 'src/SurvivalRewards.sol': { content: fs.readFileSync('src/SurvivalRewards.sol', 'utf8') }, ...extraSources };
  const result = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  })));
  const errors = (result.errors || []).filter(e => e.severity === 'error');
  if (errors.length) throw Error(errors.map(e => e.formattedMessage).join('\n'));
  fs.mkdirSync('artifacts', { recursive: true });
  for (const cs of Object.values(result.contracts)) for (const [name, c] of Object.entries(cs)) {
    if (c.evm.bytecode.object) fs.writeFileSync(`artifacts/${name}.json`, JSON.stringify(c, null, 2));
  }
  return result.contracts;
}
if (process.argv[1]?.endsWith('compile.mjs')) { compile(); console.log('Contracts compiled'); }
