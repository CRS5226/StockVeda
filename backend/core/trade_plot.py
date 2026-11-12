"""Rules for plotted trades: the long / short boxes drawn on the Charts page."""

SIDES = ("long", "short")


def validate_levels(side: str, entry: float, stop_loss: float, target: float) -> str | None:
    """Why the three prices cannot be a trade box, or None when they can.

    A long loses when the price falls, so its stop-loss sits below the entry and its target above it.
    A short is the mirror image.
    """
    if side not in SIDES:
        return "Side must be long or short."
    if min(entry, stop_loss, target) <= 0:
        return "Prices must be above 0."
    if side == "long":
        if not stop_loss < entry:
            return "A long needs its stop-loss below the entry price."
        if not target > entry:
            return "A long needs its target above the entry price."
    else:
        if not stop_loss > entry:
            return "A short needs its stop-loss above the entry price."
        if not target < entry:
            return "A short needs its target below the entry price."
    return None
