# Data sources for Stock Connections

Research for issue #179. Checked 2026-11-15 with real calls (one small request each). "Verified" means the response shape below was seen live.

## Already in our database

| Table | Columns that matter here |
|---|---|
| `stock_sector` | `symbol, sector` |
| `stock_ratios_snapshot` | `symbol, as_of, pe, pb, roe_pct, market_cap, beta, sector, industry` |
| `shareholding` | `symbol, period, promoter_pct, promoter_pledge_pct, fii_pct, dii_pct, mf_pct, retail_pct` |
| `bulk_block_deals` | `date, symbol, deal_type, client_name, transaction_type, quantity, price` |
| `insider_trades` | `symbol, person_name, person_category, trade_date, transaction_type, quantity, price` |
| `commodity_prices` | `date, commodity, price, unit, currency` |
| `nse_symbols` | `symbol, company_name, series, isin` |
| `stock_ohlcv` | daily prices, used for correlation |

Issues #14, #21 and #22 overlap with tables that already exist. Check what is actually populated before building new syncs.

## 1. yfinance `.info` (headquarters, sector, industry) - verified

Free, no key, already used. Fields seen for RELIANCE.NS: `city` (Mumbai), `zip`, `address1`, `country`, `sector`, `industry`, `sectorKey`, `industryKey`, `longBusinessSummary`, `fullTimeEmployees`, `website`, `heldPercentInsiders`, `heldPercentInstitutions`, `companyOfficers`. `state` was empty, so state must come from the city lookup. Coverage differs per company, so handle missing values.

## 2. NSE announcements - verified (session-gated, use `nse_get`)

`GET https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=LT&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY`

Returns a JSON list. Fields: `symbol, sm_name, sm_isin, smIndustry, desc` (category), `attchmntText` (one-line text), `attchmntFile` (PDF url), `an_dt, exchdisstime, hasXbrl`.

Categories seen: `Bagging/Receiving of orders/contracts`, `Outcome of Board Meeting`, `Credit Rating`, `Change in Management`, `Scheme of Arrangement`, `Press Release`, and others.

Limits: the text rarely includes the order value (only in the PDF), and some order announcements have no detail at all. Gives events, not an order book. Used for #17.

## 3. NSE board meetings - verified

`GET https://www.nseindia.com/api/corporate-board-meetings?index=equities&symbol=LT`

Fields: `bm_symbol, bm_date, bm_purpose, bm_desc, sm_name, sm_isin, sm_indusrty, bm_timestamp`. Issue #23 names `corporates-boardMeetings`, which returned 404; the working path is `corporate-board-meetings`.

## 4. NSE pledge - not working yet

`/api/corporate-pledgedata` answered 200 but with `{"comNameList": [], "data": []}` for the parameters tried. Our `shareholding.promoter_pledge_pct` may already hold what #22 needs. Needs more investigation.

## 5. Open-Meteo weather - verified

`GET https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&daily=precipitation_sum,temperature_2m_max,wind_gusts_10m_max&forecast_days=3&timezone=Asia/Kolkata` returns daily arrays. Past data: `past_days` up to 92, or `https://archive-api.open-meteo.com/v1/archive?...&start_date=..&end_date=..`. Geocoding: `https://geocoding-api.open-meteo.com/v1/search?name=Vadodara&count=1&country_code=IN` returns `latitude, longitude, admin1 (state), population`.

Licence: free without a key for **non-commercial** use only (their docs list separate commercial terms). Fine for a self-hosted open-source tool, but say so in the README. No rate limit is documented, so fetch per city (about 100), not per company, and cache.

## 6. Ownership and group structure

**Best free source: NSE shareholding XBRL (verified).** `GET /api/corporate-share-holdings-master?index=equities&symbol=RELIANCE` (needs `nse_get`) returns the latest filing, including `date`, `pr_and_prgrp`, `public_val`, and an `xbrl` file URL on `nsearchives.nseindia.in` that downloads without a session. In the RELIANCE file (500 KB) there are 57 `NameOfTheShareholder` entries: promoter individuals (Mukesh D Ambani ...), promoter LLPs and companies (Srichakra Commercials LLP, Tattvam Enterprises LLP ...), and further down the named holders above 1%. Each carries a `contextRef` that links it to its category and to its shares and percentage values (the percentage tag is not mapped yet). This gives "who holds this company", including other companies, for every listed stock. The reverse ("what does this company hold") comes from matching holder names to `nse_symbols.company_name`.

`sync_shareholding_master.py` already downloads these files for the category totals, but it does not keep the holder names. A new table (for example `shareholders(symbol, period, holder_name, category, shares, pct)`) can reuse that download.

Our local `shareholding` table is empty for RELIANCE and TATAMOTORS at the moment, so the sync has not been run on this machine.

**Wikidata (verified, weak).** NSE is `Q638740`. Query for companies listed on it: 200 companies, only 23 have a parent organisation (P749), 39 a headquarters (P159), 36 an owner (P127). Too sparse for the whole market, but usable to add group names (Tata, Hinduja, Aditya Birla, Mahindra) for the largest groups.

**BSE and CDSL group repositories.** The BSE page loads (after a redirect) but has no table or download link in the HTML; the data likely comes from `api.bseindia.com`. Not inspected further. CDSL not fetched.

**Dataful (SEBI BRSR subsidiaries and associates).** Licence not checked.

## 7. Supplier and customer links

No free structured source found. Only paid platforms (Tracenable, CompanyData). Plan: hand-curated sector chain, plus annual-report text for a few big groups later.

## Findings on what is already stored (2026-11-15, local database)

`shareholding` has no rows for RELIANCE or TATAMOTORS, `bulk_deals` returns an empty list, and the sector-compare chart errors for TATAMOTORS ("Insufficient data"). Run the syncs before judging what #14 and #22 still need.

## Next checks

1. Map the XBRL percentage tag to each named holder and parse a second company to confirm the layout is the same.
2. Inspect `api.bseindia.com` for the group repository data.
3. Decide the table design for holders and group names.
