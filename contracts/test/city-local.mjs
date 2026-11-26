// Creates a city on a local Ganache chain the way Flap does on BNB Chain: CityVaultFactory.newVault, called by
// VaultPortal. On a chain that is not BNB Chain or its testnet, Flap's base contracts name fixed VaultPortal and
// Guardian addresses; the tests unlock those two (pass FLAP_UNLOCKED to ganache) and act as them.
import { ethers } from 'ethers';

export const VAULT_PORTAL = '0x00003877386745d059d92fa39159595BdaBF0000';
export const GUARDIAN = '0x00004d58290854c5E9880F4b5B1993c6Ad8b0000';
export const FLAP_UNLOCKED = [VAULT_PORTAL, GUARDIAN];

/**
 * Deploys CityVaultFactory and creates one city through it, as VaultPortal. Returns { factory, city, portal,
 * guardian } with `city` connected to `operator` (a signer).
 */
export async function createCity({ provider, builds, deployer, registry, token, operator, treasury, epoch, day, creator }) {
  for (const a of FLAP_UNLOCKED) await provider.send('evm_setAccountBalance', [a, ethers.toQuantity(10n ** 20n)]);
  const F = builds['src/CityVaultFactory.sol'].CityVaultFactory;
  const City = builds['src/TimesSquareCity.sol'].TimesSquareCity;
  const factory = await (await new ethers.ContractFactory(F.abi, F.evm.bytecode.object, deployer).deploy(registry)).waitForDeployment();
  const portal = await provider.getSigner(VAULT_PORTAL);
  const guardian = await provider.getSigner(GUARDIAN);
  const data = ethers.AbiCoder.defaultAbiCoder().encode(['address', 'address', 'uint256', 'uint256'], [operator.address, treasury, epoch, day]);
  const r = await (await factory.connect(portal).newVault(token, ethers.ZeroAddress, creator ?? deployer.address, data)).wait();
  const created = r.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((x) => x?.name === 'CityCreated');
  const city = new ethers.Contract(created.args.city, City.abi, operator);
  return { factory, city, portal, guardian, vaultData: data };
}
