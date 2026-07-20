# BASEBALL ONE Scorebook Article Diff Audit

Source: https://baseball-one.com/blog/archives/274598/

This audit only covers score-cell notation. It does not claim that the app is a complete official scorebook.

## Fixed In Current UI Logic

| Article notation | Current handling |
|---|---|
| Strikeout is `K` | Displays as a black out mark, not a red result |
| Dropped third strike out is `K` plus `2-3` | Displays `K 2-3`; no Japanese `振り逃げ` / `K逃` in score cell |
| Ground out by throw is `fielder-out maker`, e.g. `6-3` | Keeps `6-3` style for first-base throw outs |
| First baseman fields and steps on first base | Displays `3A`, not `3-3` |
| First baseman fields and pitcher covers first base | Displays `3-1A` |
| Foul fly uses `F` plus fielder number | Adds `F` only for foul-zone catch flow |
| Normal fly does not use `F` | Fair fly out label is the fielder number only |
| Passed ball is `P` | Displays `P`, not `PB` |
| Batter interference is `IF` | Displays `IF`, not Japanese text |
| Obstruction is `OB` | Displays `OB`, not Japanese text |
| Runner tag out shorthand | Displays `T.O` instead of Japanese `走死` |
| Score cell should not show Japanese labels | Display conversion suppresses Japanese result text in score cells |
| Ball/strike/foul pitch symbols are black | Pitch symbols render black (#111) |
| Walk `B` and hit-by-pitch `HP` are blue | `B`/`HP` render blue (#006fc9); `IB` still has no UI input |
| Hits and advance segments are red lines | The batter's own reach draws red segments; advances on a later batter's play draw black arrows (arrowhead on the furthest base) per article section 11 |
| Earned vs unearned run marks | Earned runs (no error/passed-ball in the runner's chain, simplified rule) draw a filled red circle; unearned runs draw an outline-only red circle; home runs count as earned |
| RBI circles the batting order number | When a runner scores, the driving batter's order number is written at the scoring runner's home corner, circled (①-style) when the advance reason carries an RBI (hit/walk/HP/CI/FC), plain otherwise; run itself marked with the red center circle |
| Three-out slash and left-on-base mark | Inning-end slash recorded on the final entry; runners stranded at the third out get `ℓ` written into their completed scorebook cells |
| Completed cells keep updating with later baserunning | Runner advances, steals, outs on base, and runs recorded during later at-bats are now written back into that runner's scorebook cell (output mirrors input) |

## Remaining Differences

These still differ from the article. They should not be treated as fully implemented.

| Article notation | Current gap | Reason |
|---|---|---|
| Swinging strike differs from looking strike | Current UI has one strike input and one strike symbol | Requires new input or strike-type state |
| Bunt foul and bunt swing have extra marks | No bunt input | Requires UI/input support |
| Three-bunt failure has `K` with wavy underline | No bunt input | Requires UI/input support and new drawing |
| Fly out has an arc over the fielder number | Current logic can output the number, but does not draw the arc | Requires score-cell drawing support |
| Liner out has a line over the fielder number | No liner input | Requires UI/input support and drawing |
| Foul fly has `F` plus fly arc | Current logic can output `F5`, but does not draw the arc | Requires score-cell drawing support |
| Bunt foul fly has `F`, fly arc, and bunt mark | No bunt-fly distinction | Requires UI/input support and drawing |
| Hit landing point uses fielder number plus dot position | Current hit location stores the fielder number, but not over/line/landing-dot position | Requires additional input/data/drawing |
| Doubles/triples distinguish over/line by dot position | Current long-hit display cannot encode dot placement | Requires additional input/data/drawing |
| Home run has central run/scoring mark | Current home-run handling does not fully draw the article's center mark | Requires score-cell drawing support |
| Force out records the forced runner's play such as `4-6` and batter safe on throw | Current runner-out flow does not reliably distinguish force out vs tag out vs throw interval | Requires more play-detail state |
| Tag out records fielder plus `T.O` | Current fallback is only `T.O` for runner out | Requires tag fielder tracking |
| Stolen base caught stealing is `CS` | Runner-out after steal is not converted to `CS` | Requires steal-out detail state |
| Wild pitch is `W` | No wild-pitch input | Requires UI/input support |
| Double steal/triple steal are `DS`/`TP` | Not grouped as one play | Requires multi-runner steal classification |
| Fielder's choice is `Fc` | No fielder's-choice input | Requires UI/input support |
| Double play is `DP` | Multiple outs can be recorded, but not as one `DP` notation | Requires play-level grouping |
| Rundown play records a throw chain | No full throw-chain score-cell notation | Requires richer play-detail state |

## Conclusion

I cannot honestly say the current app has no differences from the article. The current code is closer for the score-cell labels that the existing UI can already infer, but complete article parity still needs UI/input and score-cell drawing changes.
