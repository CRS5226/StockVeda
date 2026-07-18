# StockVeda

Self-hosted Indian stock market research platform — screening, charting, fundamentals, backtesting (rule-based, options, and ML), F&O analytics, and macro data in one tool.

Built with FastAPI + DuckDB on the backend and React + lightweight-charts on the frontend. All data is fetched from free public sources (NSE bhavcopy, yfinance, FRED, RBI) and stored locally in a single DuckDB file — no subscriptions, no external databases.

---

## Features

**Stock Detail**
- Candlestick chart with 15+ technical overlays (SMA, EMA, Bollinger Bands) and oscillators (RSI, MACD, Stochastic, Williams %R, CCI, ADX)
- Key metrics — P/E, P/B, ROE, ROA, EPS, dividend yield, beta, revenue growth
- P&L / Balance Sheet / Cash Flow (quarterly + annual)
- Delivery %, promoter / FII / DII / MF shareholding trend
- Corporate actions (dividends, splits, bonuses) and insider trades
- Analyst consensus — recommendation breakdown + price target gauge
- Sector comparison chart (stock % return vs sector index)
- Recent news via Google RSS
- **Candle pattern detection** — 13 TA-Lib patterns (Morning Star, Engulfing, Hammer, Marubozu, etc.) with 1/2/3-bar labels, filtered to last 10 trading days
- **Trend Outlook** — indicator confluence score (RSI + MACD + SMA20/50 + Volume + patterns, –8 to +8) with historical pattern win-rate stats from the stock's own data
- **Computed beta** — rolling beta sparkline calculated from own OHLCV, not third-party

**Screener**
- 69+ indicators across price, volume, fundamentals, delivery, and technicals
- Custom filter conditions with AND logic
- 6 strategy presets — Breakout, Buy the Dip, **Pullback (Golden Zone)**, Volume Accumulation, Mean Reversal, Quality & Value — each with per-filter rationale
- Save / load custom screens and named watchlists
- Historical data fetch: 30 / 90 / 180 days, 1 / 2 / 3 years
- Auto-runs on data sync

**Backtest — 7 modes**

| Mode | What it does |
|------|--------------|
| **Multi-Stock** | 1 strategy tested across N stocks |
| **Multi-Algo** | N strategies overlaid on 1 stock with colored trade markers |
| **Matrix** | M algos × N stocks, heatmap + ranked table (SSE streamed) |
| **Options** | Straddle / strangle and spreads (bull call, bear put, iron condor) |
| **ORB** | Opening-range breakout on intraday bars, per-trade candle charts |
| **Grid Search** | Sweep indicator thresholds *and* periods; train/test split with overfit-gap column and a 2-D heatmap |
| **ML Models** | Triple-barrier meta-labeling — logistic regression, decision tree, random forest, SVM, XGBoost |

- 11 preset strategies (Trend Momentum, Golden Zone Buy, Mean Reversion, EMA Ribbon, ADX Trend, Pin Bar, Engulfing Reversal, MACD Cross, Golden Cross, …) + custom condition builder
- Target % / stop-loss % / max-hold exits, cash or continuous-futures price series, daily or weekly timeframe
- Per-algo comparison — P&L, win rate, profit factor, expectancy, outcome probability bars
- Trade log with entry / exit / reason breakdown, plus recent candle patterns + trend outlook per result

**Grid Search** (hyperparameter sweep)
- Sweep indicator **thresholds** (e.g. RSI 25/30/35/40) and **periods** (e.g. SMA-50 → 20/50/100), up to 4 dimensions × 10 values, capped at 500 combinations and 50 symbols
- Every combination evaluated on a chronological **train** split, then validated on a held-out **test** split
- Ranked leaderboard with a **win-rate gap** column (amber/red) flagging overfit combinations
- **2-D heatmap** view (Test/Train PnL and win-rate) — a contiguous green block indicates robust parameters, an isolated green cell indicates overfitting

**ML Models** (classification / meta-labeling)
- Base strategy selects *candidate* entries; a **triple-barrier** rule labels each one (does close hit +target% before −stop% within N bars?)
- Models: Logistic Regression, Decision Tree, Random Forest, SVM (RBF), XGBoost — trained on 21 symbol-agnostic features (oscillators, % distances from MAs, ATR%, returns, candle flags)
- Chronological split with **no shuffle**; train samples whose label window would reach into the test period are **purged** to prevent leakage
- Reports train **and** test accuracy / precision / recall / F1 / AUC with a gap column, confusion matrices for both splits, feature importance, and the train/test date windows
- Trades simulated on the test period where P(win) ≥ threshold, compared against a **Baseline (no ML)** row so you can see whether the filter actually adds value

**F&O**
- Option chain with ATM strike, PCR (OI), max pain, OI concentration
- ATM implied volatility (Black-Scholes / Newton-Raphson) + IV rank, ATM delta snapshot
- Futures basis, cost of carry, rollover %
- Continuous roll-adjusted near-month futures series usable as a backtest price source

**Analysis**
- **Markov Chain** — walk-forward state transition matrix + forward projection (computed causally, safe as a backtest signal)
- **Monte Carlo** — GBM price-path simulation with percentile fan chart
- **Index Fund** — index replication with computed-proxy weights and tracking error

**Macro Dashboard**
- Nifty 50, Bank Nifty, and sector indices (IT, FMCG, Pharma, Metal, Energy, Realty)
- FII / DII daily buy/sell/net flows
- USD/INR, EUR/INR, GBP/INR
- Indian macro — CPI, WPI, GDP, G-Sec yields, repo rate
- US macro — Fed funds rate, 10Y/2Y yield curve, PCE inflation

**Data Sync**
- One-click sync from the app's Sync panel (top right)
- NSE bhavcopy — daily OHLCV + delivery for all NSE equity
- Intraday bars (1m/5m/15m/30m/60m) for ORB backtests
- yfinance fallback for any symbol not yet in DB — auto-fetched and cached on first page visit
- Background sync via pm2 scheduler

---

## Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3.11+, FastAPI, DuckDB, pandas, pandas-ta, TA-Lib 0.6.8, scikit-learn, XGBoost, yfinance |
| Frontend | React 19, Vite, Tailwind CSS v4, lightweight-charts (TradingView), Zustand, React Router v7, lucide-react |
| Database | DuckDB (single file, zero-config) |
| Process manager | pm2 |
| Package manager | uv (backend), npm (frontend) |

---

## Prerequisites

- Python 3.11+
- Node.js 18+
- [uv](https://github.com/astral-sh/uv) — `pip install uv` or `curl -LsSf https://astral.sh/uv/install.sh | sh`
- TA-Lib system library (for candle pattern detection)

---

## Local Setup

```bash
git clone https://github.com/CRS5226/StockVeda.git
cd StockVeda
```

### Backend

```bash
uv sync

# TA-Lib wheel (prebuilt, no C compilation needed)
pip install ta-lib --break-system-packages

uv run uvicorn backend.main:app --host 0.0.0.0 --port 8007 --reload
```

API available at `http://localhost:8007`. Swagger docs at `http://localhost:8007/docs`.

> scikit-learn and XGBoost (used by the ML Models backtest mode) are declared in `pyproject.toml` and installed by `uv sync`. If you run the API with a system Python instead of the uv environment, install them there too:
> `python3 -m pip install "scikit-learn>=1.5" "xgboost>=2.1"`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

App available at `http://localhost:5173`. The Vite dev server proxies `/api/*` to port 8007 automatically.

For a production build (served by nginx from `frontend/dist`):

```bash
npm run build
```

---

## Initial Data Sync

The database is empty on first run. Open any stock's detail page — fundamentals, shareholding, and price history are fetched from yfinance automatically and cached locally.

For bulk OHLCV + delivery data, use the Sync panel in the app or:

```bash
# Seed ~2000 NSE stock symbols
uv run python -m backend.data_sync.seed_symbols

# NSE equity OHLCV + delivery
curl -X POST http://localhost:8007/api/sync/trigger/bhavcopy

# Indices, FII/DII, currency, macro
curl -X POST http://localhost:8007/api/sync/trigger/indices
curl -X POST http://localhost:8007/api/sync/trigger/fii_dii
curl -X POST http://localhost:8007/api/sync/trigger/currency
```

Backtests need enough history: the Screener's "Fetch Data" step (up to 3 years) is the easiest way to populate a watchlist before running Grid Search or ML modes.

---

## Data Sources

| Data | Source |
|------|--------|
| Daily OHLCV + delivery | NSE bhavcopy archive (nsearchives.nseindia.com) |
| Fundamentals, ratios, news, price history | yfinance |
| Sector / index OHLCV | yfinance (^NSEI, ^CNXIT, etc.) |
| Intraday bars | yfinance |
| FII/DII flows | NSE bhavcopy |
| Currency pairs | yfinance |
| Indian macro (CPI, GDP, G-Sec yields) | FRED API |
| US macro (Fed rate, yield curve) | FRED API |
| NSE live APIs (shareholding history, announcements) | nseindia.com/api — **requires Indian residential IP** |

> **On a VPS / cloud server**: NSE live APIs return 403 (blocked by Akamai CDN). All other sources work fine from any IP.

---

## API Reference

Base URL: `http://localhost:8007/api`

**Stock**

| Endpoint | Description |
|----------|-------------|
| `GET /stock/candles/{symbol}` | OHLCV + indicators, yfinance fallback + DB cache |
| `GET /stock/ratios/{symbol}` | Live P/E, ROE, analyst consensus, earnings date |
| `GET /stock/fundamentals/{symbol}` | P&L, balance sheet, cash flow |
| `GET /stock/sector-compare/{symbol}` | % return vs sector index |
| `GET /stock/delivery/{symbol}` | NSE delivery % |
| `GET /stock/shareholding/{symbol}` | Promoter / FII / DII / MF breakdown |
| `GET /stock/news/{symbol}` | Recent news from Google RSS |
| `GET /v1/candle-patterns/{symbol}` | TA-Lib pattern hits (13 patterns, significance filtered) |
| `GET /v1/outlook/{symbol}` | Trend outlook score + historical pattern win-rates |

**Screener**

| Endpoint | Description |
|----------|-------------|
| `POST /screener/run` | Run custom stock screen |
| `GET /screener/presets` | Index universe presets (Nifty 50 / 100) |
| `POST /screener/sync` | Start a background data sync job |
| `GET /screener/watchlists` · `POST /screener/watchlists` | Manage watchlists |

**Backtest**

| Endpoint | Description |
|----------|-------------|
| `GET /backtest/indicators` · `/entry-conditions` · `/strategies` | Builder metadata |
| `POST /backtest/run-v2` | Multi-stock condition backtest |
| `POST /backtest/run-matrix` · `/run-matrix-stream` | M algos × N stocks (SSE) |
| `POST /backtest/run-straddle` · `/run-spread` | Options strategies |
| `POST /backtest/run-orb` | Opening-range breakout |
| `GET /backtest/grid-sweepables` | Sweepable period columns + caps |
| `POST /backtest/run-grid-search` | Hyperparameter sweep, train/test split (SSE) |
| `GET /backtest/ml-models` | Available ML models + install status |
| `POST /backtest/run-ml-stream` | Train/evaluate ML entry filter (SSE) |

**F&O / Analysis / Macro**

| Endpoint | Description |
|----------|-------------|
| `GET /fno/option-chain/{symbol}` | Chain + PCR, max pain, ATM IV, delta |
| `GET /fno/futures/{symbol}` | Futures OHLCV / basis / rollover |
| `POST /intraday/fetch` | Fetch intraday bars (job) |
| `GET /v1/markov/{symbol}` · `/monte-carlo/{symbol}` | Markov + Monte Carlo analysis |
| `POST /index-fund/replicate` | Index replication + tracking error |
| `GET /macro/dashboard` | Market snapshot |
| `POST /sync/trigger/{source}` | Trigger a data sync |
| `GET /sync/status` | Sync log for all sources |

Full interactive docs: `http://localhost:8007/docs`

---

## Disclaimer

For educational and research purposes only. Nothing here is investment advice. Backtested and simulated results do not guarantee future performance — in particular, ML model outputs and optimized grid-search parameters are prone to overfitting, which is exactly why the train/test split, overfit-gap column, and confusion matrices are surfaced in the UI. Consult a SEBI-registered advisor before investing.
