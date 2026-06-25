# StockVeda

Self-hosted Indian stock market research platform — screening, charting, fundamentals, backtesting, candle pattern detection, and macro data in one tool.

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

**Screener**
- 69 indicators across price, volume, fundamentals, delivery, and technicals
- Custom filter conditions with AND logic
- Built-in presets (value stocks, high delivery, momentum, etc.)
- Save and load custom screens
- Auto-runs on data sync

**Backtest (Multi-Stock + Multi-Algo)**
- Multi-Stock mode: 1 strategy tested across N stocks simultaneously
- Multi-Algo mode: N strategies overlaid on 1 stock with colored trade markers
- 5 preset strategies (Golden Cross, RSI Midline Surge, EMA Ribbon, MACD Momentum, Bollinger Breakout) + custom algo builder
- Per-algo comparison panel — P&L, win rate, profit factor, expectancy, outcome probability bars
- Trade log per algo with entry / exit / reason breakdown
- Right-hand sidebar per result: recent candle patterns + trend outlook

**Macro Dashboard**
- Nifty 50, Bank Nifty, and sector indices (IT, FMCG, Pharma, Metal, Energy, Realty)
- FII / DII daily buy/sell/net flows
- USD/INR, EUR/INR, GBP/INR
- Indian macro — CPI, WPI, GDP, G-Sec yields, repo rate
- US macro — Fed funds rate, 10Y/2Y yield curve, PCE inflation

**Data Sync**
- One-click sync from the app's Sync panel (top right)
- NSE bhavcopy — daily OHLCV + delivery for all NSE equity (last 90 days, ~130 CSV files)
- yfinance fallback for any symbol not yet in DB — auto-fetched and cached on first page visit
- Background sync via pm2 scheduler

---

## Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3.11+, FastAPI, DuckDB, pandas, pandas-ta, TA-Lib 0.6.8, yfinance |
| Frontend | React 19, Vite, Tailwind CSS v4, lightweight-charts (TradingView), Zustand, React Router v7 |
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

### Frontend

```bash
cd frontend
npm install
npm run dev
```

App available at `http://localhost:5173`. The Vite dev server proxies `/api/*` to port 8007 automatically.

---

## Initial Data Sync

The database is empty on first run. Open any stock's detail page — fundamentals, shareholding, and price history are fetched from yfinance automatically and cached locally.

For bulk OHLCV + delivery data, use the Sync panel in the app or:

```bash
# Seed ~2000 NSE stock symbols
uv run python -m backend.data_sync.seed_symbols

# NSE equity OHLCV + delivery (last 90 days)
curl -X POST http://localhost:8007/api/sync/trigger/bhavcopy

# Indices, FII/DII, currency, macro
curl -X POST http://localhost:8007/api/sync/trigger/indices
curl -X POST http://localhost:8007/api/sync/trigger/fii_dii
curl -X POST http://localhost:8007/api/sync/trigger/currency
```

---

## Data Sources

| Data | Source |
|------|--------|
| Daily OHLCV + delivery | NSE bhavcopy archive (nsearchives.nseindia.com) |
| Fundamentals, ratios, news, price history | yfinance |
| Sector / index OHLCV | yfinance (^NSEI, ^CNXIT, etc.) |
| FII/DII flows | NSE bhavcopy |
| Currency pairs | yfinance |
| Indian macro (CPI, GDP, G-Sec yields) | FRED API |
| US macro (Fed rate, yield curve) | FRED API |
| NSE live APIs (shareholding history, announcements) | nseindia.com/api — **requires Indian residential IP** |

> **On a VPS / cloud server**: NSE live APIs return 403 (blocked by Akamai CDN). All other sources work fine from any IP.

---

## API Reference

Base URL: `http://localhost:8007/api`

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
| `POST /screener/run` | Run custom stock screen |
| `POST /backtest/run` | Run strategy backtest (multi-stock or multi-algo) |
| `GET /macro/dashboard` | Market snapshot |
| `POST /sync/trigger/{source}` | Trigger a data sync |
| `GET /sync/status` | Sync log for all sources |

Full interactive docs: `http://localhost:8007/docs`
