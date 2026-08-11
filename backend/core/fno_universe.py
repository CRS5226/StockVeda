"""
NSE F&O-eligible universe — shared between routes/fno.py (option chain, search)
and core/quant_signals.py (F&O-only algo eligibility gate). Extracted from
routes/fno.py so core modules don't import from routes.
"""

INDEX_SYMBOLS = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "NIFTYBANK"}

# NSE F&O-eligible stock universe (periodically revised by NSE — hardcoded backbone,
# merged with whatever symbols have already been synced so newly-added F&O stocks
# still show up once fetched once).
FNO_STOCK_UNIVERSE = {
    "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "HINDUNILVR", "ITC", "SBIN",
    "BHARTIARTL", "KOTAKBANK", "LT", "AXISBANK", "BAJFINANCE", "ASIANPAINT", "MARUTI",
    "HCLTECH", "SUNPHARMA", "TITAN", "ULTRACEMCO", "NESTLEIND", "WIPRO", "ADANIENT",
    "ADANIPORTS", "ADANIGREEN", "ADANIPOWER", "ONGC", "NTPC", "POWERGRID", "COALINDIA",
    "TATASTEEL", "TMPV", "TATACONSUM", "TATAPOWER", "JSWSTEEL", "HINDALCO", "VEDL",
    "GRASIM", "BAJAJFINSV", "BAJAJ-AUTO", "HEROMOTOCO", "EICHERMOT", "M&M", "DRREDDY",
    "CIPLA", "DIVISLAB", "APOLLOHOSP", "BRITANNIA", "DABUR", "GODREJCP", "MARICO",
    "COLPAL", "PIDILITIND", "BERGEPAINT", "HAVELLS", "VOLTAS", "SIEMENS", "ABB", "BEL",
    "BHEL", "HAL", "IRCTC", "IRFC", "RVNL", "ETERNAL", "PAYTM", "NYKAA", "POLICYBZR",
    "DMART", "TRENT", "JUBLFOOD", "PAGEIND", "INDIGO", "PVRINOX", "LUPIN", "AUROPHARMA",
    "TORNTPHARM", "BIOCON", "ALKEM", "MOTHERSON", "BOSCHLTD", "EXIDEIND", "MRF",
    "BALKRISIND", "ASHOKLEY", "TVSMOTOR", "BHARATFORG", "CUMMINSIND", "SRF", "PIIND",
    "UPL", "DEEPAKNTR", "GNFC", "PETRONET", "GAIL", "IOC", "BPCL", "HINDPETRO", "OIL",
    "IGL", "MGL", "INDUSINDBK", "IDFCFIRSTB", "FEDERALBNK", "BANKBARODA", "PNB", "CANBK",
    "UNIONBANK", "RBLBANK", "AUBANK", "BANDHANBNK", "CHOLAFIN", "MUTHOOTFIN",
    "SHRIRAMFIN", "LICHSGFIN", "PFC", "RECLTD", "HDFCLIFE", "ICICIPRULI", "ICICIGI",
    "SBILIFE", "SBICARD", "MFSL", "HDFCAMC", "NAUKRI", "CDSL", "BSE", "MCX", "IEX",
    "CAMS", "ANGELONE", "IIFL", "PERSISTENT", "LTIM", "MPHASIS", "COFORGE", "LTTS",
    "TECHM", "OFSS", "TATAELXSI", "ZENSAR", "KPITTECH", "SONACOMS", "SUZLON",
    "JINDALSTEL", "SAIL", "NMDC", "NATIONALUM", "RATNAMANI", "APLAPOLLO", "JSL",
    "ESCORTS", "CGPOWER", "POLYCAB", "DIXON", "AMBER", "WHIRLPOOL", "CROMPTON",
    "GODREJPROP", "DLF", "OBEROIRLTY", "PRESTIGE", "PHOENIXLTD", "LODHA", "BRIGADE",
    "SUNTV", "ZEEL", "NAZARA", "INDHOTEL", "LEMONTREE", "CONCOR", "GMRINFRA",
    "MANAPPURAM", "IDEA", "TATACOMM", "HFCL", "GSPL", "LAURUSLABS", "ABCAPITAL",
    "ABFRL", "DALBHARAT", "SYNGENE", "GLENMARK", "IPCALAB", "METROPOLIS", "NAVINFLUOR",
    "CHAMBLFERT", "COROMANDEL", "BATAINDIA", "RELAXO", "VBL", "UBL",
    "RADICO", "ACC", "AMBUJACEM", "SHREECEM", "JKCEMENT", "ATUL", "TATACHEM",
    "AARTIIND", "GRANULES", "CANFINHOME", "PEL", "M&MFIN", "LTF",
} | set(INDEX_SYMBOLS)

# Ticker renames from corporate actions, applied above (kept as a note for
# future review, not live code): ZOMATO->ETERNAL (name change, Mar 2025),
# L&TFH->LTF (name change, Apr 2024), TATAMOTORS->TMPV (demerger split PV
# from the CV business, which now trades separately as TMLCV, not yet added
# here pending confirmation of its own F&O eligibility). Also removed
# PIRAMALENT (not a real distinct NSE ticker; PEL is Piramal's actual symbol)
# and a duplicate "IEX" entry.
