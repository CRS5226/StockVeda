"""
NSE corporate actions (dividends, splits, bonuses) + insider/PIT trades.
Sources:
  - nseindia.com/api/corporates-corporateActions?index=equities&symbol={SYMBOL}
  - nseindia.com/api/corporates-pit?symbol={SYMBOL}&from=DD-MM-YYYY&to=DD-MM-YYYY
Tables: corporate_actions, insider_trades
"""

import time
from datetime import date, timedelta
import pandas as pd
from backend.db.connection import get_db
from backend.data_sync.base import log_sync, upsert_df, last_synced_date
from backend.data_sync.nse_session import nse_get

SOURCE_ID = "nse_corporate_actions"
CORP_URL  = "https://www.nseindia.com/api/corporates-corporateActions"
PIT_URL   = "https://www.nseindia.com/api/corporates-pit"

ACTION_TYPE_MAP = {
    "dividend": "DIVIDEND",
    "bonus":    "BONUS",
    "split":    "SPLIT",
    "rights":   "RIGHTS",
    "buyback":  "BUYBACK",
}

DEFAULT_LOOKBACK_DAYS = 90


def _get_symbols() -> list[str]:
    """Pull distinct symbols that have OHLCV data."""
    db = get_db()
    rows = db.execute("SELECT DISTINCT symbol FROM stock_ohlcv ORDER BY symbol").fetchall()
    return [r[0] for r in rows]


def _classify_action(subject: str) -> str:
    s = (subject or "").lower()
    for kw, label in ACTION_TYPE_MAP.items():
        if kw in s:
            return label
    return "OTHER"


def _extract_value(subject: str) -> float | None:
    import re
    m = re.search(r'rs\.?\s*([\d.]+)', subject, re.IGNORECASE)
    if m:
        return float(m.group(1))
    return None


def _parse_ratio(subject: str) -> str | None:
    import re
    m = re.search(r'(\d+\s*:\s*\d+)', subject)
    return m.group(1) if m else None


def _sync_corporate_actions(symbols: list[str]) -> int:
    rows = []
    for sym in symbols:
        try:
            r = nse_get(CORP_URL, params={"index": "equities", "symbol": sym})
            if r.status_code != 200:
                continue
            data = r.json()
            if not isinstance(data, list):
                continue
            for item in data:
                try:
                    ex_date = pd.to_datetime(item.get("exDate", ""), dayfirst=True).date()
                    rec_date_raw = item.get("recDate", "")
                    rec_date = pd.to_datetime(rec_date_raw, dayfirst=True).date() if rec_date_raw and rec_date_raw != "-" else None
                    subject = item.get("subject", "")
                    rows.append({
                        "symbol":      sym,
                        "ex_date":     ex_date,
                        "action_type": _classify_action(subject),
                        "value":       _extract_value(subject),
                        "ratio":       _parse_ratio(subject),
                        "record_date": rec_date,
                    })
                except Exception:
                    continue
        except Exception as e:
            print(f"[{SOURCE_ID}] WARN {sym} corp_actions: {e}")
        time.sleep(0.3)

    if not rows:
        return 0
    return upsert_df(pd.DataFrame(rows), "corporate_actions")


def _sync_insider_trades(symbols: list[str], from_date: date, to_date: date) -> int:
    from_str = from_date.strftime("%d-%m-%Y")
    to_str   = to_date.strftime("%d-%m-%Y")
    rows = []
    for sym in symbols:
        try:
            r = nse_get(PIT_URL, params={"symbol": sym, "from": from_str, "to": to_str})
            if r.status_code != 200:
                continue
            data = r.json()
            details = data.get("data", [])
            if not details:
                continue
            for item in details:
                try:
                    qty_raw = item.get("secAcq") or item.get("buyQuantity") or "0"
                    val_raw = item.get("secVal") or item.get("buyValue") or "0"
                    qty = int(float(str(qty_raw).replace(",", "") or 0))
                    val = float(str(val_raw).replace(",", "") or 0)
                    price = (val / qty) if qty else None
                    rows.append({
                        "symbol":           sym,
                        "person_name":      item.get("acqName", ""),
                        "person_category":  item.get("personCategory", ""),
                        "trade_date":       pd.to_datetime(item.get("acqfromDt", ""), dayfirst=True).date(),
                        "transaction_type": item.get("tdpTransactionType", ""),
                        "quantity":         qty,
                        "price":            price,
                        "filing_date":      pd.to_datetime(item.get("intimDt", ""), dayfirst=True).date(),
                    })
                except Exception:
                    continue
        except Exception as e:
            print(f"[{SOURCE_ID}] WARN {sym} pit: {e}")
        time.sleep(0.3)

    if not rows:
        return 0
    return upsert_df(pd.DataFrame(rows), "insider_trades")


def run():
    symbols = _get_symbols()
    if not symbols:
        print(f"[{SOURCE_ID}] no symbols in DB — run bhavcopy sync first")
        return

    print(f"[{SOURCE_ID}] processing {len(symbols)} symbols")

    count_corp = _sync_corporate_actions(symbols)

    last = last_synced_date(SOURCE_ID)
    from_date = (last + timedelta(days=1)) if last else (date.today() - timedelta(days=DEFAULT_LOOKBACK_DAYS))
    to_date = date.today()
    count_pit = _sync_insider_trades(symbols, from_date, to_date)

    total = count_corp + count_pit
    log_sync(SOURCE_ID, "success", total, date.today())
    print(f"[{SOURCE_ID}] done: corp_actions={count_corp} insider_trades={count_pit}")


if __name__ == "__main__":
    run()
