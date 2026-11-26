// The city launched through Flap on a local fork of BNB Chain mainnet: the real VaultPortal calls our
// CityVaultFactory while it creates a real V3 tax token, the token's tax reaches the city on the bonding curve and
// again after the token migrates to PancakeSwap, a real Agent ID holder enters with tokens bought on the curve, and
// the real Flap Guardian (impersonated) acts as operator while only the deploying wallet can upgrade and lock the
// city. Nothing is sent to mainnet: the fork is a local anvil node.
//
//   anvil --fork-url <archive BNB Chain RPC> --chain-id 56 --port 8545      (Foundry; Flap's contracts need Cancun)
//   FORK_NODE=http://127.0.0.1:8545 node scripts/flap-fork-test.mjs
// LOG_RPC is only used to find an Agent ID holder on mainnet.
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { compile } from './compile.mjs';

const LOG_RPC = process.env.LOG_RPC || 'https://bsc-rpc.publicnode.com';
const AGENT_ID = '0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F';
const PORTAL = '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0';
const VAULT_PORTAL = '0x90497450f2a706f1951b5bdda52B4E5d16f34C06';
const TAX_TOKEN_V3_IMPL = '0x024f18294970B5c76c0691b87f138A0317156422';
const GUARDIAN = '0x9e27098dcD8844bcc6287a557E0b4D09C86B8a4b';
const PANCAKE_V2_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const T = 10n ** 18n;
const DAY = 75;
const log = (...a) => console.log(...a);

/** A salt whose CREATE2 address (Portal, minimal proxy of the V3 tax token) ends in 7777, as Flap requires. */
function vanitySalt() {
  const code = '0x3d602d80600a3d3981f3363d3d373d3d3d363d73' + TAX_TOKEN_V3_IMPL.slice(2).toLowerCase() + '5af43d82803e903d91602b57fd5bf3';
  const hash = ethers.keccak256(code);
  let salt = ethers.keccak256(ethers.randomBytes(32));
  for (;;) {
    const token = ethers.getCreate2Address(PORTAL, salt, hash);
    if (token.toLowerCase().endsWith('7777')) return { salt, token };
    salt = ethers.keccak256(salt);
  }
}

// ---- an Agent ID holder from mainnet ----
const main = new ethers.JsonRpcProvider(LOG_RPC, 56, { staticNetwork: true });
const head = await main.getBlockNumber();
const id = new ethers.Contract(AGENT_ID, ['function balanceOf(address) view returns (uint256)'], main);
const topic = ethers.id('Transfer(address,address,uint256)');
let holder;
for (let to = head; !holder && to > head - 200_000; to -= 1000) {
  for (const l of (await main.getLogs({ address: AGENT_ID, topics: [topic], fromBlock: to - 999, toBlock: to })).reverse()) {
    const who = ethers.getAddress('0x' + l.topics[2].slice(26));
    if ((await main.getCode(who)) === '0x' && (await id.balanceOf(who)) > 0n) { holder = who; break; }
  }
}
assert.ok(holder, 'found an Agent ID holder');
log(`mainnet block ${head}; Agent ID holder ${holder}`);

// Flap's Portal and VaultPortal use Cancun opcodes (MCOPY), which Ganache 7 cannot run: point FORK_NODE at a
// Cancun-capable fork of BNB Chain, e.g. `anvil --fork-url <archive RPC> --chain-id 56 --port 8545`.
const NODE = process.env.FORK_NODE;
if (!NODE) { console.error('Set FORK_NODE to a local BNB Chain fork that supports Cancun (anvil), e.g. FORK_NODE=http://127.0.0.1:8545'); process.exit(1); }
const provider = new ethers.JsonRpcProvider(NODE, 56, { staticNetwork: true, cacheTimeout: -1 });
provider.pollingInterval = 50;
const chain = { disconnect: async () => provider.destroy() };
for (const a of [holder, GUARDIAN]) await provider.send('anvil_impersonateAccount', [a]);
const send = async (p) => (await p).wait();
const now = async () => (await provider.getBlock('latest')).timestamp;
const reverts = async (fn, reason) => {
  try { await fn(); } catch (e) { const t = JSON.stringify(e, (_, v) => (typeof v === 'bigint' ? String(v) : v)) + String(e?.message); assert.ok(t.includes(reason), `expected "${reason}", got ${String(e?.shortMessage ?? e?.message).slice(0, 200)}`); return; }
  assert.fail(`expected revert "${reason}"`);
};

try {
  const [creator, trader, operatorAcc] = await Promise.all([0, 1, 2].map((i) => provider.getSigner(i))); // anvil's funded dev accounts
  for (const a of [holder, GUARDIAN]) await provider.send('anvil_setBalance', [a, ethers.toQuantity(100n * T)]);
  const agent = await provider.getSigner(holder);
  const guardian = await provider.getSigner(GUARDIAN);

  const build = compile({
    'FlapAbis.sol': { content: 'pragma solidity ^0.8.24; import "src/flap/IVaultPortal.sol"; import "src/flap/IPortal.sol";' },
    'TestCityV2.sol': { content: 'pragma solidity ^0.8.24; import "src/TimesSquareCity.sol"; contract TestCityV2 is TimesSquareCity { function version() external pure returns (string memory) { return "v2"; } }' },
  });
  const F = build['src/CityVaultFactory.sol'].CityVaultFactory, City = build['src/TimesSquareCity.sol'].TimesSquareCity;
  const vaultPortal = new ethers.Contract(VAULT_PORTAL, build['src/flap/IVaultPortal.sol'].IVaultPortal.abi, creator);
  const portal = new ethers.Contract(PORTAL, build['src/flap/IPortal.sol'].IPortal.abi, trader);

  const factory = await (await new ethers.ContractFactory(F.abi, F.evm.bytecode.object, creator).deploy(AGENT_ID)).waitForDeployment();
  const factoryAddr = await factory.getAddress();
  assert.equal(await factory.vaultPortal(), VAULT_PORTAL, 'the factory names the real VaultPortal on chain 56');
  assert.equal(await factory.guardian(), GUARDIAN);
  log(`factory ${factoryAddr}`);

  // ---- launch: one transaction creates the token and the city ----
  const epoch = (await now()) + 600;
  const vaultData = ethers.AbiCoder.defaultAbiCoder().encode(['address', 'address', 'uint256', 'uint256'], [operatorAcc.address, creator.address, epoch, DAY]);
  const { salt, token: predicted } = vanitySalt();
  const params = {
    name: 'Agent City Test', symbol: 'ACTEST', meta: '', dexThresh: 1, salt, migratorType: 1, quoteToken: ethers.ZeroAddress,
    quoteAmt: 0n, permitData: '0x', extensionID: ethers.ZeroHash, extensionData: '0x', dexId: 0, lpFeeProfile: 0,
    buyTaxRate: 200, sellTaxRate: 200, taxDuration: 100n * 365n * 86400n, antiFarmerDuration: 3600n,
    mktBps: 10000, deflationBps: 0, dividendBps: 0, lpBps: 0, minimumShareBalance: 0n, dividendToken: ethers.ZeroAddress,
    commissionReceiver: ethers.ZeroAddress, tokenVersion: 6, vaultFactory: factoryAddr, vaultData,
  };
  // The factory's own launch rules are enforced by the real VaultPortal before anything is created.
  const validation = (vaultBps, other) => ethers.AbiCoder.defaultAbiCoder().encode(['tuple(uint8,address,uint16,uint16,uint16,uint16,uint16,uint16,address,uint256)'], [[6, ethers.ZeroAddress, 200, 200, vaultBps, other, 0, 0, ethers.ZeroAddress, 0n]]);
  assert.deepEqual([...await factory.onBeforeLaunch(validation(5000, 5000))], [false, 'All of the tax must go to the city (vaultBps 10000)']);
  assert.deepEqual([...await factory.onBeforeLaunch(validation(10000, 0))], [true, '']);
  await reverts(() => vaultPortal.newTokenV6WithVault.staticCall({ ...params, mktBps: 5000, deflationBps: 5000 }), 'revert');
  const launch = await send(vaultPortal.newTokenV6WithVault(params, { gasLimit: 15_000_000 }));
  const ev = launch.logs.map((l) => { try { return vaultPortal.interface.parseLog(l); } catch { return null; } }).find((x) => x?.name === 'FlapTaxVaultTokenCreated');
  assert.ok(ev, 'VaultPortal emitted FlapTaxVaultTokenCreated');
  const tokenAddr = ev.args.token, cityAddr = ev.args.vault;
  assert.equal(tokenAddr, predicted, 'the token is at the predicted vanity address');
  assert.equal(ev.args.vaultFactory, factoryAddr);
  const city = new ethers.Contract(cityAddr, City.abi, operatorAcc);
  assert.equal(await city.token(), tokenAddr);
  assert.equal(await city.creator(), creator.address, 'the launching wallet is the creator');
  assert.equal(await city.operator(), operatorAcc.address);
  assert.equal(Number(await city.dayLength()), DAY);
  log(`launched ${tokenAddr} with city ${cityAddr} (${launch.gasUsed} gas)`);

  const token = new ethers.Contract(tokenAddr, [
    'function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)',
    'function taxProcessor() view returns (address)', 'function taxRate() view returns (uint256)',
  ], trader);
  const processor = new ethers.Contract(await token.taxProcessor(), ['function dispatch()', 'function marketAddress() view returns (address)', 'function marketQuoteBalance() view returns (uint256)'], trader);
  assert.equal(await processor.marketAddress(), cityAddr, 'the tax processor pays the city');

  // ---- on the bonding curve: buys pay tax, dispatch sends it to the city as BNB ----
  const buy = async (who, bnb) => send(portal.connect(who).swapExactInput({ inputToken: ethers.ZeroAddress, outputToken: tokenAddr, inputAmount: bnb, minOutputAmount: 0n, permitData: '0x' }, { value: bnb, gasLimit: 10_000_000 }));
  await buy(trader, 2n * T);
  await buy(agent, 1n * T);
  const pending = await processor.marketQuoteBalance();
  const before = await city.accountedQuote();
  const d1 = await send(processor.dispatch({ gasLimit: 1_000_000 }));
  const got1 = (await city.accountedQuote()) - before;
  assert.ok(got1 > 0n, 'the curve tax reached the city');
  assert.equal(await city.accountedQuote(), await provider.getBalance(cityAddr), 'books match the balance');
  assert.ok(d1.logs.some((l) => l.address === cityAddr), 'the city logged Funded');
  log(`curve: ${ethers.formatEther(pending)} BNB pending at the processor, ${ethers.formatEther(got1)} BNB reached the city (dispatch ${d1.gasUsed} gas)`);

  // ---- the Agent ID holder enters season 1 with tokens bought on the curve ----
  const dep = (await token.balanceOf(holder)) / 2n;
  await send(token.connect(agent).approve(cityAddr, dep));
  await send(city.connect(agent).enter(1, dep));
  assert.equal(await city.depositOf(1, holder), dep, 'a plain transfer into the city is not taxed: the deposit is whole');
  await reverts(() => city.connect(trader).enter(1, 0), 'agent ID');

  // ---- migration to PancakeSwap: buy until the curve completes, then sell on the DEX ----
  const state = async () => (await portal.getTokenV8Safe(tokenAddr)).status;
  for (let i = 0; i < 40 && Number(await state()) !== 4; i++) await buy(trader, 5n * T);
  assert.equal(Number(await state()), 4, 'the token migrated to the DEX');
  const router = new ethers.Contract(PANCAKE_V2_ROUTER, ['function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)'], trader);
  const sellAmt = (await token.balanceOf(trader.address)) / 10n;
  await send(token.approve(PANCAKE_V2_ROUTER, sellAmt));
  await send(router.swapExactTokensForETHSupportingFeeOnTransferTokens(sellAmt, 0n, [tokenAddr, WBNB], trader.address, (await now()) + 600, { gasLimit: 3_000_000 }));
  const mid = await city.accountedQuote();
  await send(processor.dispatch({ gasLimit: 1_000_000 }));
  const got2 = (await city.accountedQuote()) - mid;
  assert.ok(got2 > 0n, 'the DEX tax reached the city');
  log(`DEX: ${ethers.formatEther(got2)} BNB of tax reached the city after migration; pool ${ethers.formatEther(await city.accountedQuote())} BNB`);

  // ---- the real Flap Guardian: operator powers; upgrades and the lock are the deploying wallet's ----
  await send(city.connect(guardian).setOperator(creator.address));
  assert.equal(await city.operator(), creator.address, 'the Guardian can act as operator');
  const V2 = build['TestCityV2.sol'].TestCityV2;
  const v2 = await (await new ethers.ContractFactory(V2.abi, V2.evm.bytecode.object, creator).deploy()).waitForDeployment();
  assert.equal(await factory.upgradeAdmin(), creator.address, 'the deploying wallet is the upgrade admin');
  await reverts(() => factory.connect(guardian).upgradeVaultImplementation(v2.getAddress()), 'upgrade admin');
  const pool = await provider.getBalance(cityAddr);
  await send(factory.connect(creator).upgradeVaultImplementation(v2.getAddress()));
  const upgraded = new ethers.Contract(cityAddr, V2.abi, creator);
  assert.equal(await upgraded.version(), 'v2');
  assert.equal(await provider.getBalance(cityAddr), pool, 'the pool is where it was');
  assert.equal(await upgraded.depositOf(1, holder), dep, 'deposits intact');
  await send(factory.connect(creator).lockVaultUpgrades());
  assert.equal(await factory.isVaultUpgradesLocked(), true);

  log(`PASS: Flap launch on a BNB Chain fork — the real VaultPortal creates the token and the city through CityVaultFactory (and enforces its launch rules), curve and DEX tax both reach the city as BNB, an Agent ID holder enters with curve-bought tokens, the real Guardian acts as operator, the deploying wallet (not the Guardian) upgrades and locks`);
} catch (e) {
  console.error('FAIL:', String(e?.shortMessage ?? e?.message ?? e).slice(0, 1200));
  process.exitCode = 1;
} finally {
  await chain.disconnect();
}
