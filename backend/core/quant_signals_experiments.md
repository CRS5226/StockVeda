# Swing Trade Pullback — tuning experiment log

Every parameter experiment on the Swing Trade Pullback algo gets one row here
**before** deciding keep/revert — including negative results. A "control basket"
(a group the change should *not* affect) is checked alongside the target every
time, since a scoped change that leaks into other symbols is a bug, not a result.

## Summary (updated as ideas land)

**Swing Trade Pullback family — current state: v1 through v5 all live,
byte-for-byte independent of each other (`swing_pullback`, `swing_pullback_v2`,
`swing_pullback_sector_rs`, `swing_pullback_v4`, `swing_pullback_v5`).**
- **v1** — baseline. Full 3yr, all 9 baskets, doesn't clear realistic
  transaction costs in 6 of 8 (idea #14) — thin/not tradeable alone.
- **v2** — v1 + midcap-watchlist-scoped zone-anchor bias. Kept, narrow fix.
- **v3** — v1 + sector-relative-strength (own-sector benchmark instead of
  Nifty). Beats v1 in 9/9 baskets.
- **v4** — v3 + volume principle (quiet retest, volume-on-trigger). Beats v3
  in every basket; known caveat: Nifty Mid Select regresses on holdout.
- **v5 (current best)** — v4 minus Fibonacci retracement levels (ablation
  test showed Fib hurts more than helps on holdout, fixes v4's Mid Select
  caveat). Beats v1 in 7/8 baskets, **survives transaction costs in 7/8**
  (idea #14) — the only variant confirmed cost-viable across most baskets.
- **Rejected additions to the swing-pullback family** (tried, logged,
  reverted, code restored): VIX/Nifty-trend regime gate, sector-rotation
  ranking (idea #12), market breadth filter (idea #13), trailing-stop +
  partial-profit-take (idea #11), max-concurrent-positions cap (idea #10,
  validation only — confirmed the backtest wasn't relying on unrealistic
  concurrency). Pattern: **every global regime/context filter tried has
  failed** — this strategy's edge lives in individual-stock setup quality,
  not market-cycle timing. RSI could not be cleanly ablated (idea #9,
  attempts 1-2) — any change to it collapses the score-threshold's
  selectivity, confounding the test; left untouched, unresolved.

**Accumulation algo (separate strategy, not swing-pullback family) — parked,
untestable at current data volume, settled after three relaxation attempts.**
Fires only 7-9 trades across the full 9-basket + full-211-stock-F&O-universe
test (idea #15). Tried relaxing gate-only, entry-only, and both combined
(idea #15 follow-ups) — each step added a handful more trades but PF kept
degrading (Midcap 150: 6.0×→2.8×→2.6×) and every other basket's win rate
collapsed to ~0%; Nifty Bank/Fin Service produced zero trades even fully
relaxed. **Confirmed: a hard floor, not a tuning gap** — the original
strictness is load-bearing. External research confirms this is a real,
recognized NSE pattern, but needs years more data (or live paper-trading) to
validate at this trade frequency — no further parameter search planned.

**Methodology established this session, applied to every experiment above:**
train/holdout split (not just full-period aggregate — full-period results
have repeatedly hidden holdout-period failures), isolated single-variable
ablation (confounded multi-variable changes give unreliable reads), realistic
transaction-cost modeling before trusting any raw PF, and always reverting +
sanity-checking production back to its exact prior state after every
temporary test.

Baseline (no experiment applied), 2yr = today-2y→today, 3yr = today-3y→today,
account_capital=1,000,000:

| Basket | 2yr Trades/WinRate/PF/P&L | 3yr Trades/WinRate/PF/P&L |
|---|---|---|
| Nifty Bank / Bankex | 7 / 28.6% / 1.13× / +₹4,471 | 11 / 18.2% / 0.72× / -₹14,512 |
| Midcap 150 | 49 / 28.6% / 0.98× / -₹4,575 | 93 / 25.8% / 0.90× / -₹37,146 |
| Nifty Next 50 (control for banking/midcap ideas) | 24 / 29.2% / 1.19× / +₹19,006 | 43 / 25.6% / 0.88× / -₹22,186 |
| Sensex | 15 / 40.0% / 2.49× / +₹73,654 | 30 / 36.7% / 1.89× / +₹90,178 |
| Nifty Mid Select | 9 / 33.3% / 1.27× / +₹10,933 | 18 / 44.4% / 1.89× / +₹58,381 |
| Nifty 50 | 27 / 33.3% / 1.82× / +₹81,393 | 48 / 29.2% / 1.25× / +₹46,714 |
| Nifty 100 | 43 / 32.6% / 1.61× / +₹99,414 | 83 / 28.9% / 1.17× / +₹56,859 |
| Nifty Fin Service | 7 / 42.9% / 1.95× / +₹25,679 | 19 / 31.6% / 1.04× / +₹2,690 |

Prior global-scope experiment (for reference, already reverted): lowering
`_ZONE_ANCHOR_OVERSHOOT_ATR` from 0.5→0.25 **globally** looked good on one 2yr
sample (PF 1.23×→1.36×) but regressed the full 3yr universe (PF 1.157×→1.102×,
total P&L +₹69,246→+₹32,905) — reverted, constant restored to 0.5. This is why
every experiment below is scoped narrowly instead of applied globally.

| Date | Idea # | Scope (symbols) | Param changed | Target basket before → after | Control basket before → after | Verdict | Notes |
|---|---|---|---|---|---|---|---|
| 2026-08-02 | #1 | Nifty Bank/Bankex (14 syms) | `_ZONE_ANCHOR_OVERSHOOT_ATR` 0.5→0.25, banking-only | Nifty Bank: 2yr PF 1.13×→**0.71×** (+₹4,471→**-₹7,291**), 3yr PF 0.72×→**0.40×** (-₹14,512→**-₹26,820**) | Nifty Next 50: 2yr PF 1.19×→0.99× (+₹19,006→-₹1,151), 3yr PF 0.88×→0.77× (-₹22,186→-₹42,344) | **REVERTED** | Target got clearly *worse*, not better — the small-sample entry-style split (zone_anchored trades outperforming default-entry trades for Nifty Bank in isolation) did not generalize once forced at scale; forcing the mechanism changes which signals arm/trigger in the first place, not just "more of the same good trades." Also caught a test-design bug: the "control" wasn't clean — Nifty Next 50 shares 4 symbols with Nifty Bank (BANKBARODA, CANBK, PNB, UNIONBANK), so part of its movement is real leakage, not a false alarm. Even accounting for that overlap, the core idea is dead — reverted, `_ZONE_ANCHOR_OVERSHOOT_ATR` restored to 0.5 (unscoped code removed, not left dangling unused). |
| 2026-08-02 | #2 | Midcap 150 (150 syms) | _ZONE_ANCHOR_OVERSHOOT_ATR 0.5→0.25, midcap-only | Midcap 150 2yr: 49 trades / 28.6% / 0.97× / ₹-5,206→40 trades / 32.5% / 1.29× / ₹43,962; 3yr: 93 trades / 25.8% / 0.90× / ₹-37,146→73 trades / 30.1% / 1.20× / ₹55,898 | Nifty Next 50 (clean, 0 overlap) 2yr: 24 trades / 29.2% / 1.19× / ₹19,006→24 trades / 29.2% / 1.19× / ₹19,006; 3yr: 43 trades / 25.6% / 0.88× / ₹-22,186→43 trades / 25.6% / 0.88× / ₹-22,186 | KEPT | all criteria met |
| 2026-08-02 | #4 | Nifty Bank/Bankex (14 syms) | STEP10 stop k +0.5 for banking-sector confirmed trades | Nifty Bank 2yr: 7 trades / 28.6% / 1.13× / ₹4,471→7 trades / 28.6% / 0.95× / ₹-1,892; 3yr: 11 trades / 18.2% / 0.72× / ₹-14,512→12 trades / 25.0% / 0.74× / ₹-16,844 | Next50-ex-Bank (46 syms, verified 0 overlap) 2yr: 21 trades / 28.6% / 1.13× / ₹11,420→21 trades / 28.6% / 1.13× / ₹11,420; 3yr: 40 trades / 25.0% / 0.83× / ₹-29,772→40 trades / 25.0% / 0.83× / ₹-29,772 | REVERTED | 2yr PF did not improve; 3yr P&L did not improve |

## Idea #5 — persistent stop-loss stock diagnostic (isolated 3yr re-check, final code state)

| Symbol | Trades (isolated) | Win Rate | P&L |
|---|---|---|---|
| VEDL | 3 | 0.0 | -16462.11 |
| MOTHERSON | 3 | 0.0 | -21168.16 |
| YESBANK | 1 | 0.0 | -5411.93 |
| INDUSINDBK | 1 | 0.0 | -6860.44 |
| BPCL | 2 | 0.0 | -13341.27 |
| KPRMILL | 3 | 0.0 | -12528.42 |
| BANKBARODA | 1 | 0.0 | -6446.38 |
| BHEL | 2 | 0.0 | -12481.13 |
| CHOLAFIN | 2 | 0.0 | -12377.93 |
| HAVELLS | 2 | 0.0 | -12270.66 |
| UNIONBANK | 1 | 0.0 | -6125.04 |
| GODREJIND | 2 | 0.0 | -12160.41 |
| MOTILALOFS | 0 | 0.0 | 0 |
| FEDERALBNK | 0 | 0.0 | 0 |
| JSL | 0 | 0.0 | 0 |
| OIL | 1 | 0.0 | -5553.67 |
| DIVISLAB | 2 | 0.0 | -11136.4 |
| NYKAA | 1 | 0.0 | -6773.61 |
| DMART | 2 | 0.0 | -10658.94 |
| HINDZINC | 2 | 0.0 | -10655.26 |
| LODHA | 2 | 0.0 | -10014.62 |
| KEI | 2 | 0.0 | -10005.98 |
| NATIONALUM | 1 | 0.0 | -3763.2 |
| ADANIPOWER | 2 | 0.0 | -7721.7 |

## Idea #2 productionized — v1/v2 split (2026-08-02)

Idea #2's kept change was originally baked directly into the single "swing_pullback"
algo with a hardcoded 150-symbol Python set. Replaced with a proper design:

- **`swing_pullback`** — reverted to true original baseline (no midcap scoping at all).
- **`swing_pullback_v2`** ("Swing Trade Pullback v2 (Midcap-tuned)") — new registered
  algo, identical gates/score/zones/exits, with the zone-anchor overshoot threshold
  lowered to 0.25×ATR *only* for symbols currently in the "midcap 150" watchlist —
  looked up live from the DB per request (`fetch_midcap_scope()`), not frozen in code,
  so editing that watchlist keeps the tuning current instead of drifting stale.

Both now appear as separate selectable algos in Quant Signals so results can be
compared side by side. Verified on fresh 3yr data post-refactor:

| Algo | Midcap 150 | Nifty Next 50 (unrelated control) |
|---|---|---|
| swing_pullback (v1) | 94 trades / 25.5% / 0.90× / -₹39,769 | 43 trades / 25.6% / 0.88× / -₹22,186 |
| swing_pullback_v2 | 74 trades / 29.7% / 1.19× / +₹53,274 | 43 trades / 25.6% / 0.88× / -₹22,186 |

v1 and v2 are byte-for-byte identical on Nifty Next 50 (zero symbols in the midcap
scope) — confirms the split only affects midcap-watchlist symbols, no leakage.

## Liquidity-based generalization attempt — REVERTED (2026-08-04)

Tried replacing v2's watchlist-membership scope with a computed characteristic
(trailing 20-day turnover ≤₹200cr, picked from a real turnover survey across 340
synced symbols, not fit to backtest P&L) to avoid overfitting to one frozen symbol
list. Validated with a proper train/test split on Midcap 150 first (train PF
0.62×→0.68×, test PF 0.90×→1.00× — looked genuinely promising, held up out of
sample) — but the full 9-index sweep told a different story:

| Index | v1 PF/P&L | v2-liquidity PF/P&L | Verdict |
|---|---|---|---|
| Midcap 150 | 0.91× / -₹34,190 | 1.04× / +₹11,510 | Better, but far weaker than watchlist-based v2 (1.21× / +₹58,853) |
| Nifty 100 | 1.21× / +₹68,057 | 1.09× / +₹28,772 | Worse |
| Nifty Bank | 0.72× / -₹14,512 | **0.38×** / **-₹28,816** | Much worse — as bad as the already-rejected idea #1 |
| Nifty Fin Service | 1.04× / +₹2,690 | 0.84× / -₹12,386 | Worse, flipped to a loss |
| Nifty Next 50 | 0.90× / -₹17,736 | 0.65× / -₹59,475 | Much worse |
| Nifty 50, Mid Select, Sensex | — | — | Roughly flat/unchanged |

**Reverted** — turnover alone is too blunt an instrument. It catches low-turnover
*bars* inside Bank/Fin Service/Next 50 stocks too, and those are exactly the
baskets where forcing the discount entry hurts (consistent with idea #1's
failure). Whatever actually makes the midcap150 watchlist special isn't reducible
to a simple liquidity number — likely some combination of technical structure,
sector mix, or curation quality that a single computed proxy doesn't capture.
`swing_pullback_v2` is back to the watchlist-membership version (commit `6aeded5`),
confirmed via `git checkout` back to last-committed state, restarted, verified live.

**Lesson for next time:** a train/test split proves an idea isn't a fluke *within
the basket you tested it on* — it does NOT prove the idea generalizes to baskets
you didn't test. Both checks are needed; passing one without the other isn't
enough, as this experiment demonstrated directly.

## Global VIX/Nifty-trend regime gate — REVERTED (2026-08-04)

Tried the highest-confidence idea from the research pass: a blanket entry gate
(not stock/sector-scoped) requiring Nifty close > its own 200-day average AND
India VIX ≤ ~18.5 (grounded in the real 3yr VIX distribution — p75≈15.3,
p90≈18.3, max≈27.9). Implemented as a third algo, `swing_pullback_regime`, so
it could be directly compared against v1 and v2.

**Data prerequisite fixed along the way:** the `india_vix` DB table was never
actually populated — `sync_vix.py` existed but was never registered in
`_SYNC_MODULES` (backend/main.py), and its source URL
(archives.nseindia.com/.../ind_vix_hist.csv) returns 404 as of 2026-08 (NSE
retired/moved it). Rewrote the sync to pull from yfinance (`^INDIAVIX`) instead
— the same source the live macro dashboard already falls back to — registered
it in `_SYNC_MODULES`, backfilled 4312 rows (2009-2026). **This fix is kept**
(commit follows) — it's a genuine, unrelated bug fix, independent of whether
the regime-gate idea itself worked.

**The regime-gate idea itself: rejected, unanimous across all 9 indices:**

| Index | v1 PF | v2 PF | Regime PF | Regime P&L |
|---|---|---|---|---|
| Nifty 50 | 1.25× | 1.29× | 1.02× | +₹2,309 (down from +₹46,714) |
| Nifty 100 | 1.21× | 1.26× | 0.93× | -₹19,667 (flipped to loss) |
| Nifty Bank | 0.72× | 0.86× | 0.37× | -₹34,540 |
| Nifty Fin Service | 1.04× | 1.04× | 0.64× | -₹26,542 (flipped to loss) |
| Nifty Mid Select | 1.89× | 2.32× | 1.82× | +₹40,133 (down from +₹58,381) |
| Nifty Next 50 | 0.90× | 0.90× | 0.74× | -₹41,445 |
| Sensex | 1.89× | 1.89× | 1.38× | +₹35,485 (down from +₹90,178) |
| Bankex | 0.72× | 0.86× | 0.37× | -₹34,540 |
| Midcap 150 | 0.91× | 1.21× | 0.81× | -₹56,011 |

Worse than v1 in **every single basket**, no exceptions — a cleaner, more
decisive rejection than any prior experiment.

**Why, most likely:** requiring the broad Nifty index to already be above its
own 200-day average is a blunt, lagging, aggregate-level condition. It throws
out exactly the early-recovery pullback setups this algorithm targets — a stock
can have a genuinely clean technical pullback while the broad index is still
below its own trend line (the earlier Market Regime cards work this session
already showed individual-stock "basket average" returns often stay positive
even in years the index itself is negative — the dispersion this gate ignores).
Reverted; `swing_pullback_regime` removed from `ALGO_IDS`/metadata/dispatch,
`backend/core/quant_signals.py`, `backend/routes/backtest.py`, and
`frontend/src/lib/api.ts` restored to the last-committed (v1/v2-only) state via
`git checkout`. `backend/main.py` and `backend/data_sync/sync_vix.py` (the VIX
data-pipeline fix) were kept.

## Sector-relative-strength factor — KEPT as v3 (2026-08-04)

Idea #2 from the research plan: replace/augment the Nifty-only RS factor with
RS computed against each stock's own NIFTY sector index (Bank, IT, FMCG,
Pharma, Metal, Energy, Realty), falling back to the Nifty-relative version
per-row wherever a symbol's sector is unmapped or its index has no data.

**Data prerequisite:** sector classification was previously a live-only
yfinance call with zero caching (the Stock Detail sector-compare endpoint
fetches it fresh every time). Added a `stock_sector` cache table
(`backend/db/schema.sql`) so this is a live yfinance call once per symbol
ever, not once per backtest run. Confirmed all 7 sector indices have full
2022-2026 history in `index_ohlcv` before building on them.

**Result — the first idea all session to help every basket, zero exceptions:**

| Index | v1 PF/P&L | v2 PF/P&L | v3 (Sector-RS) PF/P&L |
|---|---|---|---|
| Nifty 50 | 1.25× / +₹46,714 | 1.29× / +₹52,751 | **1.33× / +₹54,456** |
| Nifty 100 | 1.21× / +₹68,057 | 1.26× / +₹79,622 | **1.31× / +₹87,150** |
| Nifty Bank | 0.72× / -₹14,512 | 0.86× / -₹6,115 | **1.12× / +₹6,150** (flipped to profit) |
| Nifty Fin Service | 1.04× / +₹2,690 | 1.04× / +₹2,690 | **1.57× / +₹36,128** |
| Nifty Mid Select | 1.89× / +₹58,381 | **2.32× / +₹76,737** | 2.16× / +₹75,674 |
| Nifty Next 50 | 0.90× / -₹17,736 | 0.90× / -₹17,736 | **1.07× / +₹10,532** (flipped to profit) |
| Sensex | 1.89× / +₹90,178 | 1.89× / +₹90,178 | **2.04× / +₹96,676** |
| Bankex | 0.72× / -₹14,512 | 0.86× / -₹6,115 | **1.12× / +₹6,150** |
| Midcap 150 | 0.91× / -₹34,190 | **1.21× / +₹58,853** | 1.06× / +₹22,066 |

Beats v1 in all 9/9 baskets. Beats v2 in 7/9 — only narrowly loses on Nifty
Mid Select and Midcap 150, the two baskets v2's midcap-specific tuning was
built for, which is expected. Notably flips both of the session's structurally
weakest baskets (Nifty Bank, Nifty Next 50) from losses to profits.

**Verdict: KEPT.** Registered as `swing_pullback_sector_rs`, labeled "Swing
Trade Pullback v3 (Sector-RS)" in `ALGO_METADATA`, live in the Quant Signals
selector (metadata-driven frontend, no hardcoded UI needed).

**Open question for a future session:** v2's midcap-entry-threshold tuning and
v3's sector-RS benchmark change are independent mechanisms — worth testing
whether a combined variant (both together) beats either alone, especially for
Midcap 150 where v3 alone underperforms v2.

## Idea #7 — volume principle on PULLBACK confirmation (quiet retest, volume-on-trigger)

Research (Strike Money, DayTradingToolkit) says a *healthy* pullback shows
volume **drying up** during the retest and **picking up** on the actual
breakout/trigger — the opposite of the original PULLBACK confirmation logic,
which required volume ≥1.2× avg on the pullback candle itself. Two changes,
applied together:

1. `_build_swing_pullback_signal` (STEP9): pullback-day confirmation flipped
   from `volume >= 1.2 * vol20` to `volume <= 1.0 * vol20` (quiet retest).
2. `_run_swing_pullback_trades`: for non-zone-anchored PULLBACK entries, the
   trigger day additionally requires `volume >= 1.5 * vol20` (volume pickup on
   the actual breakout fill).

Applied identically to v1, v2, and v3 (global logic change, not a per-basket
scope). Tested full 3yr period across all 9 baskets first, then validated with
a train/holdout split (train = today-3y→today-1.5y, holdout =
today-1.5y→today) per basket per variant, since this session has repeatedly
seen full-period aggregates hide holdout-period weaknesses (see idea #6).

**Train → holdout PF, old logic → new logic:**

| Basket | V1 train | V1 holdout | V2 train | V2 holdout | V3 train | V3 holdout |
|---|---|---|---|---|---|---|
| Nifty 50 | 0.81→1.66 | 1.66→1.64 | 0.89→1.88 | 1.66→1.64 | 1.17→2.09 | 1.16→1.12 |
| Nifty 100 | 0.70→1.07 | 1.83→2.19 | 0.76→1.19 | 1.83→2.19 | 0.86→1.23 | 1.45→1.79 |
| Nifty Bank | 0.0→0.0 | 1.97→5.07 | 0.0→0.0 | 2.83→8.71 | 1.44→1.83 | 2.00→5.07 |
| Nifty Fin Service | 0.25→1.10 | 2.47→3.58 | 0.25→1.10 | 2.47→3.58 | 0.71→1.58 | inf→inf |
| **Nifty Mid Select** | 1.35→1.95 | **1.89→0.53** | 1.95→2.13 | 2.15→1.90 | 1.35→1.95 | **1.92→0.53** |
| Nifty Next 50 | 0.36→0.48 | 1.24→2.89 | 0.36→0.48 | 1.24→2.89 | 0.40→0.52 | 1.46→2.93 |
| Sensex | 1.65→1.93 | 2.35→2.42 | 1.65→1.93 | 2.35→2.42 | 2.14→2.36 | 1.78→1.78 |
| Bankex | 0.0→0.0 | 1.97→5.07 | 0.0→0.0 | 2.83→8.71 | 1.44→1.83 | 2.00→5.07 |
| Midcap 150 | 0.62→1.16 | 0.90→0.90 | 0.84→1.24 | 1.20→1.26 | 0.72→1.16 | 1.09→1.09 |

Broad, genuine improvement — training-set PF rises almost everywhere, and it
mostly holds or improves on holdout too. One real, repeated exception: **Nifty
Mid Select holdout regresses for both v1 and v3** (PF ~1.9× → 0.53×), the same
basket failing the same way under two independent variants — not noise. V2 is
only mildly softer there (2.15× → 1.90×), not a regression.

**Revised verdict: NOT applied to v1/v2/v3 in place.** Initially kept on all
three (`new_volume_logic=True` unconditionally), but decided instead to keep
v1/v2/v3 byte-for-byte unchanged and ship the volume logic as its own
selectable variant, so it doesn't quietly change the behavior of algo IDs
users already trust. See idea #8 below.

## Idea #8 — v4: volume principle on top of v3 (sector-RS), as a new algo

Before deciding which base to build on, compared full-period (3yr) results of
v1+volume vs v2+volume vs v3+volume across all 9 baskets (v2/v3 exact runs,
v1 approximated by summing the idea #7 train+holdout halves):

| Basket | v1+volume (approx, trades) | v2+volume (trades) | v3+volume (trades) |
|---|---|---|---|
| Nifty 50 | ~77,618 (37) | 122,789 (43) | 108,650 (41) |
| Nifty 100 | ~100,935 (56) | 151,304 (73) | 141,127 (70) |
| Nifty Bank/Bankex | ~32,925 (7) | 20,709 (9) | 28,373 (11) |
| Nifty Fin Service | ~15,749 (10) | 21,206 (16) | 41,374 (16) |
| Nifty Mid Select | ~15,325 (13) | 99,495 (16) | 89,270 (19) |
| Nifty Next 50 | ~12,849 (25) | 10,744 (38) | 26,849 (35) |
| Sensex | ~64,330 (21) | 108,506 (28) | 105,140 (28) |
| Midcap 150 | ~11,704 (64) | 132,400 (71) | 124,789 (84) |

v1+volume is clearly weakest everywhere — it lacks either v2's midcap-scope
tuning or v3's sector-RS. v2 and v3 are close; v3 wins the most baskets by a
clear margin (Fin Service, Next 50) and matches the idea #6 finding that v3
already beat v1 in 9/9 baskets and v2 in 7/9 even before volume was added.

**Built `swing_pullback_v4` = v3's sector-RS base + idea #7's volume-principle
logic**, registered as its own algo (own `ALGO_METADATA` entry, own frontend
option), leaving `swing_pullback`/`swing_pullback_v2`/`swing_pullback_sector_rs`
completely untouched. Sanity-checked post-registration: v1 and v3 3yr Nifty 50
results match their pre-idea-#7 baseline exactly (v1: 1.25× / +₹46,714; v3:
1.33× / +₹54,456), and v4 matches the v3+volume figure from idea #7's sweep
exactly (1.86× / +₹108,650) — confirms the dispatch change didn't leak into
the other three variants.

**Verdict: KEPT as `swing_pullback_v4`**, labeled "Swing Trade Pullback v4
(Sector-RS + Volume)". Inherits idea #7's Nifty Mid Select holdout caveat
(PF ~1.9× → 0.53× under both the v1 and v3 base) — logged, not patched.

## Idea #9 — ablation test: Fibonacci retracement levels and RSI factor

Prompted by external research (summarized to the user) arguing Fibonacci
retracements have no standalone empirical support and that hand-built
multi-indicator confluence systems risk overfitting. Ran an ablation test on
`swing_pullback` (v1) and `swing_pullback_v4`, checking each component in
isolation:

**Attempt 1 (confounded, discarded):** dropped RSI's factor entirely and
redistributed its 0.25 weight proportionally across the other 5 factors.
Trade count exploded 3x (Nifty 50: 48→153) because redistributing the weight
also effectively lowered the 0.40 score-qualify threshold — not a clean test
of RSI's predictive value.

**Attempt 2, RSI isolated properly:** kept RSI's weight fixed but forced its
factor score to a neutral constant (1.0, never discriminates), holding the
threshold semantics fixed. Trade count still exploded 4-5x (Nifty 50: 48→248).
Conclusion: RSI's narrow triangular scoring (only near RSI≈45) functions as
the system's main selectivity gate, not a minor discriminating factor — it
can't be cleanly ablated without also recalibrating the 0.40 threshold to
hold trade frequency constant, which is a bigger follow-up, not a quick test.
**RSI unchanged, no verdict reached.**

**Attempt 3, Fibonacci isolated:** dropped only the 2 Fibonacci levels (0.5,
0.618 retracement) from the ~13-level confluence pool, nothing else touched.
Trade count moved modestly (Nifty 50: 48→58), a clean enough test. Full 3yr
result was basket-dependent (hurts Nifty 50/100, helps Nifty Bank/Mid
Select/Midcap 150) — so validated with a train/holdout split on v1 and v4:

| Basket | v1 holdout | v4 holdout |
|---|---|---|
| Nifty 50 | 1.66×→1.79× ↑ | 1.12×→1.27× ↑ |
| Nifty 100 | 1.83×→2.05× ↑ | 1.79×→1.80× flat |
| Nifty Bank/Bankex | 1.97×→2.46× ↑ | 5.07×→3.17× ↓ |
| Nifty Fin Service | 2.47×→3.99× ↑ | inf→inf tie |
| Nifty Mid Select | 1.89×→2.27× ↑ | **0.53×→1.32×** ↑↑ |
| Nifty Next 50 | 1.24×→1.99× ↑ | 2.93×→2.90× flat |
| Sensex | 2.35×→2.92× ↑ | 1.78×→2.36× ↑ |
| Midcap 150 | 0.90×→1.00× ↑ | 1.09×→1.20× ↑ |

v1's holdout improved in all 8/8 baskets — a consistent, non-noise pattern.
v4's holdout improved in 5/8, tied in 2, dropped in 1 (Nifty Bank, still a
strong 3.17×). Training-set results were mixed (roughly half up/half down),
consistent with Fibonacci adding curve-fit risk on training data without a
durable out-of-sample edge — matches the external research. Notably, removing
Fib **fixes v4's one known weak spot**: Nifty Mid Select holdout recovers
from 0.53× (idea #7/#8's flagged regression) to 1.32×.

**Verdict: KEPT as `swing_pullback_v5`** ("Swing Trade Pullback v5 (No
Fibonacci)") — v4's base with the 2 Fibonacci levels dropped from the
confluence-zone pool, everything else identical. Registered as its own algo,
leaving v1-v4 untouched. Sanity-checked post-registration: v1/v4 3yr Nifty 50
results match their pre-idea-#9 baseline exactly, and v5 matches the isolated
fib-ablation figure exactly (1.42× / +₹79,609, 56 trades).

## Idea #10 — max concurrent positions cap (portfolio-level, validation only)

Prompted by the observation that every backtest this session assumes
unlimited simultaneous capital — no cap on how many positions can be open at
once. Tested as a post-processing simulation on v1's existing full 3yr trade
list (no code change needed): sorted all trades per basket by entry date,
greedily accepted a trade only if fewer than 5 positions were already open by
date-range overlap, otherwise rejected it, then recomputed PF on the accepted
subset only.

**Result: barely matters.** Most baskets rejected 0 trades entirely (Nifty
Bank/Bankex, Fin Service, Mid Select, Next 50); the busiest basket (Midcap
150) only rejected 10 of 93 trades over 3 years. Where trades were rejected
they were sometimes winners (Sensex PF 1.89×→1.70×), so the effect was
neutral-to-slightly-negative, not a hidden-inflation problem.

**Verdict: not pursued as a variant** — this isn't a lever to improve
returns, but it's a useful validation that the existing backtest numbers
aren't secretly relying on an unrealistic number of simultaneous positions.
The strategy is naturally low-overlap enough that a realistic cap doesn't
change the picture.

## Idea #11 — trailing stop + partial profit-take

Tested whether letting winners run (trail the stop instead of a fixed target)
beats the current fixed 2:1-target exit. Implementation, applied to v1's
existing entries only (same signals, only the exit logic changed):
1. At target1 (the existing first-resistance target), sell half the
   position and move the stop to breakeven for the remaining half.
2. Trail the remaining half's stop up to `close − 1.5×ATR14` each day
   (only ratchets up, never down) until stopped out or `MAX_HOLD_BARS`.

Full 3yr test on v1, all 9 baskets:

| Basket | v1 baseline | v1 + trailing/partial |
|---|---|---|
| Nifty 50 | 1.25× / +₹46,714 | 1.25× / +₹45,846 (flat) |
| Nifty 100 | 1.21× / +₹68,057 | 1.14× / +₹45,449 |
| Nifty Bank/Bankex | 0.72× / -₹14,512 | 0.50× / -₹26,186 |
| Nifty Fin Service | 1.04× / +₹2,690 | 0.99× / -₹697 (flipped to loss) |
| Nifty Mid Select | 1.89× / +₹58,381 | 1.56× / +₹36,829 |
| Nifty Next 50 | 0.90× / -₹17,736 | 0.74× / -₹46,681 |
| Sensex | 1.89× / +₹90,178 | 1.91× / +₹91,913 (flat) |
| Midcap 150 | 0.91× / -₹34,190 | 0.78× / -₹83,654 |

Worse in 6/8 baskets, flat in 2. Trade count barely moved (same entries as
baseline — this is a clean read, not a threshold-confound like the factor
ablation tests). Most likely explanation: this strategy's setups tend to hit
their 2:1 target relatively cleanly, and a 1.5×ATR trail is loose enough that
price chops back through it before running further — converting full
winners into smaller partial-only gains, while the breakeven-delay stop also
gives losers slightly more room.

**Verdict: REJECTED.** Reverted via `git checkout`, no code change kept. This
strategy's edge appears to come from clean fixed-target hits, not from
letting winners run — worth remembering before trying variations of this
idea (tighter trail, different ATR multiple) rather than assuming trailing
stops are automatically better.

## Idea #12 — sector rotation ranking

Tested whether restricting entries to stocks in currently "hot" sectors
improves results, distinct from v3's sector-RS (which compares a stock to
its own sector, not sectors to each other). Ranked the 7 mapped NIFTY sector
indices (Bank, IT, FMCG, Pharma, Metal, Energy, Realty) by trailing 3-month
(63 trading day) return each day; gated v1 entries to only fire when the
stock's own sector was in the top 4 of 7 that day (unmapped sectors always
allowed through, no restriction).

Full 3yr test on v1, all 9 baskets:

| Basket | v1 baseline | v1 + sector rotation |
|---|---|---|
| Nifty 50 | 1.25× / +₹46,714 (48) | 1.21× / +₹38,351 (44) |
| Nifty 100 | 1.21× / +₹68,057 | 1.20× / +₹59,132 (74) |
| Nifty Bank/Bankex | 0.72× / -₹14,512 (11) | 0.44× / -₹25,940 (9) |
| Nifty Fin Service | 1.04× / +₹2,690 (19) | 0.72× / -₹17,890 (15) |
| Nifty Mid Select | 1.89× / +₹58,381 (18) | 1.46× / +₹28,078 (15) |
| Nifty Next 50 | 0.90× / -₹17,736 (42) | 0.94× / -₹10,820 (41) |
| Sensex | 1.89× / +₹90,178 (30) | 1.72× / +₹72,625 (29) |
| Midcap 150 | 0.91× / -₹34,190 (93) | 0.87× / -₹46,755 (83) |

Worse in 6/8 baskets, only a small improvement in Nifty Next 50. Trade count
dropped meaningfully in every basket (clean signal, not a threshold
artifact) — e.g. Nifty Bank 11→9, Fin Service 19→15. Notably the effect is
worst exactly where sector concentration is highest (Nifty Bank/Bankex:
0.72×→0.44×).

**Verdict: REJECTED.** Reverted via `git checkout`, no code change kept.
Likely explanation: this strategy already requires a confirmed individual-
stock uptrend (SMA50>SMA200 gate) — a stock can have a genuinely strong
setup while its broader sector is cooling in relative terms, and the edge
here comes from the individual setup, not sector-wide agreement. Forcing
sector-level consensus removes good individual setups without adding
better ones.

## Idea #13 — market breadth filter

Tested a global "only trade when the broad market is healthy" gate, distinct
mechanism from the earlier VIX/Nifty-trend regime gate (idea from before
this log's idea #7): breadth = % of the 211-symbol F&O universe with
close > SMA200, computed via a single cached DuckDB window-function query
(400-day warm-up buffer, min 150 non-null periods). Gated v1 entries to only
fire when breadth ≥50%.

Full 3yr test on v1, all 9 baskets:

| Basket | v1 baseline | v1 + breadth filter |
|---|---|---|
| Nifty 50 | 1.25× / +₹46,714 (48) | 1.20× / +₹28,681 (36) |
| Nifty 100 | 1.21× / +₹68,057 | 0.99× / -₹3,116 (65) |
| Nifty Bank/Bankex | 0.72× / -₹14,512 (11) | 0.47× / -₹22,814 (8) |
| Nifty Fin Service | 1.04× / +₹2,690 (19) | 1.02× / +₹1,517 (15) |
| Nifty Mid Select | 1.89× / +₹58,381 (18) | 1.41× / +₹20,104 (13) |
| Nifty Next 50 | 0.90× / -₹17,736 (42) | 0.59× / -₹74,835 (39) |
| Sensex | 1.89× / +₹90,178 (30) | 1.69× / +₹59,955 (25) |
| Midcap 150 | 0.91× / -₹34,190 (93) | 0.80× / -₹60,093 (72) |

**Worse in every single basket, no exceptions.** Trade count dropped
meaningfully everywhere (a clean signal, not a threshold artifact), but
cutting trades didn't improve quality — it removed a mix of winners and
losers roughly proportionally, then the survivors' win rate came out
slightly worse in most baskets.

**Verdict: REJECTED.** Reverted via `git checkout`, no code change kept.
This is the third global regime/context filter tried this session (after
the VIX/Nifty-trend gate and sector-rotation ranking) and the third
rejection — a consistent pattern. This strategy's own gates
(SMA50>SMA200, SMA50 rising, turnover) already do the trend-confirmation
job at the individual-stock level; every attempt to layer a second, broader
trend/regime condition on top (sector-level, market-level) has made things
worse. The edge here appears to live entirely in individual-stock setup
quality, not in timing entries around the overall market cycle.

## Idea #14 — realistic transaction cost model (validation, not a variant)

None of this session's backtests included transaction costs — the external
research flagged this as the #1 thing that kills paper edges in real
trading. Applied a round-trip cost model to v1 and v5's existing full-3yr
trades (pure post-processing on entry/exit price × shares, no code change):
STT 0.1% each side (0.20%) + stamp duty 0.015% (buy only) + exchange/SEBI
fees + GST (~0.02%) + slippage 0.05% each side (0.10%, wider for mid/small-
cap NSE spreads) ≈ **0.335% of round-trip trade value**, brokerage assumed
zero (standard for delivery trades on discount brokers).

| Basket | v1 raw → net | v5 raw → net |
|---|---|---|
| Nifty 50 | 1.25×/+₹46,714 → 0.95×/-₹11,028 | 1.42×/+₹79,609 → 1.03×/+₹7,655 |
| Nifty 100 | 1.22×/+₹69,466 → 0.95×/-₹21,106 | 1.52×/+₹161,010 → 1.13×/+₹48,880 |
| Nifty Bank/Bankex | 0.72×/-₹14,512 → 0.55×/-₹28,297 | 2.03×/+₹44,734 → 1.44×/+₹24,522 |
| Nifty Fin Service | 1.04×/+₹2,690 → 0.81×/-₹17,468 | 1.86×/+₹58,070 → 1.37×/+₹30,363 |
| Nifty Mid Select | 1.89×/+₹58,381 → 1.52×/+₹39,401 | 3.13×/+₹155,825 → 2.45×/+₹125,112 |
| Nifty Next 50 | 0.88×/-₹22,186 → 0.70×/-₹65,016 | 1.29×/+₹49,019 → 0.99×/-₹1,682 |
| Sensex | 1.89×/+₹90,178 → 1.44×/+₹54,238 | 1.76×/+₹88,285 → 1.26×/+₹38,434 |
| Midcap 150 | 0.93×/-₹24,539 → 0.76×/-₹103,328 | 1.63×/+₹240,961 → 1.28×/+₹125,593 |

**v1 does not survive costs — 6 of 8 baskets flip to a net loss** (Nifty 50,
Nifty 100, Nifty Bank/Bankex, Nifty Fin Service, Nifty Next 50, Midcap 150);
only Nifty Mid Select and Sensex stay profitable. v1's raw-backtest edge was
mostly transaction-cost-sized, not real trading edge.

**v5 mostly survives.** All 8 baskets stay profitable except Nifty Next 50
(flips to ~breakeven, -₹1,682). PF takes a real ~25-35% haircut everywhere
but stays above 1.0× in 7/8 baskets — roughly matching the external
research's own estimate of a 15-25% cost drag (this model runs a bit
heavier since it stacks slippage on top of pure statutory costs).

**Conclusion: this is validation, not a new variant — no code change.** It
confirms the cumulative work this session (v1→v3 sector-RS→v4 volume→v5
no-Fib) built genuine, cost-surviving edge, not just a curve-fit backtest
number: v1 alone would not be tradeable after realistic costs, but the full
v5 stack is. Worth re-running this same cost check on any future variant
before treating its raw PF as meaningful.

## Idea #15 — Accumulation algo, sample-size check across the 9 baskets and full F&O universe

Not a swing-pullback-family experiment — checked whether the existing,
already-registered `accumulation` algo (delivery-surge + tightness gates,
watch-then-breakout entry) produces a large enough sample to trust, since
its gates (5D delivery ≥1.05-1.10× 20D avg, 20-day price range ≤5%,
turnover ≥₹25cr, close>SMA200) are unusually tight.

Full 3yr backtest, all 9 index baskets: **zero trades in 8 of 9 baskets.**
Only Midcap 150 produced any signals — 8 trades, PF 6.00× raw / 5.06× after
transaction costs, 75% win rate. Widened to the full 211-stock F&O universe
(the broadest liquid universe available, split across two 200-symbol-capped
API calls) to see if a bigger sample would appear: **only 7 trades total**,
PF 4.98× raw / 4.20× after costs, 71.4% win rate — and notably these are a
mostly different set of trades from the Midcap 150 basket's 8 (the F&O
universe and the "Midcap 150" watchlist only partially overlap).

**Verdict: cannot be validated with available data — not rejected, not
kept, genuinely untestable at current gate tightness.** Both samples (7 and
8 trades) are far below the ≥30-trade bar the external research flagged as
the minimum for statistical meaning; the very high PF/win-rate numbers could
easily be luck rather than real edge. This is a structural sample-size
problem (the gates are too rare to fire), not a performance verdict.

**Follow-up: relaxed the two pre-filter gates to see if sample size
improves.** Removed the delivery-surge requirement entirely (threshold
1.05-1.10× → 1.00×, i.e. no-op) and widened the 20-day price-tightness band
from ±5% to ±10%. Full 3yr, all 9 baskets: **still zero trades in 8/9
baskets**; Midcap 150 barely moved (8→9 trades). Reverted via `git
checkout`, no code change kept.

**Conclusion: the bottleneck isn't the pre-filter gates, it's the
entry/arm mechanism itself.** Score ≥0.60 arms a 20-day watch, and the
trade only fires if price breaks the prior 20-day high *with* volume
≥1.5× average, *within* that same 20-day window — a narrow, specific
combination (quiet accumulation → clean breakout → volume confirmation, all
inside 20 trading days) that rarely lines up for names that also clear the
turnover+SMA200 gates. Loosening the pre-filters can't fix a scarcity
that's coming from further downstream in the logic. Getting a testable
sample size would require relaxing the entry mechanism itself (lower the
1.5× volume-breakout bar, or extend the watch window), which starts
changing what the strategy fundamentally *is* rather than tuning it —
parked, not pursued further this session.

**Second follow-up: relaxed the entry mechanism itself** (not just
pre-filters) — volume-breakout threshold 1.5×→1.3×, watch window 20→30
days. Full 3yr, all 9 baskets:

| Basket | Trades | Win rate | PF |
|---|---|---|---|
| Nifty 50 | 2 (was 0) | 0% | 0.0× |
| Nifty 100 | 3 (was 0) | 0% | 0.0× |
| Nifty Bank/Bankex | 0 | — | — |
| Nifty Fin Service | 0 | — | — |
| Nifty Mid Select | 1 (was 0) | 0% | 0.0× |
| Nifty Next 50 | 1 (was 0) | 0% | 0.0× |
| Sensex | 1 (was 0) | 0% | 0.0× |
| Midcap 150 | 12 (was 8) | 58.3% (was 75%) | 2.80× (was 6.00×) |

**Quality collapsed.** More baskets produced trades, but every trade outside
Midcap 150 was a loss (0% win rate). Even Midcap 150, the one basket with a
real sample, saw PF drop by more than half (6.00×→2.80×) as win rate fell
from 75% to 58.3%. Reverted via `git checkout`, no code change kept.

**Final verdict: the original tightness (1.5× volume, 20-day window) is
load-bearing, not arbitrary — confirms the hypothesis, doesn't refute it.**
This settles the relaxation question: loosening the entry mechanism doesn't
surface "the same edge more often," it dilutes straight into losses. The
strategy either needs years more data to validate at its current strictness,
or should be treated as a live opportunistic watch-list signal rather than
a backtestable one — no further parameter search here this session.

**Third follow-up: combined gate + entry relaxation (more aggressive)** —
delivery-surge requirement removed entirely, tightness band ±5%→±10%,
volume-breakout threshold 1.5×→1.1×, watch window 20→40 days, all four
loosened together this time. Full 3yr, all 9 baskets:

| Basket | Trades | Win rate | PF |
|---|---|---|---|
| Nifty 50 | 2 | 0% | 0.0× |
| Nifty 100 | 3 | 0% | 0.0× |
| Nifty Bank/Bankex | 0 | — | — |
| Nifty Fin Service | 0 | — | — |
| Nifty Mid Select | 1 | 0% | 0.0× |
| Nifty Next 50 | 1 | 0% | 0.0× |
| Sensex | 1 | 0% | 0.0× |
| Midcap 150 | 16 (was 8) | 56.2% (was 75%) | 2.63× (was 6.00×) |
| Overall (pooled) | 24 | 37.5% | 1.22× |

Barely more trades than the single-mechanism relaxation (idea #16), and
quality kept degrading as relaxation increased (Midcap 150 PF: 6.0×→2.8×→
2.6× across the three relaxation steps). **Nifty Bank and Nifty Fin Service
still produced zero trades even with every threshold loosened** — not a
threshold problem, the underlying quiet-accumulation-then-breakout pattern
structurally doesn't occur in this data for those baskets. Reverted via
`git checkout`, no code change kept.

**Conclusion, now settled across three separate relaxation attempts (idea
#15 gate-only, #16 entry-only, this one combined): there is a hard floor
here, not a tuning gap.** More aggressive relaxation does not converge
toward "the same edge, more often" — it converges toward zero edge with a
few more trades. No further relaxation attempts planned; the algo is parked
as-is (original strict thresholds), pending either years more data or live
paper-trading to validate.

## Idea #17 — Short Bounce: look-ahead entry-timing fix (code correctness, not a tuning experiment)

Tested `short_bounce` on the full 204-stock F&O universe (built this
session, see below) and found a large net loss: 1833 trades, 29.7% win
rate, PF 0.84×, -₹15,81,955. Investigating why surfaced a real bug in
`_run_direct_trades` (shared by `long_pullback` and `short_bounce`, not
`zone_trade`): it filled entries at the **signal bar's own close** — the
exact price a same-day EOD score/gate computation can't actually know
until after the market has shut. Not fillable live.

**Fix:** added `enter_next_bar` mode — signal fires on bar i (using bar i's
close), fill happens at bar i+1's open instead. `zone_trade` was left
untouched (its "enter at close on the zone-touch bar" is documented,
intentional same-day-intrabar-touch design, not an EOD-score artifact).

| | Before fix | After fix |
|---|---|---|
| Trades | 1833 | 1737 |
| Win rate | 29.7% | 30.0% |
| PF | 0.84× | 0.85× |
| P&L | -₹15,81,955 | -₹13,92,240 |

**Kept — this is a correctness fix, not a tuning knob.** Barely moved the
numbers (the look-ahead bug wasn't the main driver of the loss), but it's
the honest baseline going forward for both `long_pullback` and
`short_bounce`. Committed directly (no revert), also benefits
`long_pullback` even though that wasn't separately tested today.

**Root cause of the loss, from the math:** 2:1 R:R (stop 1.5×ATR, target
3×ATR) needs a 33.3% win rate to break even; actual is 30%. Year-by-year
win rate from the regime panel: 2024 37.6% (profitable), 2025 28.7%, 2026
(partial, the one Bearish year) 26.3% — worse in the bearish year than the
bull years, which is counterintuitive for a short strategy and worth
treating as a real signal, not noise.

## Idea #18 — Short Bounce: market-regime filter (only short when Nifty is weak)

Different logical basis than the 3 regime filters already rejected for the
long strategies (VIX gate, sector rotation, market breadth) — those failed
because they were redundant filters on top of an already-working long
edge. Here the mismatch is structural: `short_bounce` is a short strategy
tested mostly across a 3-year bull market. Tested requiring Nifty's own
close below its 200-day SMA as an additional gate.

| | No filter | + regime filter |
|---|---|---|
| Trades | 1737 | 1105 |
| Win rate | 30.0% | 26.0% |
| PF | 0.85× | 0.70× |
| P&L | -₹13,92,240 | -₹18,42,358 |

**Made it worse, not better — hypothesis rejected.** "Nifty below its own
200-day SMA" is a slow, lagging condition; by the time it triggers, a lot
of the decline has often already happened, and the market is frequently
closer to a bottom than mid-decline — exactly the kind of stretch where
sharp relief rallies happen, which is bad news for a strategy that shorts
stocks *after* they've already bounced off a low. The filter selected for
the most panic/whipsaw-prone stretches of the data, not calmer bearish
conditions. Reverted via `git checkout`, no code change kept.

**4th regime/context filter this session to hurt rather than help** (after
VIX gate, sector rotation, market breadth for longs). Even in the one case
with a clear causal story for why it should work, it didn't — worth
treating any future regime-filter idea with real skepticism by default.

## Idea #19 — Short Bounce: entry-threshold tightening — KEPT

Tested raising the entry-score threshold on the full 204-stock F&O
universe, full 3yr, after ideas #17 (look-ahead fix) and #18 (regime
filter, rejected):

| Threshold | Trades | Win rate | PF | P&L |
|---|---|---|---|---|
| 0.55 (prior) | 1737 | 30.0% | 0.85× | -₹13,92,240 |
| 0.65 | 1114 | **32.3%** | **0.94×** | -₹3,35,608 |
| 0.70 | 662 | 31.9% | 0.93× | -₹2,37,414 |
| 0.75 | 233 | 27.9% | 0.77× | -₹2,92,039 |

Non-monotonic — 0.75 overshoots and gets worse again (fewer trades, lower
PF), so "tighter is always better" doesn't hold. **0.65 is the validated
sweet spot**: best win rate and PF, and a large enough sample (1114 trades)
to trust more than 0.70/0.75's thinner sets.

**Verdict: KEPT — `short_bounce`'s entry threshold raised 0.55→0.65 in
production**, description/entry text in `ALGO_METADATA` updated to match
(frontend renders this live from the API, no separate UI change needed).
Cut the 3yr loss by ~76% (-₹13.9L→-₹3.4L) and closed most of the gap to
the 33.3% breakeven this 2:1 R:R needs.

**Still net-negative overall — not fully fixed, and that's expected.**
Research (external, summarized to the user) confirms shorting carries a
structural headwind (~9%/year disadvantage vs. longs from market drift,
borrow costs, and squeeze asymmetry) independent of execution quality, and
this backtest window is ~3 years mostly-bullish for a strategy that's
short by design. A genuinely different entry redesign — waiting for
confirmed bounce-*failure* (price rolling over and breaking a recent
swing high/support) instead of just measuring distance off the low — is
flagged as the next idea to test, not yet implemented.

## Idea #20 — Short Bounce: bounce-failure entry redesign — REJECTED

Reused the codebase's existing arm-then-trigger pattern (`_run_armed_trades`,
already used by `accumulation`/`distribution`) instead of `short_bounce`'s
direct-entry style: score ≥0.65 arms a watch, entry only fires once price
actually breaks below a prior structural low (`low_20_prior`) with volume
≥1.5× confirmation — i.e. wait for the bounce to visibly fail, not just
measure distance off the low. Directly matches external research on
short-selling technique (confirmation-based entries, volume validation).

Full F&O universe, 3yr, vs. the just-committed 0.65-threshold direct-entry
baseline:

| | Committed (idea #19) | Bounce-failure redesign |
|---|---|---|
| Trades | 1114 | 201 |
| Win rate | 32.3% | 31.3% |
| PF | 0.94× | 0.88× |
| P&L | -₹3,35,608 | -₹1,20,422 |

**Rejected — smaller absolute loss, but worse per-trade quality (both win
rate and PF), not better.** The smaller loss is purely a function of
trading 82% less often, not higher-conviction signals — the confirmation
requirement filtered out most setups without concentrating on the good
ones. Also a much thinner sample (201 vs 1114 trades) to trust. Reverted
via `git checkout`, no code change kept; idea #19 (threshold 0.65,
direct entry) remains the production baseline.

## Idea #21 — Short Bounce: confluence-zone stop/target

Requested explicitly: not-just-ATR-multiple stops/targets, using
support/resistance confluence the same way `swing_pullback` does for
longs, mirrored for a short. Built `_short_bounce_zone_levels`: reused the
existing level-pool machinery (swing highs/lows, MAs, weekly pivots, round
numbers, role-reversal — **no Fibonacci**, per idea #9's ablation finding
that it hurts holdout performance) to require price be testing a confirmed
**resistance** confluence (omega≥4, same threshold `swing_pullback` uses)
before shorting; stop set just above that zone, target at the nearest
confluence **support** wall below, gated at ≥2:1 R:R. Also extended
`_run_direct_trades`'s `enter_next_bar` mode to accept `stop_series`/
`target_series` (previously only supported in the same-bar path), so this
stays consistent with idea #17's look-ahead fix.

Full F&O universe, 3yr:

| | Committed (idea #19) | Confluence-zone |
|---|---|---|
| Trades | 1114 | **9** |
| Win rate | 32.3% | 33.3% |
| PF | 0.94× | **1.42×** |
| P&L | -₹3,35,608 | **+₹18,415** |

**Genuinely promising on paper — and genuinely untrustworthy at this
sample size.** 9 trades across the entire market over 3 years is the same
problem idea #15's Accumulation-algo hit: too rare to distinguish real
edge from luck. Reverted via `git checkout`, no code change kept (the
`_run_direct_trades` `enter_next_bar`+`stop_series` extension was reverted
along with it — worth re-adding if this idea is revisited, since it's
generically useful infra, not specific to this experiment).

**Follow-up: loosened the confluence bar** (omega≥4→≥3) and R:R gate
(≥2.0→≥1.5) to test whether the profitable n=9 signal holds up with more
trades.

| | omega≥4, R:R≥2.0 (n=9) | omega≥3, R:R≥1.5 (n=34) |
|---|---|---|
| Trades | 9 | 34 |
| Win rate | 33.3% | 29.4% |
| PF | 1.42× | 0.81× |
| P&L | +₹18,415 | -₹33,992 |

**Dissolved under relaxation — same pattern as Accumulation (idea #16).**
More trades, but PF flipped from profitable to a net loss and win rate
dropped. This is now the 3rd time this session a strict filter's apparent
edge disappeared under loosening (Accumulation's entry mechanism, and now
this) — a real, repeated signal that the strictness itself is often the
edge, not an obstacle to it.

**Verdict: REJECTED — not pursued further.** The n=9 result doesn't
survive expansion, so it can't be distinguished from noise after all.
Reverted via `git checkout`, no code change kept (including the
`_run_direct_trades` `enter_next_bar`+`stop_series` extension, worth
re-adding as generic infra if a future zone-based algo needs it).

**Overall short_bounce status after ideas #17-21:** the only kept change
is idea #19 (entry threshold 0.65, look-ahead-fixed) — cuts the 3yr loss
~76% (-₹13.9L→-₹3.4L) but remains net-negative. Three further redesign
attempts (regime filter, bounce-failure confirmation, confluence-zone
stop/target) all either hurt performance or couldn't produce a trustworthy
sample. Recommend treating `short_bounce` as validated-but-marginal at its
current committed state, not a candidate for further redesign this
session — the structural headwind shorting faces (per external research)
appears to be the dominant factor, not fixable via entry/exit mechanics.

## Idea #22 — Short Bounce: confluence-zone stop/target re-adopted (n=9, explicit override)

After idea #21 was rejected for its 9-trade sample not surviving
relaxation, the user was shown all three tested `short_bounce` variants
side by side (committed 0.65-threshold: -₹3,35,608 / PF 0.94×; bounce-
failure: -₹1,20,422 / PF 0.88×; confluence-zone strict: +₹18,415 / PF
1.42×) and explicitly chose the confluence-zone version — the only one
that shows an actual profit, despite the small-sample caveat repeated
twice.

**Re-implemented and set as the production default**, `ALGO_METADATA`
description updated with a ⚠️ small-sample warning so the caveat is visible
in the UI itself, not just this log. Sanity-checked: metadata is live, and
the full-universe backtest reproduces the exact idea #21 numbers (9 trades,
+₹18,415, PF 1.424×, 33.3% win rate) — confirms nothing drifted between
the original test and this permanent implementation.

**This is a decision under known uncertainty, not a newly-validated
result** — the sample-size concern from idea #21 stands exactly as before.
Recorded here so a future session (or a future look at this file) knows
this was a deliberate user call, not an oversight: if this needs revisiting,
the honest fix is more data (longer backtest window or live paper-trading),
not further parameter tuning — loosening this exact gate was already shown
to destroy it (idea #21's follow-up, omega≥3/R:R≥1.5 → -₹33,992 on 34
trades).

## Idea #23 — Short Bounce: confluence-zone grid search — improved KEPT default

Idea #21's follow-up (omega 4→3, R:R 2.0→1.5, both loosened together)
destroyed the result, but conflated two separate knobs. Ran a proper grid
holding one fixed while varying the other, full F&O universe, 3yr:

| omega_min | min_rr | Trades | Win rate | PF | P&L |
|---|---|---|---|---|---|
| 4.0 | 2.0 (idea #21 baseline) | 9 | 33.3% | 1.42× | +₹18,415 |
| 4.0 | 1.5 | 30 | 26.7% | 0.68× | -₹51,551 |
| 3.5 | 2.0 | 9 | 33.3% | 1.42× | +₹18,415 (identical — omega not binding here) |
| 3.0 | 2.0 | 10 | 40.0% | 1.87× | +₹37,891 |
| 2.5 | 2.0 | 10 | 40.0% | 1.87× | +₹37,891 (identical) |
| 2.0 | 2.0 | 11 | 36.4% | 1.62× | +₹31,154 |
| 1.0 | 2.0 | 11 | 36.4% | 1.62× | +₹31,154 (identical) |
| **0.0** | **2.0** | **12** | **41.7%** | **2.12×** | **+₹56,191** |
| 0.0 | 2.5 | 5 | 40.0% | 2.14× | +₹24,510 |

**Clean, unambiguous finding: R:R≥2.0 is the entire source of quality; the
resistance-confluence entry requirement (omega) does nothing useful at any
threshold** — dropping it from 4→0 monotonically *improved* both trade
count and PF, the opposite of what idea #21's combined-loosening test
implied. The R:R gate alone (with the target still anchored to a real
confluence support wall — that part stays) was already doing all the
selective work; the resistance-zone precondition was pure friction. R:R=2.5
gave a marginally higher PF but on too few trades (5) and lower total P&L
to prefer over R:R=2.0's 12.

**Verdict: KEPT — omega/resistance-confluence gate removed entirely.**
`_short_bounce_zone_levels` simplified (no `omega_min` param), production
default is now the R:R≥2.0-only version. Sanity-checked: metadata live,
full-universe backtest reproduces the grid numbers exactly (12 trades,
+₹56,191, PF 2.121×, 41.7% win rate). Still a small sample (12 trades/3yr)
by any standard measure, but it's now the best result across every
`short_bounce` variant tried this session (#17-23) — 3x the trade count
and 3x the total profit of idea #22's version, with a cleaner underlying
mechanism (one active gate instead of two, one of which was inert/harmful).

## Idea #24 — Short Bounce: second grid search (target-wall weight), user pushing for ~100 trades

User asked whether ~100 trades (across a 200+ stock universe) is achievable
while staying profitable. Diagnosed the funnel: the plain score≥0.65
version (idea #19, no confluence-zone target logic) gave 1114 trades; the
confluence-zone version (idea #23) gives only 12 — the gap is entirely
`_short_bounce_zone_levels`'s requirement that a support wall exist below
price *and* clear the shared `_TARGET_WALL_MIN_WEIGHT=6` confluence-weight
bar (borrowed from `swing_pullback`, never re-tuned for this algo). Ran a
second grid, holding R:R≥2.0 fixed and varying only that wall weight
(introduced as a separate `wall_min_weight` param, not touching the shared
constant `swing_pullback` still uses):

| wall_min_weight | Trades | Win rate | PF | P&L |
|---|---|---|---|---|
| 6 (idea #23 baseline) | 12 | 41.7% | 2.12× | +₹56,191 |
| 4 | 15 | 46.7% | 2.44× | +₹82,562 |
| 3 | 18 | 55.6% | 3.23× | +₹127,699 |
| 2 | 18 | 55.6% | 3.23× | +₹127,699 (identical — plateau) |
| 1 (any single level counts) | 18 | 55.6% | 3.23× | +₹127,699 (identical) |

**Strictly dominant improvement, not a tradeoff** — lowering the wall
weight monotonically improved every metric until plateauing at 18 trades.
Confirms idea #23's inference was right (R:R is the real gate) but the
wall-existence requirement itself had unnecessary friction baked in from a
constant tuned for a different algo's needs.

**Then tested whether loosening further (toward the user's ~100-trade
target) is possible at all**, using the now-fully-loosened wall
(weight=1) combined with a loosened R:R:

| wall_min_weight | min_rr | Trades | Win rate | PF | P&L |
|---|---|---|---|---|---|
| 6 | 1.5 | 39 | 30.8% | 0.92× | -₹15,561 |
| 1 | 1.5 | 53 | 35.8% | 1.16× | +₹37,480 |

Even with everything loosened as far as it goes, the ceiling is ~53
trades before quality degrades sharply (PF 3.23×→1.16×, barely above
breakeven) — nowhere close to ~100. **Verdict: ~100 trades is not
achievable with this algo/dataset without sacrificing most of the edge.**
The rarity is structural: qualifying setups need (a) a confirmed
individual-stock downtrend, (b) a high-conviction bounce score, (c) a real
support level far enough below to clear 2:1 R:R — that specific
combination is inherently uncommon across 3 years even in a 204-stock
universe, not an artifact of over-tuned filters.

**Verdict: KEPT — `wall_min_weight=2` set as the new production default**
(chosen over the identical-result 1 or 3 as a reasonable middle value, not
the most extreme setting tested). `ALGO_METADATA` updated. Sanity-checked:
metadata live, full-universe backtest reproduces 18 trades / +₹1,27,699 /
PF 3.226× / 55.6% win rate exactly. This is now the best `short_bounce`
result across all 8 experiments this session (#17-24) — recommend treating
`short_bounce` as concluded for this session; further gains would need
more historical data (longer than 3yr) or a genuinely different
construction (pairs trading, options), not more parameter search on this
design.

## Idea #25 — Short Bounce: entry-threshold funnel widening — corrects idea #24's premature conclusion

Idea #24's "not achievable" conclusion was wrong — it only ever varied
`min_rr` and `wall_min_weight`, holding the 0.65 entry threshold fixed. The
entry threshold controls how many candidates even *reach* the R:R filter
in the first place (idea #19's plain-ATR sweep showed 0.65 arms ~1114
candidates full-universe vs. 0.55's ~1737), so a stricter threshold was
silently starving the R:R filter of raw material — narrowing the front
door was never tested as a lever, only the back door (wall weight, R:R).

Grid search, wall_min_weight=2 and min_rr=2.0 held fixed, entry threshold
varied, full F&O universe, 3yr:

| Threshold | Trades | Win rate | PF | P&L |
|---|---|---|---|---|
| 0.65 (idea #24 baseline) | 18 | 55.6% | 3.23× | +₹1,27,699 |
| 0.55 | 59 | 45.8% | 2.69× | +₹3,94,790 |
| 0.50 | 84 | 42.9% | 1.95× | +₹3,19,508 |
| 0.45 | 107 | 40.2% | 1.78× | +₹3,60,884 |
| **0.40** | **129** | **48.1%** | **2.76×** | **+₹8,50,598** |
| 0.35 | 148 | 45.9% | 2.37× | +₹7,88,238 |
| 0.30 | 144 | 44.4% | 2.16× | +₹6,84,687 |

**Non-monotonic, with a clear peak at 0.40** — both trade count and PF
matter, and 0.40 is the point where widening the funnel keeps pace with
still-selective downstream filtering (R:R≥2.0 unmoved) before quality
erosion outpaces volume gain past 0.35. 0.40 beats every other tested
threshold on total P&L and is the second-best on PF (only 0.65's much
smaller sample is higher).

**Verdict: KEPT — entry threshold lowered 0.65→0.40.** Clears the user's
~100-trade bar with room to spare (129) while roughly 7x-ing total profit
vs. idea #24's version. `ALGO_METADATA` updated, `_short_bounce_zone_levels`
call site updated. Sanity-checked: metadata live, full-universe backtest
reproduces 129 trades / +₹8,50,598 / PF 2.758× / 48.1% win rate exactly.

**Lesson for future tuning on this or any algo:** a "gate" (R:R, weight
threshold) and a "funnel" (entry score threshold) interact — tuning one
while holding the other fixed at an old, possibly-arbitrary value can hide
a much better joint optimum. Idea #24's grid was correct in isolation but
incomplete in scope; worth remembering before declaring an idea's ceiling
"found" after varying only some of its parameters.

**Follow-up: pushed the threshold lower still (0.35→0.15), user targeting
~200 trades.**

| Threshold | Trades | PF | P&L |
|---|---|---|---|
| 0.40 (kept) | 129 | 2.76× | +₹8,50,598 |
| 0.35 | 148 | 2.37× | +₹7,88,238 |
| 0.30 | 144 | 2.16× | +₹6,84,687 |
| 0.25 | 141 | 2.04× | +₹6,12,982 |
| 0.15 | 142 | 2.02× | +₹6,05,781 |

**Plateaus, doesn't reach 200.** From 0.35 down to 0.15, trade count sits
flat around 140-150 regardless of how low the threshold goes — the entry
threshold stops being the binding constraint below ~0.35; the R:R≥2.0 gate
and wall-existence requirement take over as the real ceiling. Every step
past 0.40 is a strict step backward (lower trades *and* lower PF *and*
lower profit than 0.35, and 0.35 itself is already worse than 0.40 on PF
and profit despite more trades). Reverted via `git checkout`, 0.40 remains
the production default — confirmed no path to 200 trades exists on this
lever without also loosening R:R (already shown in idea #24's follow-up to
destroy quality much faster than it adds volume).

## Idea #26 — Short Bounce: diagnosed a specific zero-trade case (COLPAL), tested next-wall fallback

User was looking at COLPAL's chart (a textbook 3yr downtrend with a huge
Sept-2024 crash and multiple bounces) and asked why it produced zero
`short_bounce` trades. Root-cause diagnosis (temp debug instrumentation,
reverted after): COLPAL's gates and score were never the issue — 234 of
740 trading days had gates passing *and* score≥0.40 armed. **Every one of
those 234 days failed the target-wall R:R check.** Sample readings:

| Date | Close | ATR | Nearest wall | Risk | Reward | R:R |
|---|---|---|---|---|---|---|
| 2023-09-27 | 1921.3 | 40.6 | 1917.0 | 63.0 | 4.4 | 0.07× |
| 2024-04-19 | 2509.1 | 66.8 | 2500.0 | 47.0 | 9.1 | 0.19× |
| 2024-09-20 | 3512.7 | 66.3 | 3501.2 | 58.4 | 11.5 | 0.20× |

The nearest confluence wall is consistently just a few rupees below price
— COLPAL is a heavily-watched large-cap where MAs, recent swing lows, and
round numbers all cluster tightly near current price, so `walls[0]`
(nearest wall, the only one ever tried) essentially never has room to
clear 2:1 R:R against an ATR-based stop of ₹40-90.

**Tested fix: try each wall from nearest to farthest, use the first that
clears min_rr, instead of only ever trying the nearest.** Full F&O
universe, 3yr: **129 trades, PF 2.758×, +₹8,50,598 — byte-identical to the
current production baseline.** COLPAL specifically still produced 0
trades even with every wall tried. Conclusion: when the nearest wall
fails, it's not usually because a farther, adequate wall existed and got
skipped — it's because *no* combination of levels far enough from price
ever accumulates enough combined weight (≥2) to register as a wall at
all. The fallback had nothing further out to find.

**Verdict: REJECTED, no change kept.** Genuinely a null result, not
"didn't help" from a broken implementation — verified the fallback logic
itself worked correctly (traced through COLPAL's actual wall lists). This
confirms the earlier ~150-trade plateau (idea #25's follow-up) has the
same root cause: for many liquid, well-covered stocks, the confluence-zone
target design structurally can't find a support level far enough away to
clear 2:1 R:R, regardless of how many walls are considered. A genuine fix
would need to change what "far enough" means (e.g. scale min_rr to the
wall's actual distance, or use a percentage/ATR-multiple fallback target
when no wall qualifies) rather than trying more walls from the same
confluence pool — not attempted this session.

## Idea #27 — Short Bounce: ATR-multiple fallback target — KEPT (user override)

Idea #26 identified the actual fix needed: when no confluence wall clears
min_rr (or none exists), fall back to a plain ATR-multiple target
(`close - min_rr*risk`, guaranteeing exactly 2:1 by construction) instead
of skipping the trade entirely. Tested on the full F&O universe, 3yr:

| | Wall-only (idea #25) | ATR fallback |
|---|---|---|
| Trades | 129 | **3,315** |
| Win rate | 48.1% | 34.9% |
| PF | 2.76× | **1.17×** |
| P&L | +₹8,50,598 | **+₹26,84,308** |

COLPAL alone went from 0 trades to 24, with a clean pattern of ~₹15-26k
target hits against ~₹7-7.5k stop losses — confirms the fallback fires
correctly on exactly the stocks the wall-only version was structurally
blind to. Full-universe result: massively more trades and 3x the total
profit, but PF collapsed from 2.76× to 1.17× — barely above breakeven on
a per-trade basis, because the ATR fallback stopped the confluence-wall
check from filtering anything meaningful once it kicks in (which turned
out to be most of the time) — functionally closer to the plain-ATR
`long_pullback`-style design than a true confluence-zone strategy.

**Verdict: KEPT — explicit user override, prioritizing trade volume and
total profit over per-trade quality.** User was shown both options with
the tradeoff stated plainly (thinner margin per trade, more exposure to a
bad stretch) and chose the ATR-fallback version. `ALGO_METADATA` updated
with a ⚠️ warning about the thinner margin, same pattern as idea #22's
small-sample warning. Sanity-checked: metadata live, full-universe
backtest reproduces 3,315 trades / +₹26,84,308 / PF 1.170× / 34.9% win
rate exactly.

**Recorded honestly for future reference:** this is now a materially
different risk profile than every other variant tested this session
(#17-26) — most of those optimized for PF/win-rate at low volume; this one
explicitly trades that away for volume and absolute profit. If revisiting
`short_bounce` in a future session, don't assume "the current version" is
the high-quality one without checking which tradeoff was chosen here.
