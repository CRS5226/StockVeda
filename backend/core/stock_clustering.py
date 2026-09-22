"""
Unsupervised stock clustering — group a user-picked set of symbols by trend/
momentum character AND value/quality character (KMeans / Agglomerative /
DBSCAN), not the per-bar classification/regression modes in ml_backtest.py.
One feature row per stock, summarizing its trailing window, not one row per bar.

Descriptive grouping only — no causal claim about *why* stocks cluster together,
and no fixed "good to buy" score. The value/quality features are exposed so a
cluster that's visibly cheap + high-ROE + trending stands out on its own, but
which features to include (and how to read the result) is the user's call —
see the feature picker on the frontend.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from backend.core.ml_backtest import build_features

# Trend/momentum/volatility — last value of build_features()'s per-bar indicators
# over the trailing lookback window, plus realized volatility (not in ML_FEATURES,
# which is built for per-bar pooling, not per-stock summary).
TREND_FEATURES = [
    "ret_5", "ret_10", "rsi_14", "adx_14", "atr_pct",
    "volume_ratio", "dist_sma50", "dist_sma200", "dist_ema20", "bb_pos", "realized_vol",
]

# Value/quality — computed the same way the Screener does (screener_engine.py),
# from the local stock_fundamentals table. No new data source, no live API calls.
FUNDAMENTAL_FEATURES = ["pe_ratio", "debt_to_equity", "roe_pct", "revenue_growth_pct"]

ALL_CLUSTER_FEATURES = TREND_FEATURES + FUNDAMENTAL_FEATURES

MIN_SYMBOLS = 4


def build_stock_feature_vectors(frames: dict[str, pd.DataFrame], lookback_days: int = 60) -> pd.DataFrame:
    """One row per symbol, indexed by symbol — trend/momentum columns only.
    Drops symbols with too little history or unresolved (NaN) indicators at
    the most recent bar."""
    rows: dict[str, dict[str, float]] = {}
    for sym, frame in frames.items():
        if len(frame) < lookback_days:
            continue
        feat = build_features(frame).tail(lookback_days)
        last = feat.iloc[-1]
        trend_cols = [c for c in TREND_FEATURES if c != "realized_vol"]
        if last[trend_cols].isna().any():
            continue
        row = {c: float(last[c]) for c in trend_cols}
        row["realized_vol"] = float(feat["close"].pct_change().std() * 100)
        rows[sym] = row
    return pd.DataFrame.from_dict(rows, orient="index")


def build_fundamental_features(db, symbols: list[str], last_close: dict[str, float]) -> pd.DataFrame:
    """One row per symbol, indexed by symbol — value/quality columns, from the
    two most recent reported quarters already synced locally. PE and D/E use
    the exact same formulas as backend/core/screener_engine.py for consistency
    with the rest of the app. ROE is annualized (quarterly PAT x4) since
    ML_FEATURES/screener_engine don't already expose a ROE proxy."""
    if not symbols:
        return pd.DataFrame(columns=FUNDAMENTAL_FEATURES)

    placeholders = ",".join(["?"] * len(symbols))
    rows = db.execute(
        f"""
        SELECT symbol, period, pat, eps_basic, total_debt, total_equity, revenue
        FROM stock_fundamentals
        WHERE symbol IN ({placeholders}) AND period_type = 'Q'
        ORDER BY symbol, period DESC
        """,
        symbols,
    ).fetchdf()

    out: dict[str, dict[str, float]] = {}
    for sym, g in rows.groupby("symbol"):
        g = g.reset_index(drop=True)
        if g.empty:
            continue
        latest = g.iloc[0]
        close = last_close.get(sym)

        pe = np.nan
        if close and latest["eps_basic"] and latest["eps_basic"] > 0:
            pe = close / latest["eps_basic"]

        de = np.nan
        roe = np.nan
        if latest["total_equity"] and latest["total_equity"] > 0:
            if latest["total_debt"] is not None:
                de = latest["total_debt"] / latest["total_equity"]
            if latest["pat"] is not None:
                roe = (latest["pat"] * 4) / latest["total_equity"] * 100

        rev_growth = np.nan
        if len(g) > 1 and latest["revenue"] and g.iloc[1]["revenue"]:
            prev_rev = g.iloc[1]["revenue"]
            rev_growth = (latest["revenue"] - prev_rev) / abs(prev_rev) * 100

        out[sym] = {"pe_ratio": pe, "debt_to_equity": de, "roe_pct": roe, "revenue_growth_pct": rev_growth}

    return pd.DataFrame.from_dict(out, orient="index")


@dataclass
class ClusteringResult:
    error: str | None
    clusters: dict[str, int]
    pca: dict[str, list[float]]
    feature_cols: list[str]
    n_clusters: int | None = None
    noise_count: int | None = None
    cluster_summary: dict[int, dict[str, float]] | None = None  # cluster id -> {feature: mean}


def run_clustering(combined_features: pd.DataFrame, feature_cols: list[str], algo: str, k: int = 3,
                    eps: float = 1.5, min_samples: int = 2) -> ClusteringResult:
    unknown = [c for c in feature_cols if c not in ALL_CLUSTER_FEATURES]
    if unknown:
        return ClusteringResult(error=f"Unknown feature(s): {unknown}", clusters={}, pca={}, feature_cols=feature_cols)

    feature_df = combined_features[feature_cols].dropna()
    if len(feature_df) < MIN_SYMBOLS:
        return ClusteringResult(
            error=f"Need at least {MIN_SYMBOLS} symbols with usable data for the selected features "
                  f"({len(feature_df)} usable). Pick more stocks or deselect a feature with sparse data.",
            clusters={}, pca={}, feature_cols=feature_cols,
        )

    from sklearn.preprocessing import RobustScaler
    from sklearn.decomposition import PCA

    # RobustScaler (median/IQR), not StandardScaler — pe_ratio/debt_to_equity can
    # have extreme outliers (e.g. a near-zero-earnings company showing PE > 500)
    # that would otherwise dominate the distance metric.
    X = RobustScaler().fit_transform(feature_df.to_numpy(dtype=float))
    n = len(feature_df)

    if algo == "kmeans":
        from sklearn.cluster import KMeans
        model = KMeans(n_clusters=max(1, min(k, n)), n_init=10, random_state=42)
        labels = model.fit_predict(X)
    elif algo == "hierarchical":
        from sklearn.cluster import AgglomerativeClustering
        model = AgglomerativeClustering(n_clusters=max(1, min(k, n)))
        labels = model.fit_predict(X)
    elif algo == "dbscan":
        from sklearn.cluster import DBSCAN
        model = DBSCAN(eps=eps, min_samples=min_samples)
        labels = model.fit_predict(X)
    else:
        return ClusteringResult(error=f"Unknown algorithm: {algo}", clusters={}, pca={}, feature_cols=feature_cols)

    coords = PCA(n_components=2, random_state=42).fit_transform(X)

    symbols = list(feature_df.index)
    clusters = {sym: int(lbl) for sym, lbl in zip(symbols, labels)}
    pca = {sym: [round(float(c[0]), 4), round(float(c[1]), 4)] for sym, c in zip(symbols, coords)}
    noise_count = int((labels == -1).sum()) if algo == "dbscan" else None
    n_clusters = len(set(labels) - {-1})

    summary_df = feature_df.copy()
    summary_df["_cluster"] = labels
    cluster_summary = {
        int(cid): {col: round(float(v), 4) for col, v in row.items()}
        for cid, row in summary_df.groupby("_cluster")[feature_cols].mean().iterrows()
    }

    return ClusteringResult(error=None, clusters=clusters, pca=pca, feature_cols=feature_cols,
                             n_clusters=n_clusters, noise_count=noise_count, cluster_summary=cluster_summary)
