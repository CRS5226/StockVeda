"""Named shareholders from an NSE shareholding-pattern XBRL file, and reading them back.

In the XBRL a holder's name sits in context `D_<Category>_Context<N>` and the
holding numbers in the matching context `<Category>_Context<N>` (no `D_`).
Percentages are fractions (0.0187 means 1.87%). Promoter holders also carry a
`TypeOfPromoterShareholding` element; everyone else is a public holder above 1%.
"""

import re
import xml.etree.ElementTree as ET

from backend.db.connection import df_to_records, get_db

XBRL_NS = "http://www.bseindia.com/xbrl/shp/2025-10-31/in-bse-shp"
SHAREHOLDER_COLUMNS = ["symbol", "period", "holder_name", "holder_group", "category", "shares", "pct"]


def _tag(name: str) -> str:
    return f"{{{XBRL_NS}}}{name}"


def _words(camel: str) -> str:
    """'OthersIndianShareholders' -> 'Others Indian Shareholders'."""
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", camel)


def _number(text: str | None) -> float | None:
    try:
        return float(text) if text not in (None, "") else None
    except ValueError:
        return None


def parse_shareholders(xml_text: str) -> list[dict]:
    """Holders in one filing: name, promoter or public, category, shares and percent of all shares.

    Returns [] when the file cannot be parsed. Masked values (PAN) are never read.
    """
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []

    by_context: dict[str, dict[str, str | None]] = {}
    for el in root:
        ctx = el.get("contextRef")
        if ctx:
            by_context.setdefault(ctx, {})[el.tag.split("}")[-1]] = el.text

    holders = []
    for ctx, fields in by_context.items():
        name = (fields.get("NameOfTheShareholder") or "").strip()
        if not ctx.startswith("D_") or not name:
            continue
        numbers = by_context.get(ctx[2:], {})
        category_key = ctx[2:].rsplit("_Context", 1)[0]
        # "Others Indian" holders say what they are (Bodies Corporate, Trusts ...) in their own field.
        category = (fields.get("CategoryOfOtherIndianShareholders") or "").strip() or _words(category_key)
        pct = _number(numbers.get("ShareholdingAsAPercentageOfTotalNumberOfShares"))
        shares = _number(numbers.get("NumberOfShares"))
        holders.append({
            "holder_name": name,
            "holder_group": "promoter" if "TypeOfPromoterShareholding" in fields else "public",
            "category": category,
            "shares": int(shares) if shares is not None else None,
            "pct": round(pct * 100, 4) if pct is not None else None,
        })
    return holders


def get_shareholders(symbol: str) -> dict | None:
    """The holders in the latest stored filing for a symbol, biggest first; None when none are stored."""
    db = get_db()
    symbol = symbol.strip().upper()
    period = db.execute("SELECT MAX(period) FROM shareholders WHERE symbol = ?", [symbol]).fetchone()[0]
    if period is None:
        return None
    df = db.execute(f"""
        SELECT {', '.join(SHAREHOLDER_COLUMNS)} FROM shareholders
        WHERE symbol = ? AND period = ?
        ORDER BY pct DESC NULLS LAST, shares DESC NULLS LAST, holder_name
    """, [symbol, period]).df()
    return {"symbol": symbol, "period": str(period), "holders": df_to_records(df)}
