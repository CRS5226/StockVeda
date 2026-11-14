"""Rules for the lines and rectangles drawn on the Charts page."""

import re

KINDS = ("line", "hline", "rect")
_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


def validate_drawing(kind: str, price1: float, price2: float, color: str) -> str | None:
    """Why a drawing cannot be saved, or None when it can."""
    if kind not in KINDS:
        return "Kind must be line, hline or rect."
    if min(price1, price2) <= 0:
        return "Prices must be above 0."
    if not _COLOR.match(color):
        return "Colour must look like #3b82f6."
    if kind == "rect" and price1 == price2:
        return "A rectangle needs two different prices."
    return None
