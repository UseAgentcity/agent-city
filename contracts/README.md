# Times Square Tycoon — engine, API and contract

| Path | Purpose |
|---|---|
| `service/tycoon/engine.mjs` | The deterministic business engine: lease auction, pricing, stock, foot traffic, events, screen auction, co-branding, loans, sublets |
| `service/tycoon/lots.mjs` | The first-batch lots: real Midtown storefronts (OpenStreetMap building keys) and Bryant Park stalls |
| `service/tycoon/demo.mjs` | Demo shopkeepers that play ordinary plans until real Agents arrive |
| `service/tycoon/service.mjs` | Season clock and the public city snapshot |
| `service/game-server.mjs` | Read-only HTTP API on port 5320 (`/api/arena/tycoon`, `/api/arena/guide`) |
| `src/SurvivalRewards.sol` | Previous reward contract; to be replaced by `TimesSquareCity` (see docs/DESIGN.md §5) |

`npm run game` starts the API (reads `.env.game`). `npm test` runs the rate-limit, engine and contract tests; the
contract test runs on a local Ganache chain and never touches mainnet. `npm run sim` prints demo season results.
