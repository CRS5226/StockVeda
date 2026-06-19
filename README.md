# StockVeda

Self-hosted Indian stock market research platform — screening, charting, fundamentals, backtesting, and macro data in one tool.

Built with FastAPI + DuckDB on the backend and React + lightweight-charts on the frontend. All data is fetched from free public sources (NSE bhavcopy, yfinance, FRED, RBI) and stored locally in a DuckDB file.

---

## Features

- **Stock detail page** — candlestick chart, 15+ technical indicators, key metrics, P&L / Balance Sheet / Cash Flow, delivery %, shareholding, corporate actions, news, analyst consensus, sector comparison chart, institutional holders
- **Screener** — build custom filter conditions (P/E, debt, promoter %, delivery %, etc.) or use built-in presets
- **Backtest** — test technical strategies (Golden Cross, RSI, MACD, Bollinger Bands) on any stock with equity curve and trade-by-trade breakdown
- **Macro dashboard** — Nifty 50 / Bank Nifty / sector indices, FII/DII flows, USD/INR, CPI, G-Sec yields
- **Data sync** — one-click sync for NSE bhavcopy (OHLCV + delivery), fundamentals, shareholding, corporate actions, FII/DII, indices, currency, macro

---

## Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3.11+, FastAPI, DuckDB, pandas, pandas-ta, yfinance, httpx |
| Frontend | React 19, Vite, Tailwind CSS v4, lightweight-charts, Zustand, React Router v7 |
| Database | DuckDB (single file, no server needed) |
| Package manager | [uv](https://github.com/astral-sh/uv) (backend), npm (frontend) |

---

## Prerequisites

- Python 3.11+
- Node.js 18+
- [uv](https://github.com/astral-sh/uv) — `pip install uv` or `curl -LsSf https://astral.sh/uv/install.sh | sh`

---

## Local Setup

```bash
git clone https://github.com/CRS5226/StockVeda.git
cd StockVeda
```

### 1. Backend

```bash
# Install dependencies
uv sync

# Start the API server (port 8007)
uv run uvicorn backend.main:app --host 0.0.0.0 --port 8007 --reload
```

The API will be available at `http://localhost:8007`. Swagger docs at `http://localhost:8007/docs`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

The app will be available at `http://localhost:5173`.

> The Vite dev server proxies `/api/*` to `http://localhost:8007/api/*` automatically — no extra config needed.

---

## Initial Data Sync

On first run the database is empty. Use the **Sync** panel in the app (top right) or trigger syncs directly via the API:

```bash
# Seed NSE stock symbols (~2000 stocks)
uv run python -m backend.data_sync.seed_symbols

# Last 90 days of NSE equity OHLCV + delivery data
curl -X POST http://localhost:8007/api/sync/trigger/nse_bhavcopy_equity

# Indices (Nifty 50, Bank Nifty, sector indices)
curl -X POST http://localhost:8007/api/sync/trigger/indices

# FII/DII flows
curl -X POST http://localhost:8007/api/sync/trigger/fii_dii

# Currency (USD/INR, EUR/INR, GBP/INR)
curl -X POST http://localhost:8007/api/sync/trigger/currency
```

Stock fundamentals, shareholding, and corporate actions are fetched automatically from yfinance when you first open any stock's detail page.

---

## Data Sources

| Data | Source | Notes |
|------|--------|-------|
| Daily OHLCV + delivery | NSE bhavcopy (nsearchives.nseindia.com) | Works from any IP |
| Fundamentals, ratios, news | yfinance | Works from any IP |
| Sector/index OHLCV | yfinance (^NSEI, ^CNXIT, etc.) | Works from any IP |
| FII/DII flows | NSE bhavcopy archive | Works from any IP |
| Currency pairs | yfinance | Works from any IP |
| Indian macro (CPI, GDP, yields) | FRED API | Works from any IP |
| US macro (Fed rate, yield curve) | FRED API | Works from any IP |
| NSE live APIs (shareholding history, announcements) | nseindia.com/api/* | **Requires Indian residential IP** — blocked on cloud servers by Akamai CDN |

> **Running locally** (home laptop / Indian ISP): all data sources including NSE live APIs work without any extra configuration.
>
> **Running on a VPS/cloud server**: NSE live APIs return 403. All other sources (yfinance, bhavcopy archives, FRED) work fine.

---

## Project Structure

```
StockVeda/
├── backend/
│   ├── main.py              # FastAPI app, route registration
│   ├── core/
│   │   └── indicators.py    # pandas-ta indicator calculations
│   ├── db/
│   │   ├── connection.py    # DuckDB connection (thread-local)
│   │   └── schema.sql       # Table definitions
│   ├── data_sync/           # One file per data source
│   │   ├── sync_bhavcopy.py
│   │   ├── sync_fundamentals.py
│   │   ├── sync_indices.py
│   │   └── ...
│   └── routes/
│       ├── stock.py         # /stock/* endpoints
│       ├── screener.py      # /screener/* endpoints
│       ├── backtest.py      # /backtest/* endpoints
│       └── macro.py         # /macro/* endpoints
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── StockDetail.tsx
│       │   ├── Screener.tsx
│       │   ├── Backtest.tsx
│       │   └── MacroDashboard.tsx
│       ├── components/
│       │   ├── CandleChart.tsx
│       │   ├── MacroLineChart.tsx
│       │   └── BacktestResults.tsx
│       ├── store/           # Zustand stores
│       └── lib/api.ts       # Typed API client
└── data/
    └── stockveda.duckdb     # Local database (not committed)
```

---

## API Reference

Base URL: `http://localhost:8007/api`

| Endpoint | Description |
|----------|-------------|
| `GET /stock/candles/{symbol}?indicators=true` | OHLCV + 15 technical indicators |
| `GET /stock/ratios/{symbol}` | Live P/E, P/B, ROE, analyst consensus, earnings date |
| `GET /stock/fundamentals/{symbol}?period_type=Q` | P&L, balance sheet, cash flow (quarterly/annual) |
| `GET /stock/sector-compare/{symbol}?days=252` | Stock % return vs sector index |
| `GET /stock/news/{symbol}` | Recent news from Google RSS |
| `GET /stock/holders/{symbol}` | Top institutional holders |
| `GET /stock/delivery/{symbol}` | NSE delivery % from bhavcopy |
| `GET /stock/shareholding/{symbol}` | Promoter / FII / DII / MF breakdown |
| `GET /stock/corporate-actions/{symbol}` | Dividends, splits, bonuses |
| `POST /screener/run` | Run custom stock screen |
| `POST /backtest/run` | Run strategy backtest |
| `GET /macro/dashboard` | Market snapshot (indices, FII/DII, USD/INR) |
| `GET /macro/indices` | Historical index OHLCV |
| `GET /macro/fii-dii` | FII/DII buy/sell/net flows |
| `POST /sync/trigger/{source}` | Trigger a data sync |
| `GET /sync/status` | Sync status for all sources |

Full interactive docs: `http://localhost:8007/docs`
