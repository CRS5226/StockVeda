"""Tests for the NSE index-close fallback in sync_indices."""

from datetime import date

from backend.data_sync.sync_indices import INDICES, NSE_INDICES, _parse_ind_close

SAMPLE = """Index Name,Index Date,Open Index Value,High Index Value,Low Index Value,Closing Index Value,Points Change,Change(%),Volume,Turnover (Rs. Cr.),P/E,P/B,Div Yield
Nifty 50,18-09-2026,25100.1,25210.4,25050.2,25180.75,60.2,0.24,250000000,21000.5,22.1,3.5,1.3
Nifty Auto,18-09-2026,27300.5,27410.0,27090.9,27304.5,-230.1,-0.84,40000000,3000.1,28.4,5.1,0.9
NIFTY FMCG,18-09-2026,45100,45200,44950,45053.75,-130.5,-0.29,30000000,2500,45.2,11.3,1.6
Nifty Metal,18-09-2026,-,13084.1,12886.1,12999.05,-305.9,-2.30,50000000,4000,15.2,2.1,2.4
Nifty Energy,18-09-2026,37900,38000,37800,37935.2,-285.4,-0.75,20000000,1500,12.1,1.9,2.9
Nifty Realty,18-09-2026,860,865,845,848.5,-23.6,-2.70,10000000,800,40.3,4.2,0.3
"""


def test_parse_keeps_only_sectoral_indices_with_display_names():
    df = _parse_ind_close(SAMPLE)
    assert sorted(df["index_name"]) == sorted(NSE_INDICES)
    assert "Nifty 50" not in set(df["index_name"])
    assert list(df.columns) == ["date", "index_name", "open", "high", "low", "close"]


def test_parse_values_dates_and_case_insensitive_match():
    df = _parse_ind_close(SAMPLE).set_index("index_name")
    assert df.loc["NIFTY FMCG", "close"] == 45053.75           # upper-case name in CSV
    assert df.loc["NIFTY AUTO", "date"] == date(2026, 9, 18)
    assert df.loc["NIFTY REALTY", "low"] == 845


def test_parse_tolerates_dash_in_open():
    df = _parse_ind_close(SAMPLE).set_index("index_name")
    assert df.loc["NIFTY METAL", "open"] != df.loc["NIFTY METAL", "open"]  # NaN
    assert df.loc["NIFTY METAL", "close"] == 12999.05


def test_every_dashboard_sector_has_a_source():
    from backend.routes.macro import SECTOR_INDICES
    sources = set(INDICES) | set(NSE_INDICES)
    assert set(SECTOR_INDICES) <= sources
    assert not set(INDICES) & set(NSE_INDICES)  # no index fetched from both


class _Resp:
    def __init__(self, status_code, text=""):
        self.status_code, self.text = status_code, text

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class _Client:
    def __init__(self, responses):
        self.responses = responses  # ddmmyyyy -> _Resp

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, url):
        return self.responses[url.rsplit("_", 1)[1].removesuffix(".csv")]


def _run_sectoral(monkeypatch, statuses):
    """Run _run_nse_sectoral over the days in `statuses` (date -> HTTP code); return the log_sync call."""
    from backend.data_sync import sync_indices as si

    days = sorted(statuses)
    responses = {d.strftime("%d%m%Y"): _Resp(code, SAMPLE.replace("18-09-2026", d.strftime("%d-%m-%Y")))
                 for d, code in statuses.items()}
    logged = {}
    monkeypatch.setattr(si, "last_synced_date", lambda _: date(2026, 9, 11))
    monkeypatch.setattr(si, "business_days_between", lambda *_: days)
    monkeypatch.setattr(si, "last_business_day", lambda _: days[-1])
    monkeypatch.setattr(si, "get_client", lambda: _Client(responses))
    monkeypatch.setattr(si, "upsert_df", lambda df, _: len(df))
    monkeypatch.setattr(si, "log_sync", lambda *a: logged.update(args=a))
    si._run_nse_sectoral()
    return logged["args"]


def test_bookmark_stops_before_mid_batch_failure(monkeypatch):
    source, status, count, bookmark, error = _run_sectoral(monkeypatch, {
        date(2026, 9, 14): 200, date(2026, 9, 15): 500,
        date(2026, 9, 16): 200, date(2026, 9, 17): 200,
    })
    assert bookmark == date(2026, 9, 14)  # 15th is retried next run
    assert status == "partial" and "2026-09-15" in error
    assert count == 3 * len(NSE_INDICES)  # rows after the gap are still saved


def test_bookmark_skips_holidays_without_failing(monkeypatch):
    source, status, count, bookmark, error = _run_sectoral(monkeypatch, {
        date(2026, 9, 14): 200, date(2026, 9, 15): 404, date(2026, 9, 16): 200,
    })
    assert bookmark == date(2026, 9, 16)
    assert status == "success" and error is None


def test_bookmark_unchanged_when_first_day_fails(monkeypatch):
    source, status, count, bookmark, error = _run_sectoral(monkeypatch, {
        date(2026, 9, 14): 503, date(2026, 9, 15): 200,
    })
    assert bookmark == date(2026, 9, 11)  # previous bookmark kept
    assert status == "partial"
