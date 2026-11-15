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

## 6. Ownership and group structure - not resolved

- BSE corporate group repository page (`bseindia.com/static/about/corporate_group_repository.aspx`) loads, but it has no download link or table in the page itself; the data probably comes from `api.bseindia.com`. Not yet inspected.
- CDSL repository page: not fetched.
- NSE shareholding-pattern XBRL files: listed on the NSE XBRL page; bulk download not confirmed.
- Wikidata SPARQL answers, but my first query (stock exchange NSE) returned zero rows; the entity id was a guess. Needs checking before trusting coverage.
- Dataful (SEBI BRSR subsidiaries/associates, 2020-21 onward): licence not checked.

## 7. Supplier and customer links

No free structured source found. Only paid platforms (Tracenable, CompanyData). Plan: hand-curated sector chain, plus annual-report text for a few big groups later.

## Next checks

1. Look at `api.bseindia.com` calls made by the BSE group repository page.
2. Check what Wikidata really has (correct NSE id, parent organisation, headquarters) for the Nifty 500.
3. Count rows in `stock_sector`, `commodity_prices`, `bulk_block_deals`, `shareholding` to see what is already filled.
