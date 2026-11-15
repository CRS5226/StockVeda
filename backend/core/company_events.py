"""Company events from NSE announcements and board meetings: parsing, and reading them back.

NSE publishes about 1,000 announcements a day, most of them routine (newspaper copies,
call schedules, trading windows). Only the categories below are kept, each tagged with a
short `kind`. An order announcement gives the event and a PDF link, not the order value.
"""

from datetime import date, datetime

import pandas as pd

from backend.db.connection import df_to_records, get_db

# NSE announcement category (exact text) -> kind.
EVENT_KINDS = {
    "Bagging/Receiving of orders/contracts": "order",
    "Credit Rating": "rating",
    "Credit Rating- Revision": "rating",
    "Acquisition": "deal",
    "Agreements": "deal",
    "Scheme of Arrangement": "deal",
    "Capacity addition": "capacity",
    "Dividend": "dividend",
    "Change in Management": "management",
    "Corporate Insolvency Resolution Process": "insolvency",
}
EVENT_COLUMNS = ["symbol", "event_time", "category", "kind", "subject", "pdf_url"]
MEETING_COLUMNS = ["symbol", "meeting_date", "purpose", "description"]
MAX_SUBJECT_CHARS = 500


def _text(value, limit: int | None = None) -> str:
    text = " ".join(str(value or "").split())
    return text[:limit] if limit else text


def parse_events(records: list[dict]) -> pd.DataFrame:
    """Announcements in the kept categories as company_events rows; unreadable rows are skipped."""
    rows = []
    for r in records:
        kind = EVENT_KINDS.get(_text(r.get("desc")))
        if kind is None:
            continue
        try:
            rows.append({
                "symbol": _text(r["symbol"]).upper(),
                "event_time": datetime.strptime(_text(r["an_dt"]), "%d-%b-%Y %H:%M:%S"),
                "category": _text(r["desc"]),
                "kind": kind,
                "subject": _text(r.get("attchmntText"), MAX_SUBJECT_CHARS),
                "pdf_url": _text(r.get("attchmntFile")) or None,
            })
        except (KeyError, ValueError):
            continue
    return pd.DataFrame(rows, columns=EVENT_COLUMNS)


def parse_meetings(records: list[dict]) -> pd.DataFrame:
    """Board meetings as board_meetings rows; unreadable rows are skipped."""
    rows = []
    for r in records:
        try:
            rows.append({
                "symbol": _text(r["bm_symbol"]).upper(),
                "meeting_date": datetime.strptime(_text(r["bm_date"]), "%d-%b-%Y").date(),
                "purpose": _text(r.get("bm_purpose")),
                "description": _text(r.get("bm_desc"), MAX_SUBJECT_CHARS),
            })
        except (KeyError, ValueError):
            continue
    return pd.DataFrame(rows, columns=MEETING_COLUMNS)


def _kind_filter(kind: str | None) -> tuple[str, list]:
    if kind and kind in set(EVENT_KINDS.values()):
        return "AND kind = ?", [kind]
    return "", []


def stock_events(symbol: str, days: int = 365, kind: str | None = None, limit: int = 100, today: date | None = None) -> dict:
    """Events and board meetings for one symbol: recent events, order wins in the last year, next meetings."""
    db = get_db()
    symbol = symbol.strip().upper()
    today = today or date.today()
    days = min(max(days, 1), 1825)
    extra, extra_params = _kind_filter(kind)
    events = db.execute(f"""
        SELECT event_time, category, kind, subject, pdf_url FROM company_events
        WHERE symbol = ? AND event_time >= ? {extra}
        ORDER BY event_time DESC LIMIT ?
    """, [symbol, datetime.combine(today, datetime.min.time()) - pd.Timedelta(days=days), *extra_params, min(max(limit, 1), 500)]).df()
    order_wins = db.execute(
        "SELECT COUNT(*) FROM company_events WHERE symbol = ? AND kind = 'order' AND event_time >= ?",
        [symbol, datetime.combine(today, datetime.min.time()) - pd.Timedelta(days=365)],
    ).fetchone()[0]
    history_from = db.execute("SELECT MIN(CAST(event_time AS DATE)) FROM company_events").fetchone()[0]
    meetings = db.execute("""
        SELECT meeting_date, purpose, description FROM board_meetings
        WHERE symbol = ? AND meeting_date >= ? ORDER BY meeting_date LIMIT 10
    """, [symbol, today]).df()
    return {
        "symbol": symbol,
        "order_wins_12m": order_wins,
        # The count only covers days we have stored; a page should say so when this is under a year old.
        "history_from": str(history_from) if history_from else None,
        "next_meeting": df_to_records(meetings)[0] if not meetings.empty else None,
        "upcoming_meetings": df_to_records(meetings),
        "events": _records(events),
    }


def recent_events(kind: str | None = None, days: int = 30, limit: int = 100, today: date | None = None) -> list[dict]:
    """Market-wide recent events, newest first, optionally of one kind (for example 'order')."""
    today = today or date.today()
    extra, extra_params = _kind_filter(kind)
    df = get_db().execute(f"""
        SELECT symbol, event_time, category, kind, subject, pdf_url FROM company_events
        WHERE event_time >= ? {extra} ORDER BY event_time DESC LIMIT ?
    """, [datetime.combine(today, datetime.min.time()) - pd.Timedelta(days=min(max(days, 1), 365)), *extra_params, min(max(limit, 1), 500)]).df()
    return _records(df)


def _records(df: pd.DataFrame) -> list[dict]:
    """Records with the event time as text (df_to_records would keep only the date)."""
    if df.empty:
        return []
    df = df.copy()
    df["event_time"] = df["event_time"].dt.strftime("%Y-%m-%d %H:%M")
    return df_to_records(df)
