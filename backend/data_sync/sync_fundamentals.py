"""
Quarterly + annual fundamentals for NSE-listed stocks via Yahoo Finance (yfinance).
Ticker format: {NSE_SYMBOL}.NS  e.g. RELIANCE.NS
Tables: stock_fundamentals
Note: yfinance is rate-limited — run off-peak or batch in small chunks.
      Values are in INR (full rupees, not crores).
"""

import time
from datetime import date
from typing import Optional
import pandas as pd
import yfinance as yf
from backend.db.connection import get_db
from backend.data_sync.base import log_sync, upsert_df, last_synced_date

SOURCE_ID     = "yf_fundamentals"
SLEEP_BETWEEN = 1.0   # seconds between ticker fetches to avoid rate limiting
DEFAULT_LIMIT = 500   # max symbols per run (run again to continue)


def _get_symbols() -> list[str]:
    db = get_db()
    rows = db.execute("SELECT DISTINCT symbol FROM stock_ohlcv ORDER BY symbol").fetchall()
    return [r[0] for r in rows]


def _safe_val(df: pd.DataFrame, metric: str, col) -> Optional[float]:
    if df is None or df.empty or metric not in df.index:
        return None
    try:
        v = df.loc[metric, col]
        return float(v) if pd.notna(v) else None
    except Exception:
        return None


def _parse_financials(ticker: yf.Ticker, symbol: str, period_type: str) -> list[dict]:
    """Extract fundamentals rows for one symbol, one period type (Q or A)."""
    if period_type == "Q":
        income = ticker.quarterly_income_stmt
        balance = ticker.quarterly_balance_sheet
        cashflow = ticker.quarterly_cashflow
    else:
        income = ticker.income_stmt
        balance = ticker.balance_sheet
        cashflow = ticker.cashflow

    if income is None or income.empty:
        return []

    rows = []
    for col in income.columns:
        try:
            period = col.date() if hasattr(col, "date") else pd.Timestamp(col).date()
        except Exception:
            continue

        # Get balance sheet and CF for the same or nearest period
        b_col = col if (balance is not None and not balance.empty and col in balance.columns) else None
        c_col = col if (cashflow is not None and not cashflow.empty and col in cashflow.columns) else None

        s = lambda m: _safe_val(income, m, col)
        b = lambda m: _safe_val(balance, m, b_col) if b_col is not None else None
        c = lambda m: _safe_val(cashflow, m, c_col) if c_col is not None else None

        rows.append({
            "symbol":         symbol,
            "period":         period,
            "period_type":    period_type,
            "is_consolidated": True,
            "revenue":        s("Total Revenue"),
            "gross_profit":   s("Gross Profit"),
            "ebitda":         s("EBITDA"),
            "ebit":           s("EBIT"),
            "pbt":            s("Pretax Income"),
            "pat":            s("Net Income"),
            "eps_basic":      s("Basic EPS"),
            "eps_diluted":    s("Diluted EPS"),
            "total_assets":   b("Total Assets"),
            "total_equity":   b("Common Stock Equity") or b("Stockholders Equity"),
            "total_debt":     b("Total Debt"),
            "cash":           b("Cash And Cash Equivalents"),
            "cfo":            c("Operating Cash Flow"),
            "cfi":            c("Investing Cash Flow"),
            "cff":            c("Financing Cash Flow"),
            "capex":          c("Capital Expenditure"),
        })

    return rows


def run(limit: int = DEFAULT_LIMIT):
    symbols = _get_symbols()
    if not symbols:
        print(f"[{SOURCE_ID}] no symbols in DB — run bhavcopy sync first")
        return

    # Respect limit so the script is resumable in chunks
    symbols = symbols[:limit]
    print(f"[{SOURCE_ID}] processing {len(symbols)} symbols")

    all_rows, failed = [], []

    for i, symbol in enumerate(symbols):
        ticker_code = f"{symbol}.NS"
        try:
            t = yf.Ticker(ticker_code)
            rows_q = _parse_financials(t, symbol, "Q")
            rows_a = _parse_financials(t, symbol, "A")
            all_rows.extend(rows_q + rows_a)
            if (i + 1) % 50 == 0:
                print(f"[{SOURCE_ID}] {i+1}/{len(symbols)} done...")
        except Exception as e:
            failed.append(symbol)
            print(f"[{SOURCE_ID}] WARN {symbol}: {e}")

        time.sleep(SLEEP_BETWEEN)

    if not all_rows:
        log_sync(SOURCE_ID, "failed", 0, None, f"no data; {len(failed)} failures")
        print(f"[{SOURCE_ID}] FAILED — no fundamental data fetched")
        return

    df = pd.DataFrame(all_rows).dropna(subset=["revenue", "pat"], how="all")
    count = upsert_df(df, "stock_fundamentals")
    status = "success" if not failed else "partial"
    log_sync(SOURCE_ID, status, count, date.today())
    print(f"[{SOURCE_ID}] inserted {count} rows ({len(failed)} failures)")


if __name__ == "__main__":
    run()
