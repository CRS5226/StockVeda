"""
Unsupervised stock clustering — group a user-picked set of symbols by trend/
momentum character (KMeans / Agglomerative / DBSCAN), not the per-bar
classification/regression modes in ml_backtest.py. One feature row per stock,
summarizing its trailing window, not one row per bar.

Descriptive grouping only — no causal claim about *why* stocks cluster together.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from backend.core.ml_backtest import build_features

# Trend/momentum/volatility summary columns — last value of build_features()'s
# per-bar indicators over the trailing lookback window, plus realized volatility
# (not in ML_FEATURES, which is built for per-bar pooling, not per-stock summary).
CLUSTER_FEATURES = [
    "ret_5", "ret_10", "rsi_14", "adx_14", "atr_pct",
    "volume_ratio", "dist_sma50", "dist_sma200", "dist_ema20", "bb_pos",
]

MIN_SYMBOLS = 4


def build_stock_feature_vectors(frames: dict[str, pd.DataFrame], lookback_days: int = 60) -> pd.DataFrame:
    """One row per symbol, indexed by symbol. Drops symbols with too little
    history or unresolved (NaN) indicators at the most recent bar."""
    rows: dict[str, dict[str, float]] = {}
    for sym, frame in frames.items():
        if len(frame) < lookback_days:
            continue
        feat = build_features(frame).tail(lookback_days)
        last = feat.iloc[-1]
        if last[CLUSTER_FEATURES].isna().any():
            continue
        row = {c: float(last[c]) for c in CLUSTER_FEATURES}
        row["realized_vol"] = float(feat["close"].pct_change().std() * 100)
        rows[sym] = row
    return pd.DataFrame.from_dict(rows, orient="index")


@dataclass
class ClusteringResult:
    error: str | None
    clusters: dict[str, int]
    pca: dict[str, list[float]]
    feature_cols: list[str]
    n_clusters: int | None = None
    noise_count: int | None = None


def run_clustering(feature_df: pd.DataFrame, algo: str, k: int = 3,
                    eps: float = 1.5, min_samples: int = 2) -> ClusteringResult:
    feature_cols = list(feature_df.columns)
    if len(feature_df) < MIN_SYMBOLS:
        return ClusteringResult(
            error=f"Need at least {MIN_SYMBOLS} symbols with enough history ({len(feature_df)} usable). Pick more stocks.",
            clusters={}, pca={}, feature_cols=feature_cols,
        )

    from sklearn.preprocessing import StandardScaler
    from sklearn.decomposition import PCA

    X = StandardScaler().fit_transform(feature_df.to_numpy(dtype=float))
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

    return ClusteringResult(error=None, clusters=clusters, pca=pca, feature_cols=feature_cols,
                             n_clusters=n_clusters, noise_count=noise_count)
