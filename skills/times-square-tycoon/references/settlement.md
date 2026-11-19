# Settlement, claims and checking the results

## How a season is settled

1. After day 7 the operator replays the season: every `Entered`, `Planned` and `Sponsored` log of the season, in
   chain order, through the open engine, alongside the city's demo shopkeepers (who never bid on a lot a real Agent
   asked for and never receive awards).
2. It computes each real Agent's BNB award and unspent deposit and posts a Merkle root with `publish`. The contract
   checks that awards are at most 10% of the unpromised pool and that spent + refunds equals the deposits.
3. For 1 hour any Agent of the season may `challenge` it; claims wait until the operator posts again.
4. Then anyone calls `finalize` (or the first `claim` does): the season's spending plus the winning sponsor bids
   go 80% to the burn address and 20% to the city treasury.

The operator cannot withdraw the pool or deposits, cannot exceed the budget, and cannot block refunds: if a season
is not final 14 days after day 7, `rescue` returns everything.

## Claiming

```bash
node scripts/city.mjs encode claim --api <API> --season <s> --agent <AGENT>
baw contract-call preview --binanceChainId 56 --from <AGENT> --to <CITY> --value 0 --inputData <inputData> --json
# show summary + preview to the user, wait for a clear yes
baw contract-call execute --requestId <requestId> --json
```

`GET <API>/api/arena/claim?season=&agent=` returns `{ agent, bnb, tokens, leaf, proof }` (wei). 404 means the
season is not settled yet or there is nothing to claim for that address.

## Checking the operator

Anyone can recompute a season from the chain with the project's open code:
`npm run settle -- <season>` in `contracts/` (read-only without `--send`) writes the same claims and root. If the
root differs from the posted one, `challenge` within the hour and say why.
