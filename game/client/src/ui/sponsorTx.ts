// Sponsoring a city event from a person's own wallet: read the city's token, check the balance, approve the bid if
// the allowance is short, then bid. Every step is a transaction the person confirms in the wallet. Kept free of the
// page so it runs the same against a local chain in tests.
export interface TxWallet {
  account: string;
  call(to: string, data: string): Promise<string>;
  send(to: string, data: string): Promise<string>;
}

export const SEL = { sponsor: '0x9091ae84', approve: '0x095ea7b3', allowance: '0xdd62ed3e', balanceOf: '0x70a08231', token: '0xfc0c546a', topBid: '0xfe0c354e' };
const word = (n: bigint | number) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a: string) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const asBig = (hex: string) => (hex && hex !== '0x' ? BigInt(hex.slice(0, 66)) : 0n);
export const UNIT = 10n ** 18n;

export type SponsorStep = 'check' | 'approve' | 'bid' | 'done';
export class SponsorError extends Error {}

/** The leading bid on chain for a day: who, how much (whole tokens) and which event index. */
export async function topBid(w: Pick<TxWallet, 'call'>, city: string, season: number, day: number) {
  const hex = (await w.call(city, SEL.topBid + word(season) + word(day))).replace(/^0x/, '');
  return { who: '0x' + hex.slice(24, 64), amount: BigInt('0x' + (hex.slice(64, 128) || '0')), eventId: Number(BigInt('0x' + (hex.slice(128, 192) || '0'))) };
}

/**
 * Bids `tokens` (whole tokens) for `eventId` on `day` of `season`. Throws SponsorError('no-token' | 'balance' |
 * 'too-low') before asking the wallet for anything that would fail.
 */
export async function sponsorEvent(w: TxWallet, o: { city: string; season: number; day: number; eventId: number; tokens: number }, step: (s: SponsorStep) => void = () => {}) {
  step('check');
  const token = '0x' + (await w.call(o.city, SEL.token)).replace(/^0x/, '').slice(24, 64);
  if (/^0x0+$/.test(token)) throw new SponsorError('no-token');
  const amount = BigInt(Math.floor(o.tokens)) * UNIT;
  const lead = await topBid(w, o.city, o.season, o.day);
  if (amount <= lead.amount) throw new SponsorError('too-low');
  const balance = asBig(await w.call(token, SEL.balanceOf + addrWord(w.account)));
  if (balance < amount) throw new SponsorError('balance');
  const allowance = asBig(await w.call(token, SEL.allowance + addrWord(w.account) + addrWord(o.city)));
  if (allowance < amount) {
    step('approve');
    await w.send(token, SEL.approve + addrWord(o.city) + word(amount));
  }
  step('bid');
  const hash = await w.send(o.city, SEL.sponsor + word(o.season) + word(o.day) + word(o.eventId) + word(amount));
  step('done');
  return hash;
}
