// A browser wallet (EIP-6963 / EIP-1193: the Binance Wallet extension, MetaMask, …) for people's own on-chain
// actions in the city. Nothing is signed here: every transaction opens in the wallet for the user to check and
// confirm. No QR codes, pairing codes, keys or seed phrases, ever.
interface Eip1193 { request(a: { method: string; params?: unknown[] }): Promise<unknown> }
interface Announced { info: { name: string; rdns: string; icon: string }; provider: Eip1193 }

const BSC = { chainId: '0x38', chainName: 'BNB Smart Chain', nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 }, rpcUrls: ['https://bsc-dataseed.bnbchain.org'], blockExplorerUrls: ['https://bscscan.com'] };
const found: Announced[] = [];
addEventListener('eip6963:announceProvider', (e) => {
  const d = (e as CustomEvent<Announced>).detail;
  if (d?.provider && !found.some((f) => f.info.rdns === d.info.rdns)) found.push(d);
});
dispatchEvent(new Event('eip6963:requestProvider'));

let account: string | null = null;
let provider: Eip1193 | null = null;

/** The wallet to use: the Binance Wallet if installed, else the first one announced, else window.ethereum. */
function pick(): { provider: Eip1193; name: string } | null {
  const binance = found.find((f) => /binance/i.test(f.info.rdns + f.info.name));
  const w = binance ?? found[0];
  if (w) return { provider: w.provider, name: w.info.name };
  const injected = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  return injected ? { provider: injected, name: 'Wallet' } : null;
}

export const walletAvailable = () => pick() != null;
export const walletAccount = () => account;
export const walletName = () => pick()?.name ?? null;

/** Asks the wallet for an account and for BNB Chain (adding it if the wallet does not know it). */
export async function connectWallet(): Promise<string> {
  const p = pick();
  if (!p) throw new Error('no-wallet');
  provider = p.provider;
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts?.[0]) throw new Error('no-account');
  account = accounts[0].toLowerCase();
  const chain = (await provider.request({ method: 'eth_chainId' })) as string;
  if (chain?.toLowerCase() !== BSC.chainId) {
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BSC.chainId }] });
    } catch (e) {
      if ((e as { code?: number }).code !== 4902) throw e;
      await provider.request({ method: 'wallet_addEthereumChain', params: [BSC] });
    }
  }
  return account;
}

const need = () => { if (!provider || !account) throw new Error('not-connected'); return { provider, account }; };

/** A read-only contract call; returns the raw hex result. */
export async function ethCall(to: string, data: string): Promise<string> {
  const { provider } = need();
  return (await provider.request({ method: 'eth_call', params: [{ to, data }, 'latest'] })) as string;
}

/** Opens a transaction in the wallet; resolves with its hash once the user confirms, then waits until it is mined. */
export async function sendTx(to: string, data: string): Promise<string> {
  const { provider, account } = need();
  const hash = (await provider.request({ method: 'eth_sendTransaction', params: [{ from: account, to, data }] })) as string;
  for (let i = 0; i < 120; i++) {
    const r = (await provider.request({ method: 'eth_getTransactionReceipt', params: [hash] })) as { status?: string } | null;
    if (r?.status) {
      if (r.status !== '0x1') throw new Error('reverted');
      return hash;
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error('timeout');
}

/** A wallet error as a short message for people: rejected, wrong network, not enough funds, and so on. */
export function walletError(e: unknown, t: (zh: string, en: string) => string): string {
  const err = e as { code?: number; message?: string };
  const m = String(err?.message ?? e);
  if (m === 'no-wallet') return t('没检测到浏览器钱包。请先安装币安钱包插件（或其他钱包插件）。', 'No browser wallet found. Install the Binance Wallet extension (or another wallet) first.');
  if (err?.code === 4001 || /reject|denied|cancel/i.test(m)) return t('你在钱包里取消了。', 'You cancelled in the wallet.');
  if (m === 'reverted') return t('交易被合约拒绝了：可能有人出了更高的价，或者竞拍时间已过。', 'The contract rejected it: someone may have bid higher, or the bidding window has closed.');
  if (m === 'timeout') return t('交易还没上链，稍后在钱包里查看。', 'Not mined yet; check the wallet in a moment.');
  return m.slice(0, 160);
}
