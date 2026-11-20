// Deploys Times Square Tycoon to BNB Chain mainnet, in steps that each check before they act.
//
//   node --env-file=.env.game scripts/deploy.mjs check            read-only: config, Agent ID contract, balance,
//                                                                  and a full rehearsal on a local mainnet fork
//   node --env-file=.env.game scripts/deploy.mjs deploy --send     implementation + CityProxy, from DEPLOYER_KEY
//   node --env-file=.env.game scripts/deploy.mjs set-token <token> checks the Flap token pays its tax to the proxy
//                                                                  in native BNB; with --send, OPERATOR_KEY calls setToken
//   node --env-file=.env.game scripts/deploy.mjs status            the live contract's state
//
// Keys are read from the environment and never printed. Every --send step shows what it will do and waits for you to
// type the confirmation word (or pass --yes). Results go to deployments/bsc-mainnet.json (git-ignored).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import ganache from 'ganache';
import { ethers } from 'ethers';
import { compile, solcVersion, standardInput, SETTINGS } from './compile.mjs';

const AGENT_ID = '0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F'; // SPACE ID Agent ID (symbol AI), checked on chain below
const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'; // ERC-1967 implementation
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const OUT = path.join('deployments', 'bsc-mainnet.json');
const env = process.env;
const [cmd = 'check', arg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = new Set(process.argv.filter((a) => a.startsWith('--')));
const RPC = env.TYCOON_RPC || 'https://bsc-dataseed.bnbchain.org';
const FORK_RPC = env.FORK_RPC || 'https://bsc-mainnet.public.blastapi.io';
const main = new ethers.JsonRpcProvider(RPC, 56, { staticNetwork: true });
const log = (...a) => console.log(...a);
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
const ok = (msg) => log(`✓ ${msg}`);

function config() {
  const addr = (name) => {
    const v = env[name];
    if (!v || !ethers.isAddress(v)) fail(`${name} must be an address (set it in .env.game)`);
    return ethers.getAddress(v);
  };
  const deployer = addr('TYCOON_DEPLOYER'), operator = addr('TYCOON_OPERATOR'), treasury = addr('TYCOON_TREASURY');
  const rawEpoch = env.TYCOON_EPOCH;
  const epoch = /^\d+$/.test(rawEpoch ?? '') ? Number(rawEpoch) : Math.floor(Date.parse(rawEpoch ?? '') / 1000);
  if (!Number.isFinite(epoch)) fail('TYCOON_EPOCH must be unix seconds or an ISO time (when season 1 starts)');
  const day = Number(env.TYCOON_DAY_SECONDS);
  if (!Number.isInteger(day) || day < 60) fail('TYCOON_DAY_SECONDS must be a whole number ≥ 60 (one game day)');
  return { deployer, operator, treasury, epoch, day };
}

function show(c) {
  log(`  deployer (upgrade admin) ${c.deployer}`);
  log(`  operator                 ${c.operator}${c.operator === c.deployer ? '  (same as deployer)' : ''}`);
  log(`  treasury                 ${c.treasury}`);
  log(`  season 1 starts          ${new Date(c.epoch * 1000).toISOString()}`);
  log(`  game day                 ${c.day} s (${(c.day / 3600).toFixed(2)} h); season ${((c.day * 8) / 3600).toFixed(1)} h with settling`);
  log(`  Agent ID contract        ${AGENT_ID}`);
  // The settling day holds the operator's publish and the contract's 1-hour challenge window.
  if (c.day < 5400) log(`  ! a game day under 1.5 h leaves the settling day too short for the publish and the 1-hour challenge window`);
}

async function preflight(c) {
  const net = await main.getNetwork();
  if (net.chainId !== 56n) fail(`RPC is chain ${net.chainId}, not BNB Chain (56)`);
  const id = new ethers.Contract(AGENT_ID, ['function name() view returns (string)', 'function symbol() view returns (string)'], main);
  const [name, symbol] = await Promise.all([id.name(), id.symbol()]);
  if (name !== 'SPACE ID Agent ID' || symbol !== 'AI') fail(`unexpected Agent ID contract: ${name} / ${symbol}`);
  ok(`Agent ID contract: ${name} (${symbol})`);
  if (c.treasury === c.deployer) log('! the treasury is the deployer wallet; a multisig is better for a public treasury');
  const now = Math.floor(Date.now() / 1000);
  if (c.epoch < now + 600) log(`! season 1 starts ${c.epoch < now ? 'in the past' : 'within 10 minutes'}: day 1 plans are only taken before it starts`);
  if (c.day < 600) log('! game days under 10 minutes are for demos');
  for (const [k, a] of Object.entries({ treasury: c.treasury, operator: c.operator })) if ((await main.getCode(a)) !== '0x') ok(`${k} is a contract (e.g. a multisig)`);
}

/** Deploys implementation + proxy with `signer`; returns the addresses, gas and receipts. */
async function deployWith(signer, c, build) {
  const City = build['src/TimesSquareCity.sol'].TimesSquareCity, Proxy = build['src/CityProxy.sol'].CityProxy;
  const impl = await (await new ethers.ContractFactory(City.abi, City.evm.bytecode.object, signer).deploy()).waitForDeployment();
  const implTx = await impl.deploymentTransaction().wait();
  const init = new ethers.Interface(City.abi).encodeFunctionData('initialize', [AGENT_ID, c.operator, c.treasury, c.epoch, c.day]);
  const proxy = await (await new ethers.ContractFactory(Proxy.abi, Proxy.evm.bytecode.object, signer).deploy(await impl.getAddress(), init)).waitForDeployment();
  const proxyTx = await proxy.deploymentTransaction().wait();
  const ctorArgs = ethers.AbiCoder.defaultAbiCoder().encode(['address', 'bytes'], [await impl.getAddress(), init]);
  return { implementation: await impl.getAddress(), proxy: await proxy.getAddress(), implTx, proxyTx, ctorArgs, gas: implTx.gasUsed + proxyTx.gasUsed, abi: City.abi };
}

/** Reads back what the proxy holds and checks it is exactly the configuration. */
async function verifyState(provider, d, c) {
  const city = new ethers.Contract(d.proxy, d.abi, provider);
  const impl = ethers.getAddress('0x' + (await provider.getStorage(d.proxy, IMPL_SLOT)).slice(26));
  const want = { implementation: d.implementation, upgradeAdmin: c.deployer, operator: c.operator, treasury: c.treasury, agentId: AGENT_ID, token: ethers.ZeroAddress };
  const got = { implementation: impl, upgradeAdmin: await city.upgradeAdmin(), operator: await city.operator(), treasury: await city.treasury(), agentId: await city.agentId(), token: await city.token() };
  for (const k of Object.keys(want)) if (got[k].toLowerCase() !== want[k].toLowerCase()) fail(`${k} is ${got[k]}, expected ${want[k]}`);
  if (Number(await city.epoch()) !== c.epoch || Number(await city.dayLength()) !== c.day) fail('clock does not match the configuration');
  ok('proxy state matches the configuration (implementation, upgrade admin, operator, treasury, Agent ID, clock, no token yet)');
  return city;
}

async function rehearse(c, build) {
  const head = await main.getBlockNumber();
  const chain = ganache.provider({ fork: { url: FORK_RPC, blockNumber: head - 2 }, chain: { chainId: 56, hardfork: 'shanghai' }, wallet: { unlockedAccounts: [c.deployer] }, logging: { quiet: true } });
  try {
    const fork = new ethers.BrowserProvider(chain, undefined, { cacheTimeout: -1 });
    fork.pollingInterval = 10;
    const real = await fork.getBalance(c.deployer);
    await fork.send('evm_setAccountBalance', [c.deployer, ethers.toQuantity(real + 10n ** 18n)]);
    const d = await deployWith(await fork.getSigner(c.deployer), c, build);
    const city = await verifyState(fork, d, c);
    // The tax arrives at the proxy as plain BNB, and a zero-value Flap ping is a quiet no-op.
    const s = await fork.getSigner(c.deployer);
    const r1 = await (await s.sendTransaction({ to: d.proxy, value: 10n ** 15n })).wait();
    const r0 = await (await s.sendTransaction({ to: d.proxy, value: 0n })).wait();
    if (r1.logs.length !== 1 || r0.logs.length !== 0) fail('receive() did not behave');
    ok(`rehearsal on a fork of block ${head - 2}: deployed for ${d.gas} gas; receives BNB tax; ${(await city.clock()).map(String).join('/')} = season/day now`);
    return d.gas;
  } finally { await chain.disconnect(); }
}

async function confirm(word, what) {
  if (flags.has('--yes')) return;
  log(`\n${what}\nType "${word}" to continue:`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('> ')).trim();
  rl.close();
  if (answer !== word) fail('not confirmed; nothing sent');
}

const signerFrom = (name, expect) => {
  const key = env[name];
  if (!key) fail(`${name} is not set (put it in .env.game, never in the repo)`);
  const w = new ethers.Wallet(key, main);
  if (expect && w.address !== expect) fail(`${name} is for ${w.address}, not ${expect}`);
  return w;
};

async function check() {
  const c = config();
  log('Times Square Tycoon — deployment check (read-only)');
  show(c);
  await preflight(c);
  const build = compile();
  const gas = await rehearse(c, build);
  const { gasPrice } = await main.getFeeData();
  const cost = gas * (gasPrice ?? 1_000_000_000n);
  const bal = await main.getBalance(c.deployer);
  log(`  estimated cost ${ethers.formatEther(cost)} BNB at ${ethers.formatUnits(gasPrice ?? 0n, 'gwei')} gwei; deployer holds ${ethers.formatEther(bal)} BNB`);
  if (bal < (cost * 3n) / 2n) fail('the deployer needs at least 1.5× the estimated cost');
  ok('ready: run `deploy --send` when you are');
  return { c, build };
}

async function deploy() {
  if (!flags.has('--send')) fail('add --send to deploy (run `check` first; it changes nothing)');
  if (fs.existsSync(OUT) && !flags.has('--again')) fail(`${OUT} exists: already deployed (use --again to deploy a second city)`);
  const { c, build } = await check();
  const signer = signerFrom('DEPLOYER_KEY', c.deployer);
  await confirm('DEPLOY', `This deploys TimesSquareCity + CityProxy to BNB Chain mainnet from ${c.deployer}. The deployer becomes the upgrade admin.`);
  const d = await deployWith(signer, c, build);
  ok(`implementation ${d.implementation} (tx ${d.implTx.hash})`);
  ok(`CityProxy      ${d.proxy} (tx ${d.proxyTx.hash}, block ${d.proxyTx.blockNumber})`);
  await verifyState(main, d, c);
  fs.mkdirSync('deployments', { recursive: true });
  const record = {
    network: 'bsc-mainnet', chainId: 56, deployedAt: new Date().toISOString(),
    proxy: d.proxy, implementation: d.implementation, fromBlock: d.implTx.blockNumber,
    txs: { implementation: d.implTx.hash, proxy: d.proxyTx.hash },
    config: { ...c, agentId: AGENT_ID },
    verify: { compiler: `v${solcVersion().replace('.Emscripten.clang', '')}`, settings: SETTINGS, input: 'deployments/verify-input.json', proxyConstructorArgs: d.ctorArgs.slice(2), contracts: { implementation: 'src/TimesSquareCity.sol:TimesSquareCity', proxy: 'src/CityProxy.sol:CityProxy' } },
  };
  fs.writeFileSync(OUT, JSON.stringify(record, null, 2));
  fs.writeFileSync(path.join('deployments', 'verify-input.json'), JSON.stringify(standardInput()));
  log(`\nSaved ${OUT} and deployments/verify-input.json.`);
  log(`
Next:
 1. Verify both on BscScan ("Solidity (Standard-Json-Input)", compiler ${record.verify.compiler}, input deployments/verify-input.json):
    implementation ${d.implementation} (no constructor arguments), proxy ${d.proxy} (constructor arguments in the JSON).
 2. Launch the token on Flap: quote token native BNB, tax 2%, longest taxDuration, all tax to the beneficiary
    (no deflation, dividend or LP share), beneficiary / tax recipient = ${d.proxy}.
 3. node --env-file=.env.game scripts/deploy.mjs set-token <token address>   (checks the routing), then again with --send.
 4. In .env.game for the API: TYCOON_CONTRACT=${d.proxy}  TYCOON_FROM_BLOCK=${d.implTx.blockNumber}`);
}

async function setToken() {
  if (!fs.existsSync(OUT)) fail(`${OUT} not found: deploy first`);
  const rec = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  if (!arg || !ethers.isAddress(arg)) fail('usage: set-token <token address> [--send]');
  const tokenAddr = ethers.getAddress(arg);
  if ((await main.getCode(tokenAddr)) === '0x') fail('no contract at that address');
  const t = new ethers.Contract(tokenAddr, ['function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function taxRate() view returns (uint16)', 'function taxProcessor() view returns (address)'], main);
  const [name, symbol, decimals] = await Promise.all([t.name(), t.symbol(), t.decimals()]);
  log(`token ${name} (${symbol}) ${tokenAddr}`);
  if (Number(decimals) !== 18) fail(`decimals ${decimals}: the city counts in 18-decimal tokens`);
  const processor = await t.taxProcessor().catch(() => null);
  if (!processor) fail('not a Flap tax token (no taxProcessor)');
  const p = new ethers.Contract(processor, ['function marketAddress() view returns (address)', 'function getQuoteToken() view returns (address)'], main);
  const [market, quote, rate] = await Promise.all([p.marketAddress(), p.getQuoteToken(), t.taxRate()]);
  // Flap's processor reports BNB-quoted tokens as WBNB (or zero on older versions); either way it unwraps and sends native BNB.
  const native = quote === ethers.ZeroAddress || quote === WBNB;
  log(`  tax ${Number(rate) / 100}% · processor ${processor} · pays ${market} in ${native ? 'native BNB' : quote}`);
  if (market.toLowerCase() !== rec.proxy.toLowerCase()) fail(`the tax goes to ${market}, not the city proxy ${rec.proxy}`);
  if (!native) fail(`the tax is paid in ${quote === WBNB ? 'WBNB' : quote}, not native BNB: the city could never use it`);
  if (Number(rate) !== 200) log(`! tax rate is ${Number(rate) / 100}%, the design says 2%`);
  ok('the token pays its tax to the city in native BNB');
  if (!flags.has('--send')) return log('Run again with --send to call setToken from OPERATOR_KEY.');
  const signer = signerFrom('OPERATOR_KEY', rec.config.operator);
  const city = new ethers.Contract(rec.proxy, ['function setToken(address)', 'function token() view returns (address)'], signer);
  if ((await city.token()) !== ethers.ZeroAddress) fail('the city token is already set (it can be set only once)');
  await confirm('SET', `This sets the city token to ${symbol} ${tokenAddr}, once and for good.`);
  const r = await (await city.setToken(tokenAddr)).wait();
  ok(`setToken tx ${r.hash}`);
  fs.writeFileSync(OUT, JSON.stringify({ ...rec, token: { address: tokenAddr, name, symbol, tx: r.hash } }, null, 2));
}

async function status() {
  if (!fs.existsSync(OUT)) fail(`${OUT} not found`);
  const rec = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const city = new ethers.Contract(rec.proxy, ['function upgradeAdmin() view returns (address)', 'function operator() view returns (address)', 'function treasury() view returns (address)', 'function token() view returns (address)', 'function clock() view returns (uint256,uint256)', 'function reserved() view returns (uint256)', 'function seasonBudget() view returns (uint256)'], main);
  const impl = ethers.getAddress('0x' + (await main.getStorage(rec.proxy, IMPL_SLOT)).slice(26));
  const [admin, operator, treasury, token, clock, reserved, budget, bal] = await Promise.all([city.upgradeAdmin(), city.operator(), city.treasury(), city.token(), city.clock(), city.reserved(), city.seasonBudget(), main.getBalance(rec.proxy)]);
  log(JSON.stringify({ proxy: rec.proxy, implementation: impl, upgradeAdmin: admin, operator, treasury, token, season: Number(clock[0]), day: Number(clock[1]), poolBnb: ethers.formatEther(bal), reservedBnb: ethers.formatEther(reserved), nextSeasonBudgetBnb: ethers.formatEther(budget) }, null, 2));
}

const run = { check, deploy, 'set-token': setToken, status }[cmd];
if (!run) fail('commands: check | deploy --send | set-token <token> [--send] | status');
await run();
