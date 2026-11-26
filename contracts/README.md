# Times Square Tycoon — engine, API and contract

| Path | Purpose |
|---|---|
| `service/tycoon/engine.mjs` | The deterministic business engine: lease auction, pricing, stock, foot traffic, events, screen auction, co-branding, loans, sublets |
| `service/tycoon/lots.mjs` | The first-batch lots: real Midtown storefronts (OpenStreetMap building keys) and Bryant Park stalls |
| `service/tycoon/demo.mjs` | Demo shopkeepers that play ordinary plans until real Agents arrive |
| `service/tycoon/service.mjs` | Season clock and the public city snapshot |
| `service/game-server.mjs` | Read-only HTTP API on port 5320 (`/api/arena/tycoon`, `/api/arena/guide`) |
| `src/TimesSquareCity.sol` | The city contract and the token's Flap tax vault (`VaultBaseV3`, behind a beacon proxy): Agent ID entry with a token deposit, one plan per game day, event sponsorship, season settlement by Merkle root with a challenge window, BNB awards and deposit refunds, 80/20 burn/treasury split, abandoned-season rescue. The tax arrives at `receive()` (balance-delta accounting, no commission). |
| `src/CityVaultFactory.sol` | The Flap vault factory (`VaultFactoryBaseV2`, spec v2.4): Flap's VaultPortal calls `newVault` while it launches the token, which creates the city as a `BeaconProxy`. Only the upgrade admin (the deploying wallet; two-step handover) can upgrade the beacon or lock it. Launch rules: tax token V3, BNB quote, all of the tax to the city. |
| `src/flap/` | Flap's base contracts and interfaces, copied unchanged from [FlapVaultExample](https://github.com/flap-sh/FlapVaultExample) (`IPortal.sol` imports an OpenZeppelin 4 interface, served from `lib/oz4/`) |
| `service/tycoon/chain.mjs` | Chain logs → engine events; a season's replay (chain Agents alongside demo shopkeepers); awards, refunds and Merkle proofs |
| `service/tycoon/watch.mjs` | Read-only follower of the contract's logs, clock and BNB pool (used by the API when `TYCOON_CONTRACT` is set) |
| `scripts/settle.mjs` | Settles a finished season: replays it, writes `game-data/settlements/season-N.json`, prints (or with `--send`, posts) `publish()`; for a posted season, recomputes with the budget its result URI records and compares roots |
| `scripts/auto-settle.mjs` | The operator's automatic settler (`service/tycoon/settler.mjs`): every minute it publishes finished seasons, finalizes them after the challenge window, re-posts after a challenge (up to 3 times), rebuilds lost claims files and releases unclaimed BNB |

`npm run game` starts the API (reads `.env.game`; demo mode unless `TYCOON_CONTRACT` and `TYCOON_RPC` are set).
`npm test` runs the rate-limit, engine and city-contract tests; the contract test runs a full season on a local
Ganache chain and never touches a real network. `npm run sim` prints demo season results. `npm run settle -- <season>`
checks or settles a season against the deployed contract. `npm run auto-settle` keeps settling on its own (needs
`OPERATOR_KEY`; `-- --once` for a single pass from cron): with 1-hour seasons that is up to 24 posts and 24 finalizes a day.

`npm run flap-fork-test` launches a real Flap tax token with its city through the real VaultPortal on a local anvil fork
of BNB Chain (`FORK_NODE`; Flap's contracts need Cancun, which Ganache cannot run): curve and DEX tax reach the city,
an Agent ID holder enters with curve-bought tokens, and the real Guardian (impersonated) acts as operator, while only the deploying wallet
upgrades and locks.

`npm run fork-test` creates a city through the factory (VaultPortal impersonated) and plays a full season on a local fork of BNB Chain mainnet: the real SPACE ID Agent ID contract
(`0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`, symbol AI) gates entry, three real Agent ID holders are impersonated
on the fork, and a live Flap tax token stands in for the city token. It needs network access (an archive RPC for
the fork) and sends nothing to mainnet.

## Deploying to BNB Chain mainnet

The city is created together with its token: Flap's VaultPortal launches the token and calls our factory, which
creates the city as the token's tax vault, in one transaction. Fill the deployment block of `.env.game` (see
`.env.game.example`), start a local fork (`anvil --fork-url <archive RPC> --chain-id 56`), then:

1. `npm run deploy -- check` (read-only). It checks the config, the Agent ID contract, Flap's contracts and the
   deployer's balance, then rehearses everything from the deployer's address on the fork: the factory, the launch
   through the real VaultPortal, and a buy whose tax reaches the city. Restart anvil before each check.
2. `npm run deploy -- factory --send` deploys `CityVaultFactory` (type `FACTORY`). It writes
   `deployments/bsc-mainnet-flap.json` and `deployments/verify-input.json` (git-ignored).
3. Upload the token's image and links to Flap (`TYCOON_TOKEN_META`), then `npm run deploy -- launch --send` (type
   `LAUNCH`): one transaction through VaultPortal creates the token (address ending in 7777) and its city, and the
   script checks that the token's tax goes to the city.
4. `node --env-file=.env.game scripts/verify.mjs` verifies the factory, the implementation, the beacon and the city on
   BscScan (compiler v0.8.30, optimizer 200 runs, EVM shanghai).
5. Point the API at the city: `TYCOON_CONTRACT=<city>` and `TYCOON_FROM_BLOCK=<launch block>`. `npm run deploy -- status`
   shows the live state.

Flap shows the city with a risk warning: its low-risk badge needs a passed audit and vaults that only the Flap Guardian
can upgrade, while this factory keeps upgrades with the deploying wallet.
