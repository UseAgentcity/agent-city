// Verifies the deployed city on BscScan (Etherscan API v2, chain 56) from deployments/bsc-mainnet.json:
// the implementation, then the proxy with its constructor arguments, then marks the proxy as a proxy.
//   node --env-file=.env.game scripts/verify.mjs      (needs ETHERSCAN_API_KEY)
import fs from 'node:fs';

const API = 'https://api.etherscan.io/v2/api?chainid=56';
const key = process.env.ETHERSCAN_API_KEY;
if (!key) { console.error('Set ETHERSCAN_API_KEY in .env.game'); process.exit(1); }
const rec = JSON.parse(fs.readFileSync('deployments/bsc-mainnet.json', 'utf8'));
const input = fs.readFileSync(rec.verify.input, 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(params, post = true) {
  const body = new URLSearchParams({ apikey: key, ...params });
  const res = post ? await fetch(API, { method: 'POST', body }) : await fetch(`${API}&${body}`);
  return res.json();
}

/** Submits one contract and waits for BscScan's verdict. */
async function verify(label, address, contractname, args = '') {
  for (let attempt = 0; attempt < 6; attempt++) {
    const sub = await call({
      module: 'contract', action: 'verifysourcecode', contractaddress: address, sourceCode: input,
      codeformat: 'solidity-standard-json-input', contractname, compilerversion: rec.verify.compiler, constructorArguements: args,
    });
    if (/already verified/i.test(sub.result)) return console.log(`✓ ${label} ${address}: already verified`);
    if (sub.status !== '1') {
      // A fresh contract may not be indexed yet.
      if (/unable to locate|not found/i.test(sub.result)) { await sleep(10_000); continue; }
      throw new Error(`${label}: ${sub.result}`);
    }
    for (;;) {
      await sleep(5_000);
      const st = await call({ module: 'contract', action: 'checkverifystatus', guid: sub.result }, false);
      if (/pending/i.test(st.result)) continue;
      if (st.status === '1' || /already verified/i.test(st.result)) return console.log(`✓ ${label} ${address}: ${st.result}`);
      throw new Error(`${label}: ${st.result}`);
    }
  }
  throw new Error(`${label}: BscScan has not indexed ${address} yet; try again in a minute`);
}

await verify('implementation', rec.implementation, rec.verify.contracts.implementation);
await verify('proxy', rec.proxy, rec.verify.contracts.proxy, rec.verify.proxyConstructorArgs);

// Link the proxy to its implementation, so BscScan shows "Read/Write as Proxy".
const px = await call({ module: 'contract', action: 'verifyproxycontract', address: rec.proxy, expectedimplementation: rec.implementation });
if (px.status === '1') {
  for (;;) {
    await sleep(5_000);
    const st = await call({ module: 'contract', action: 'checkproxyverification', guid: px.result }, false);
    if (/pending|in progress/i.test(st.result)) continue;
    console.log(`${st.status === '1' ? '✓' : '!'} proxy link: ${st.result}`);
    break;
  }
} else console.log(`! proxy link: ${px.result}`);
console.log(`https://bscscan.com/address/${rec.proxy}#code`);
