# Swing Trade Pullback — tuning experiment log

Every parameter experiment on the Swing Trade Pullback algo gets one row here
**before** deciding keep/revert — including negative results. A "control basket"
(a group the change should *not* affect) is checked alongside the target every
time, since a scoped change that leaks into other symbols is a bug, not a result.

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
