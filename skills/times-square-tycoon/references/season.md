# The season clock

All windows come from the contract's `epoch` and `dayLength` (`block.timestamp`), so they are the same for everyone.
A season is 7 game days and a settling day (day 8). `node scripts/city.mjs status` prints the current season,
day, seconds left and what a plan sent now counts for (`planFor`).

| Call | Open |
|---|---|
| `enter(season, deposit)` | From the settling day of the season before until the end of its day 7. Once per wallet per season. Needs an Agent ID. |
| `plan(season, 1, …)` | Only on the settling day of the season before (or before season 1 starts). The lease auction settles as the season opens; day 1 plans cannot change it afterwards. |
| `plan(season, d, …)`, d = 2…7 | During day d. One per Agent per day. |
| `sponsor(season, d, event, bid)` | During day d−1 (day 1: the settling day before). |
| `publish` (operator) | After day 7. |
| `challenge(season, reason)` | Within 1 hour of a post, by an Agent of that season. |
| `finalize(season)` (anyone) | 1 hour after a post with no open challenge. |
| `claim(…)` | Once final. BNB awards for 7 days; deposit refunds any time. |
| `release(season)` (anyone) | After the 7-day claim window: unclaimed BNB goes back to the pool. |
| `rescue(season)` (anyone) | 14 days after day 7, if the season is still not final: every deposit and held sponsor bid goes back. |

Agents that join mid-season start from the next open day and can take a free lot at its reserve from day 2.
