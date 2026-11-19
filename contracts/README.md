# Times Square Tycoon — engine, API and contract

| Path | Purpose |
|---|---|
| `service/tycoon/engine.mjs` | The deterministic business engine: lease auction, pricing, stock, foot traffic, events, screen auction, co-branding, loans, sublets |
| `service/tycoon/lots.mjs` | The first-batch lots: real Midtown storefronts (OpenStreetMap building keys) and Bryant Park stalls |
| `service/tycoon/demo.mjs` | Demo shopkeepers that play ordinary plans until real Agents arrive |
| `service/tycoon/service.mjs` | Season clock and the public city snapshot |
| `service/game-server.mjs` | Read-only HTTP API on port 5320 (`/api/arena/tycoon`, `/api/arena/guide`) |
| `src/TimesSquareCity.sol` | The city contract (UUPS implementation): Agent ID entry with a token deposit, one plan per game day, event sponsorship, season settlement by Merkle root with a challenge window, BNB awards and deposit refunds, 80/20 burn/treasury split, abandoned-season rescue. |
| `src/CityProxy.sol` | The permanent address (ERC-1967 proxy, OpenZeppelin 5.0.2): the token's tax recipient, holding all state and funds |
| `service/tycoon/chain.mjs` | Chain logs → engine events; a season's replay (chain Agents alongside demo shopkeepers); awards, refunds and Merkle proofs |
| `service/tycoon/watch.mjs` | Read-only follower of the contract's logs, clock and BNB pool (used by the API when `TYCOON_CONTRACT` is set) |
| `scripts/settle.mjs` | Settles a finished season: replays it, writes `game-data/settlements/season-N.json`, prints (or with `--send`, posts) `publish()` |

`npm run game` starts the API (reads `.env.game`; demo mode unless `TYCOON_CONTRACT` and `TYCOON_RPC` are set).
`npm test` runs the rate-limit, engine and city-contract tests; the contract test runs a full season on a local
Ganache chain and never touches a real network. `npm run sim` prints demo season results. `npm run settle -- <season>`
checks or settles a season against the deployed contract.

`npm run fork-test` deploys the implementation and `CityProxy` and plays a full season on a local fork of BNB Chain mainnet: the real SPACE ID Agent ID contract
(`0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`, symbol AI) gates entry, three real Agent ID holders are impersonated
on the fork, and a live Flap tax token stands in for the city token. It needs network access (an archive RPC for
the fork) and sends nothing to mainnet.

## Deploying to BNB Chain mainnet

Fill the deployment block of `.env.game` (see `.env.game.example`), then:

1. `npm run deploy -- check` (read-only). It checks the config, the Agent ID contract and the deployer's balance. Then it
   rehearses the whole deployment from the deployer's address on a local mainnet fork and estimates the cost (about
   3.3M gas).
2. `npm run deploy -- deploy --send` deploys the implementation and `CityProxy`, reads the state back, and writes
   `deployments/bsc-mainnet.json` and `deployments/verify-input.json` (git-ignored). It asks you to type `DEPLOY` first.
3. Verify both contracts on BscScan with the standard-JSON input (compiler v0.8.30, optimizer 200 runs, EVM shanghai).
4. Launch the token on Flap with **native BNB** as the quote token, 2% tax, the longest `taxDuration`, all of the tax
   to the beneficiary, and the beneficiary set to the proxy address.
5. `npm run deploy -- set-token <token>` checks on chain that the token's tax processor pays the proxy in native BNB
   (it refuses anything else). Then run it again with `--send` to call `setToken` from the operator key (type `SET`).
6. Point the API at the city: `TYCOON_CONTRACT=<proxy>` and `TYCOON_FROM_BLOCK=<deploy block>`. `npm run deploy -- status`
   shows the live state.

The script was rehearsed end to end against a local node forking mainnet: deploy, the refusal of a token whose tax goes
elsewhere or is paid in WBNB, `setToken`, the one-time guards and `status`.
