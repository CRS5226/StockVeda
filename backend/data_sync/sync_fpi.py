"""
FPI (FII) daily equity flows from NSDL's FPI Monitor archive.
Source: fpi.nsdl.co.in/web/Reports/Archive.aspx — one POST returns a month-to-date table.
Table: fpi_flows

NSE's FII/DII API only returns the latest day, so this is the FII history source for
the ML features. Only equity bought/sold through stock exchanges is kept, the closest
match to NSE's cash-market figure. Rows are keyed by NSDL's reporting date, which covers
custodian-confirmed trades up to the previous session, so the numbers lag NSE's
provisional ones by a day and won't match them exactly.
"""

from datetime import date, timedelta
import calendar
import io
import re
import pandas as pd
from backend.data_sync.base import get_client, log_sync, upsert_df, last_synced_date

SOURCE_ID = "nsdl_fpi"
ARCHIVE_URL = "https://www.fpi.nsdl.co.in/web/Reports/Archive.aspx"
MONTHS_BACK = 12  # first sync only


def _to_number(s: pd.Series) -> pd.Series:
    """'1,234.50' -> 1234.5, '(291.00)' -> -291.0"""
    s = s.str.strip().str.replace(",", "").str.replace(r"^\((.*)\)$", r"-\1", regex=True)
    return pd.to_numeric(s, errors="coerce")


def _parse_archive(html: str) -> pd.DataFrame:
    """Daily equity stock-exchange rows from an archive page; drops the month/year total rows."""
    table = max(pd.read_html(io.StringIO(html)), key=len).iloc[:, :6].astype(str)
    table.columns = ["date", "kind", "route", "buy", "sell", "net"]
    rows = table[(table["kind"].str.strip() == "Equity") & (table["route"].str.strip() == "Stock Exchange")]
    df = pd.DataFrame({
        "date": pd.to_datetime(rows["date"].str.strip(), format="%d-%b-%Y", errors="coerce").dt.date,
        "buy":  _to_number(rows["buy"]),
        "sell": _to_number(rows["sell"]),
        "net":  _to_number(rows["net"]),
    })
    return df.dropna(subset=["date", "net"]).drop_duplicates("date").reset_index(drop=True)


def _fetch_month(client, as_of: date) -> str:
    """Archive page for as_of's month, up to as_of. The report is an ASP.NET postback."""
    page = client.get(ARCHIVE_URL)
    page.raise_for_status()
    form = dict(re.findall(r'<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"', page.text))
    form.update({"__EVENTTARGET": "btnSubmit1", "__EVENTARGUMENT": "",
                 "txtDate": as_of.strftime("%d-%b-%Y"), "hdnFlag": ""})
    resp = client.post(ARCHIVE_URL, data=form)
    resp.raise_for_status()
    return resp.text


def _month_ends(start: date, end: date) -> list[date]:
    """Last day of each month from start's month to end's, the final one capped at end."""
    out, y, m = [], start.year, start.month
    while (y, m) <= (end.year, end.month):
        out.append(min(date(y, m, calendar.monthrange(y, m)[1]), end))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def run() -> int:
    """Fetch FPI flows from the last synced month (or MONTHS_BACK) to today. Returns rows upserted."""
    today = date.today()
    last = last_synced_date(SOURCE_ID)
    start = last or today.replace(day=1) - timedelta(days=31 * MONTHS_BACK)

    frames, failed = [], []
    bookmark = last  # only advances over months fetched before the first failure
    with get_client() as client:
        for as_of in _month_ends(start, today):
            try:
                df = _parse_archive(_fetch_month(client, as_of))
            except Exception as e:  # noqa: BLE001 — record and keep going; retried next run
                failed.append(f"{as_of:%b %Y}: {e}")
                continue
            frames.append(df)
            if not failed and not df.empty:
                bookmark = df["date"].max()

    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    count = upsert_df(df, "fpi_flows")
    status = "success" if not failed else "partial" if frames else "failed"
    error = "; ".join(failed) or None
    log_sync(SOURCE_ID, status, count, bookmark, error)
    print(f"[{SOURCE_ID}] {status}: {count} rows up to {bookmark}" + (f" — {error}" if error else ""))
    return count


if __name__ == "__main__":
    run()
