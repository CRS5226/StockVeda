"""What kind of instrument a listed symbol is: a stock, an ETF, a REIT or an InvIT.

The equity master list (`nse_symbols`) holds only ordinary shares, so the type is guessed from the symbol and the
company name. The lists below cover the well-known REITs, InvITs and ETFs; the user can set the type by hand for any
holding the guess gets wrong.
"""

from typing import Optional

KINDS = ("stock", "etf", "reit", "invit")

REITS = {"EMBASSY", "MINDSPACE", "BIRET", "NXST", "KRT"}
INVITS = {"INDIGRID", "PGINVIT", "IRBINVIT", "NHIT", "CUBEINVIT", "ENERGYINF"}
# ETFs whose symbol does not say so
ETFS = {"MON100", "MAFANG", "MASPTOP50", "MOM100", "MOM50", "MOSMALL250", "MID150BEES", "SILVERBEES", "GOLDBEES", "LIQUIDBEES"}


def guess_kind(symbol: str, company_name: Optional[str] = None) -> str:
    """The most likely type of a symbol, from the lists above and from words in its name."""
    sym = symbol.strip().upper()
    name = (company_name or "").upper()
    if sym in REITS or "REAL ESTATE INVESTMENT TRUST" in name or name.endswith(" REIT"):
        return "reit"
    if sym in INVITS or "INFRASTRUCTURE INVESTMENT TRUST" in name or "INVIT" in name:
        return "invit"
    if sym in ETFS or sym.endswith("BEES") or "ETF" in sym or "ETF" in name or "EXCHANGE TRADED" in name:
        return "etf"
    return "stock"


def effective_kind(override: Optional[str], symbol: str, company_name: Optional[str] = None) -> str:
    """The type to show: the one the user set, otherwise the guess."""
    return override if override in KINDS else guess_kind(symbol, company_name)
