// Deploys Agent City to BNB Chain mainnet as a Flap tax vault, in steps that each check before they act.
//
//   node --env-file=.env.game scripts/deploy.mjs check              read-only: config, Agent ID contract, balance, and
//                                                                    a full rehearsal on a local anvil fork (FORK_NODE):
//                                                                    factory, launch through the real VaultPortal, a buy
//                                                                    whose tax reaches the city
//   node --env-file=.env.game scripts/deploy.mjs factory --send     deploys CityVaultFactory from DEPLOYER_KEY
//   node --env-file=.env.game scripts/deploy.mjs launch --send      launches the city token through Flap's VaultPortal
//                                                                    from DEPLOYER_KEY: one transaction creates the
//                                                                    token and its city (the tax vault)
//   node --env-file=.env.game scripts/deploy.mjs status             the live city's state
//
// The deploying wallet becomes the factory's upgrade admin: the only wallet that can upgrade the city (through the
// factory's beacon), hand that role on in two steps, or lock upgrades for good. Keys are read
// from the environment and never printed. Every --send step shows what it will do and waits for you to type the
// confirmation word (or pass --yes). Results go to deployments/bsc-mainnet-flap.json (git-ignored).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { ethers } from 'ethers';
import { compile, solcVersion, standardInput, SETTINGS } from './compile.mjs';

const AGENT_ID = '0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F'; // SPACE ID Agent ID (symbol AI), checked on chain below
const PORTAL = '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0';    // Flap bonding-curve Portal (deploys the token)
const VAULT_PORTAL = '0x90497450f2a706f1951b5bdda52B4E5d16f34C06';
const TAX_TOKEN_V3_IMPL = '0x024f18294970B5c76c0691b87f138A0317156422';
const GUARDIAN = '0x9e27098dcD8844bcc6287a557E0b4D09C86B8a4b';
const OUT = path.join('deployments', 'bsc-mainnet-flap.json');
const env = process.env;
const [cmd = 'check'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = new Set(process.argv.filter((a) => a.startsWith('--')));
const RPC = env.TYCOON_RPC || 'https://bsc-dataseed.bnbchain.org';
const main = new ethers.JsonRpcProvider(RPC, 56, { staticNetwork: true });
const log = (...a) => console.log(...a);
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
const ok = (msg) => log(`✓ ${msg}`);
const coder = ethers.AbiCoder.defaultAbiCoder();

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
  const name = env.TYCOON_TOKEN_NAME || 'Agent City', symbol = env.TYCOON_TOKEN_SYMBOL || 'ACITY';
  const meta = env.TYCOON_TOKEN_META || '';
  const taxBps = Number(env.TYCOON_TAX_BPS || 200);
  if (!Number.isInteger(taxBps) || taxBps < 100 || taxBps > 1000) fail('TYCOON_TAX_BPS must be 100-1000 (Flap\'s range)');
  const firstBuy = ethers.parseEther(env.TYCOON_FIRST_BUY_BNB || '0');
  return { deployer, operator, treasury, epoch, day, name, symbol, meta, taxBps, firstBuy };
}

function show(c) {
  log(`  deployer (token creator)  ${c.deployer}`);
  log(`  operator                  ${c.operator}${c.operator === c.deployer ? '  (same as deployer)' : ''}`);
  log(`  treasury                  ${c.treasury}`);
  log(`  season 1 starts           ${new Date(c.epoch * 1000).toISOString()}`);
  log(`  game day                  ${c.day} s; season ${((c.day * 8) / 60).toFixed(1)} min with settling`);
  log(`  token                     ${c.name} (${c.symbol}), ${c.taxBps / 100}% buy and sell tax, all of it to the city`);
  log(`  metadata CID              ${c.meta || '(none: the token has no image or links on Flap)'}`);
  log(`  creator's first buy       ${ethers.formatEther(c.firstBuy)} BNB`);
  log(`  Agent ID contract         ${AGENT_ID}`);
  log(`  upgrade admin             ${c.deployer} (the deployer; the Flap Guardian is a backup operator only)`);
}

async function preflight(c) {
  const net = await main.getNetwork();
  if (net.chainId !== 56n) fail(`RPC is chain ${net.chainId}, not BNB Chain (56)`);
  const id = new ethers.Contract(AGENT_ID, ['function name() view returns (string)', 'function symbol() view returns (string)'], main);
  const [name, symbol] = await Promise.all([id.name(), id.symbol()]);
  if (name !== 'SPACE ID Agent ID' || symbol !== 'AI') fail(`unexpected Agent ID contract: ${name} / ${symbol}`);
  ok(`Agent ID contract: ${name} (${symbol})`);
  for (const [k, a] of Object.entries({ Portal: PORTAL, VaultPortal: VAULT_PORTAL, 'tax token V3 implementation': TAX_TOKEN_V3_IMPL })) {
    if ((await main.getCode(a)) === '0x') fail(`no contract at Flap's ${k} ${a}`);
  }
  ok('Flap Portal, VaultPortal and tax token implementation are live');
  if (c.treasury === c.deployer) log('! the treasury is the deployer wallet; a multisig is better for a public treasury');
  const now = Math.floor(Date.now() / 1000);
  if (c.epoch < now + 600) log(`! season 1 starts ${c.epoch < now ? 'in the past' : 'within 10 minutes'}: day 1 plans are only taken before it starts`);
  if (!c.meta) log('! TYCOON_TOKEN_META is empty: upload the image and links to Flap first (docs: Launch Tokens, step 1)');
  for (const [k, a] of Object.entries({ treasury: c.treasury, operator: c.operator })) if ((await main.getCode(a)) !== '0x') ok(`${k} is a contract (e.g. a multisig)`);
}

/** A salt whose token address (CREATE2 from the Portal) ends in 7777, as Flap requires for tax tokens. */
function vanitySalt() {
  const hash = ethers.keccak256('0x3d602d80600a3d3981f3363d3d373d3d3d363d73' + TAX_TOKEN_V3_IMPL.slice(2).toLowerCase() + '5af43d82803e903d91602b57fd5bf3');
  let salt = ethers.keccak256(ethers.randomBytes(32));
  for (;;) {
    const token = ethers.getCreate2Address(PORTAL, salt, hash);
    if (token.toLowerCase().endsWith('7777')) return { salt, token };
    salt = ethers.keccak256(salt);
  }
}

const vaultData = (c) => coder.encode(['address', 'address', 'uint256', 'uint256'], [c.operator, c.treasury, c.epoch, c.day]);

function launchParams(c, factory, salt) {
  return {
    name: c.name, symbol: c.symbol, meta: c.meta, dexThresh: 1, salt, migratorType: 1, quoteToken: ethers.ZeroAddress,
    quoteAmt: c.firstBuy, permitData: '0x', extensionID: ethers.ZeroHash, extensionData: '0x', dexId: 0, lpFeeProfile: 0,
    buyTaxRate: c.taxBps, sellTaxRate: c.taxBps, taxDuration: 100n * 365n * 86400n, antiFarmerDuration: 3600n,
    mktBps: 10000, deflationBps: 0, dividendBps: 0, lpBps: 0, minimumShareBalance: 0n, dividendToken: ethers.ZeroAddress,
    commissionReceiver: ethers.ZeroAddress, tokenVersion: 6, vaultFactory: factory, vaultData: vaultData(c),
  };
}

async function deployFactory(signer, build) {
  const F = build['src/CityVaultFactory.sol'].CityVaultFactory;
  const factory = await (await new ethers.ContractFactory(F.abi, F.evm.bytecode.object, signer).deploy(AGENT_ID)).waitForDeployment();
  const tx = await factory.deploymentTransaction().wait();
  const [beacon, implementation] = await Promise.all([factory.beacon(), factory.beaconImplementation()]);
  return { factory, address: await factory.getAddress(), beacon, implementation, tx };
}

async function launchWith(signer, c, build, factoryAddr) {
  const vp = new ethers.Contract(VAULT_PORTAL, build['src/flap/IVaultPortal.sol'].IVaultPortal.abi, signer);
  const { salt, token: predicted } = vanitySalt();
  const params = launchParams(c, factoryAddr, salt);
  await vp.newTokenV6WithVault.staticCall(params, { value: c.firstBuy }); // VaultPortal runs the factory's launch rules too
  const tx = await (await vp.newTokenV6WithVault(params, { value: c.firstBuy })).wait();
  const ev = tx.logs.map((l) => { try { return vp.interface.parseLog(l); } catch { return null; } }).find((x) => x?.name === 'FlapTaxVaultTokenCreated');
  if (!ev) fail('VaultPortal did not report FlapTaxVaultTokenCreated');
  if (ev.args.token !== predicted) fail(`token at ${ev.args.token}, predicted ${predicted}`);
  return { token: ev.args.token, city: ev.args.vault, tx, salt };
}

/** Reads back the city and checks it is exactly the configuration. */
async function checkCity(provider, build, cityAddr, tokenAddr, c, factoryAddr) {
  const City = build['src/TimesSquareCity.sol'].TimesSquareCity;
  const city = new ethers.Contract(cityAddr, City.abi, provider);
  const factory = new ethers.Contract(factoryAddr, build['src/CityVaultFactory.sol'].CityVaultFactory.abi, provider);
  const want = { token: tokenAddr, operator: c.operator, treasury: c.treasury, agentId: AGENT_ID, creator: c.deployer, guardian: GUARDIAN };
  const got = { token: await city.token(), operator: await city.operator(), treasury: await city.treasury(), agentId: await city.agentId(), creator: await city.creator(), guardian: await city.guardian() };
  for (const k of Object.keys(want)) if (got[k].toLowerCase() !== want[k].toLowerCase()) fail(`${k} is ${got[k]}, expected ${want[k]}`);
  if (Number(await city.epoch()) !== c.epoch || Number(await city.dayLength()) !== c.day) fail('clock does not match the configuration');
  const tok = new ethers.Contract(tokenAddr, ['function taxProcessor() view returns (address)', 'function taxRate() view returns (uint256)'], provider);
  const proc = new ethers.Contract(await tok.taxProcessor(), ['function marketAddress() view returns (address)'], provider);
  if ((await proc.marketAddress()).toLowerCase() !== cityAddr.toLowerCase()) fail('the token\'s tax does not go to the city');
  if ((await factory.guardian()) !== GUARDIAN || (await factory.vaultPortal()) !== VAULT_PORTAL) fail('the factory names other Flap addresses');
  if ((await factory.upgradeAdmin()) !== c.deployer) fail(`the upgrade admin is ${await factory.upgradeAdmin()}, not the deployer`);
  ok(`city state matches the configuration; the token's tax (${Number(await tok.taxRate()) / 100}%) goes to the city; the deployer is the upgrade admin`);
  return city;
}

/** The whole deployment from the deployer's address on a local fork. Flap's Portal and VaultPortal use Cancun opcodes
 * (MCOPY), which Ganache 7 cannot run, so the fork is an anvil node: FORK_NODE=http://127.0.0.1:8545 after
 * `anvil --fork-url <archive BNB Chain RPC> --chain-id 56`. Restart anvil before each check for a fresh fork. */
async function rehearse(c, build) {
  if (!env.FORK_NODE) fail('set FORK_NODE to a local anvil fork of BNB Chain (anvil --fork-url <archive RPC> --chain-id 56); the rehearsal needs Cancun');
  const fork = new ethers.JsonRpcProvider(env.FORK_NODE, 56, { staticNetwork: true, cacheTimeout: -1 });
  fork.pollingInterval = 50;
  try {
    const head = await fork.getBlockNumber();
    await fork.send('anvil_impersonateAccount', [c.deployer]);
    const real = await fork.getBalance(c.deployer);
    await fork.send('anvil_setBalance', [c.deployer, ethers.toQuantity(real + 10n ** 19n)]);
    const s = await fork.getSigner(c.deployer);
    const f = await deployFactory(s, build);
    const l = await launchWith(s, c, build, f.address);
    const city = await checkCity(fork, build, l.city, l.token, c, f.address);
    // A buy on the curve pays tax; the processor's dispatch brings it to the city as BNB.
    const portal = new ethers.Contract(PORTAL, build['src/flap/IPortal.sol'].IPortal.abi, s);
    await (await portal.swapExactInput({ inputToken: ethers.ZeroAddress, outputToken: l.token, inputAmount: 10n ** 18n, minOutputAmount: 0n, permitData: '0x' }, { value: 10n ** 18n })).wait();
    const tok = new ethers.Contract(l.token, ['function taxProcessor() view returns (address)'], fork);
    await (await new ethers.Contract(await tok.taxProcessor(), ['function dispatch()'], s).dispatch({ gasLimit: 1_000_000 })).wait();
    const pool = await city.accountedQuote();
    if (pool === 0n) fail('a 1 BNB buy sent no tax to the city');
    ok(`rehearsal on a fork at block ${head}: factory ${f.tx.gasUsed} gas, launch ${l.tx.gasUsed} gas; a 1 BNB buy brought ${ethers.formatEther(pool)} BNB of tax to the city`);
    return { factoryGas: f.tx.gasUsed, launchGas: l.tx.gasUsed };
  } finally { fork.destroy(); }
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

const record = () => (fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null);
const save = (rec) => { fs.mkdirSync('deployments', { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(rec, null, 2)); };

async function check() {
  const c = config();
  log('Agent City on Flap — deployment check (read-only)');
  show(c);
  await preflight(c);
  const build = compile({ 'FlapAbis.sol': { content: 'pragma solidity ^0.8.24; import "src/flap/IVaultPortal.sol"; import "src/flap/IPortal.sol";' } });
  const gas = await rehearse(c, build);
  const { gasPrice } = await main.getFeeData();
  const cost = (gas.factoryGas + gas.launchGas) * (gasPrice ?? 1_000_000_000n);
  const bal = await main.getBalance(c.deployer);
  log(`  estimated cost ${ethers.formatEther(cost)} BNB + ${ethers.formatEther(c.firstBuy)} BNB first buy at ${ethers.formatUnits(gasPrice ?? 0n, 'gwei')} gwei; deployer holds ${ethers.formatEther(bal)} BNB`);
  if (bal < (cost * 3n) / 2n + c.firstBuy) fail('the deployer needs at least 1.5× the estimated cost plus the first buy');
  ok('ready: run `factory --send`, then `launch --send`');
  return { c, build };
}

async function factory() {
  if (!flags.has('--send')) fail('add --send to deploy (run `check` first; it changes nothing)');
  const rec = record();
  if (rec?.factory && !flags.has('--again')) fail(`${OUT} already names factory ${rec.factory.address} (use --again for another)`);
  const { c, build } = await check();
  const signer = signerFrom('DEPLOYER_KEY', c.deployer);
  await confirm('FACTORY', `This deploys CityVaultFactory to BNB Chain mainnet from ${c.deployer}. The deployer becomes the upgrade admin of every city it creates.`);
  const f = await deployFactory(signer, build);
  ok(`factory        ${f.address} (tx ${f.tx.hash}, block ${f.tx.blockNumber})`);
  ok(`beacon         ${f.beacon}`);
  ok(`implementation ${f.implementation}`);
  save({
    network: 'bsc-mainnet', chainId: 56,
    factory: { address: f.address, beacon: f.beacon, implementation: f.implementation, tx: f.tx.hash, block: f.tx.blockNumber, deployedAt: new Date().toISOString() },
    config: { ...c, firstBuy: c.firstBuy.toString(), agentId: AGENT_ID },
    verify: {
      compiler: `v${solcVersion().replace('.Emscripten.clang', '')}`, settings: SETTINGS, input: 'deployments/verify-input.json',
      contracts: { factory: 'src/CityVaultFactory.sol:CityVaultFactory', implementation: 'src/TimesSquareCity.sol:TimesSquareCity', beacon: '@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol:UpgradeableBeacon', city: '@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol:BeaconProxy' },
      args: { factory: coder.encode(['address'], [AGENT_ID]).slice(2), beacon: coder.encode(['address', 'address'], [f.implementation, f.address]).slice(2) },
    },
  });
  fs.writeFileSync(path.join('deployments', 'verify-input.json'), JSON.stringify(standardInput()));
  log(`\nSaved ${OUT}. Next: node --env-file=.env.game scripts/deploy.mjs launch --send`);
}

async function launch() {
  if (!flags.has('--send')) fail('add --send to launch (run `check` first; it changes nothing)');
  const rec = record();
  if (!rec?.factory) fail(`${OUT} has no factory: run \`factory --send\` first`);
  if (rec.city && !flags.has('--again')) fail(`${OUT} already names city ${rec.city.address}`);
  const { c, build } = await check();
  const signer = signerFrom('DEPLOYER_KEY', c.deployer);
  await confirm('LAUNCH', `This launches ${c.name} (${c.symbol}) on Flap through VaultPortal from ${c.deployer}, with a city created by factory ${rec.factory.address} as its tax vault${c.firstBuy ? `, and a first buy of ${ethers.formatEther(c.firstBuy)} BNB` : ''}. The token is public the moment it lands.`);
  const l = await launchWith(signer, c, build, rec.factory.address);
  ok(`token ${l.token}`);
  ok(`city  ${l.city} (tx ${l.tx.hash}, block ${l.tx.blockNumber})`);
  await checkCity(main, build, l.city, l.token, c, rec.factory.address);
  const City = build['src/TimesSquareCity.sol'].TimesSquareCity;
  const init = new ethers.Interface(City.abi).encodeFunctionData('initialize', [l.token, AGENT_ID, c.deployer, c.operator, c.treasury, c.epoch, c.day]);
  rec.city = { address: l.city, token: l.token, name: c.name, symbol: c.symbol, tx: l.tx.hash, block: l.tx.blockNumber, salt: l.salt, launchedAt: new Date().toISOString() };
  rec.verify.args.city = coder.encode(['address', 'bytes'], [rec.factory.beacon, init]).slice(2);
  save(rec);
  log(`
Saved ${OUT}. Next:
 1. node --env-file=.env.game scripts/verify.mjs   (factory, implementation, beacon and the city on BscScan)
 2. In .env.game for the API: TYCOON_CONTRACT=${l.city}  TYCOON_FROM_BLOCK=${l.tx.blockNumber}
 3. The token page: https://flap.sh/bnb/${l.token} (tax info: /taxinfo). Submit the factory to Flap for audit to drop
    the risk warning (600 USDT, paid through VaultPortal.payAudit).`);
}

async function status() {
  const rec = record();
  if (!rec?.city) fail(`${OUT} has no city yet`);
  const city = new ethers.Contract(rec.city.address, [
    'function operator() view returns (address)', 'function treasury() view returns (address)', 'function token() view returns (address)',
    'function clock() view returns (uint256,uint256)', 'function reserved() view returns (uint256)', 'function seasonBudget() view returns (uint256)',
    'function accountedQuote() view returns (uint256)', 'function totalFunded() view returns (uint256)', 'function description() view returns (string)',
  ], main);
  const factory = new ethers.Contract(rec.factory.address, ['function beaconImplementation() view returns (address)', 'function isVaultUpgradesLocked() view returns (bool)'], main);
  const [operator, treasury, token, clock, reserved, budget, pool, funded, bal, impl, locked, description] = await Promise.all([
    city.operator(), city.treasury(), city.token(), city.clock(), city.reserved(), city.seasonBudget(), city.accountedQuote(), city.totalFunded(),
    main.getBalance(rec.city.address), factory.beaconImplementation(), factory.isVaultUpgradesLocked(), city.description(),
  ]);
  log(JSON.stringify({
    city: rec.city.address, token, factory: rec.factory.address, implementation: impl, upgradesLocked: locked, operator, treasury,
    season: Number(clock[0]), day: Number(clock[1]), poolBnb: ethers.formatEther(pool), balanceBnb: ethers.formatEther(bal),
    totalTaxBnb: ethers.formatEther(funded), reservedBnb: ethers.formatEther(reserved), nextSeasonBudgetBnb: ethers.formatEther(budget), description,
  }, null, 2));
}

const run = { check, factory, launch, status }[cmd];
if (!run) fail('commands: check | factory --send | launch --send | status');
await run();
