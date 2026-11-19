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

/** The compiler settings every build uses; BscScan verification must use the same. */
export const SETTINGS = { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai' };
export const solcVersion = () => solc.version();

const srcFiles = () => Object.fromEntries(fs.readdirSync('src').filter((f) => f.endsWith('.sol')).map((f) => [`src/${f}`, { content: fs.readFileSync(`src/${f}`, 'utf8') }]));

/**
 * The standard-JSON input for verifying the deployed contracts on BscScan: src/ plus every file it imports
 * (OpenZeppelin), with the build settings. Upload it as "Solidity (Standard-Json-Input)".
 */
export function standardInput() {
  const sources = srcFiles();
  const used = {};
  solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { ...SETTINGS, outputSelection: {} } }), {
    import: (name) => { const r = findImports(name); if (r.contents) used[name] = { content: r.contents }; return r; },
  });
  return { language: 'Solidity', sources: { ...sources, ...used }, settings: { ...SETTINGS, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata'] } } } };
}

/** Compiles every contract in src/ (plus any extra test sources) and writes ABI and bytecode to artifacts/. */
export function compile(extraSources = {}) {
  const sources = { ...extraSources, ...srcFiles() };
  const result = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources,
    settings: { ...SETTINGS, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
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
