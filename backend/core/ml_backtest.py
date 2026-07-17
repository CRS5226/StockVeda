"""
ML-based entry classification (meta-labeling) for the backtester.

Framing (classification-first, quant-standard):
  * Sample bars where a base strategy setup fires (meta-labeling) or every bar.
  * Label each sample with a triple-barrier outcome using the SAME target/SL/max-bars
    semantics as run_backtest_v2 — 1 if close hits +target% before −sl% within max_bars,
    else 0 (SL-first or timeout). Samples whose window is truncated by data-end are dropped.
  * Train a classifier on a chronological TRAIN split, predict P(win) on the held-out
    TEST split, and simulate trades on TEST where P(win) ≥ threshold — reusing the exact
    engine trade loop so trade shape/stats match the rest of the app.
  * A no-ML baseline (enter at every eligible test bar) is the "does ML add value?" row.

Leakage guards: chronological split (no shuffle); a train sample whose label window
would reach into the test period is purged.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from backend.core.backtest_engine import (
    BacktestParamsV2,
    _eval_conditions,
    _run_trades,
)
from backend.core.indicators import add_indicators

ML_MODELS = [
    {"id": "logreg", "label": "Logistic Regression"},
    {"id": "dtree",  "label": "Decision Tree"},
    {"id": "rf",     "label": "Random Forest"},
    {"id": "svm",    "label": "SVM (RBF)"},
    {"id": "xgb",    "label": "XGBoost"},
]
ML_MODEL_IDS = {m["id"] for m in ML_MODELS}
_ML_LABELS = {m["id"]: m["label"] for m in ML_MODELS}

# Symbol-agnostic features only (ratios / oscillators / % distances) so samples
# can be pooled across symbols.
ML_FEATURES = [
    "rsi_14", "adx_14", "willr", "cci", "stoch_k", "stoch_d", "volume_ratio",
    "atr_pct", "macd_hist_pct",
    "dist_sma20", "dist_sma50", "dist_sma200", "dist_ema20", "dist_ema50",
    "bb_pos", "ret_1", "ret_5", "ret_10",
    "cdl_hammer", "cdl_bull_engulf", "cdl_pin_bar_bull",
]

MIN_TRAIN_SAMPLES = 50


def build_features(frame: pd.DataFrame) -> pd.DataFrame:
    """Augment a prepared frame with the ML feature columns. Adds stoch/willr/cci
    (not in the standard backtest indicator set) then derives % / ratio features."""
    frame = add_indicators(frame, ["stoch", "willr", "cci"])
    close = frame["close"].astype(float)

    def _safe_div(a, b):
        return a / b.replace(0, np.nan)

    if "atr_14" in frame:
        frame["atr_pct"] = _safe_div(frame["atr_14"], close) * 100
    if "macd_hist" in frame:
        frame["macd_hist_pct"] = _safe_div(frame["macd_hist"], close) * 100
    for p in (20, 50, 200):
        col = f"sma_{p}"
        if col in frame:
            frame[f"dist_sma{p}"] = (_safe_div(close, frame[col]) - 1) * 100
    for p in (20, 50):
        col = f"ema_{p}"
        if col in frame:
            frame[f"dist_ema{p}"] = (_safe_div(close, frame[col]) - 1) * 100
    if "bb_upper" in frame and "bb_lower" in frame:
        width = (frame["bb_upper"] - frame["bb_lower"]).replace(0, np.nan)
        frame["bb_pos"] = (close - frame["bb_lower"]) / width
    frame["ret_1"] = close.pct_change(1) * 100
    frame["ret_5"] = close.pct_change(5) * 100
    frame["ret_10"] = close.pct_change(10) * 100
    return frame


@dataclass
class MlDataset:
    X_train: np.ndarray
    y_train: np.ndarray
    X_test: np.ndarray
    y_test: np.ndarray
    features: list[str]
    test_meta: list[tuple[str, int]]          # aligned to X_test rows: (symbol, local test-slice index)
    test_candidates: dict[str, list[int]]      # symbol -> local test-slice indices of all eligible bars
    split_idx: dict[str, int]                  # symbol -> train/test boundary index in the full frame
    split_dates: dict[str, str]
    train_period: dict | None = None           # {"start", "end"} date span of train bars (across symbols)
    test_period: dict | None = None            # {"start", "end"} date span of test bars
    error: str | None = None


def build_dataset(
    frames: dict[str, pd.DataFrame],
    entry_conditions: list,
    sample_mode: str,
    target_pct: float,
    sl_pct: float,
    max_bars: int,
    train_ratio: float,
) -> MlDataset:
    Xtr, ytr, Xte, yte = [], [], [], []
    test_meta: list[tuple[str, int]] = []
    test_candidates: dict[str, list[int]] = {}
    split_idx: dict[str, int] = {}
    split_dates: dict[str, str] = {}
    tr_starts, tr_ends, te_starts, te_ends = [], [], [], []

    for sym, frame in frames.items():
        n = len(frame)
        if n < 60:
            continue
        k = int(n * train_ratio)
        split_idx[sym] = k
        if k < n:
            split_dates[sym] = str(frame.iloc[k]["date"])
        # Track the calendar span of the train and test slices (for the UI timeline).
        if k > 0:
            tr_starts.append(str(frame.iloc[0]["date"]))
            tr_ends.append(str(frame.iloc[k - 1]["date"]))
        if k < n:
            te_starts.append(str(frame.iloc[k]["date"]))
            te_ends.append(str(frame.iloc[n - 1]["date"]))
        test_candidates[sym] = []

        close = frame["close"].to_numpy(dtype=float)
        feat_ok = frame[ML_FEATURES].notna().all(axis=1).to_numpy()
        if sample_mode == "entry_signals":
            base = _eval_conditions(frame, entry_conditions).to_numpy()
        else:
            base = np.ones(n, dtype=bool)

        feat_matrix = frame[ML_FEATURES].to_numpy(dtype=float)

        for i in range(n):
            if not (base[i] and feat_ok[i]):
                continue
            end = min(i + max_bars, n - 1)
            if end <= i:
                continue
            entry = close[i]
            up = entry * (1 + target_pct / 100)
            dn = entry * (1 - sl_pct / 100)
            label = None
            for j in range(i + 1, end + 1):
                if close[j] >= up:
                    label = 1
                    break
                if close[j] <= dn:
                    label = 0
                    break
            window_len = end - i
            if label is None:
                if window_len < max_bars:
                    continue          # truncated by data end → unresolved, drop
                label = 0             # full window, no barrier → timeout = loss
            # Purge train samples whose label window peeks into the test period.
            if i < k and (i + max_bars) >= k:
                continue

            feat = feat_matrix[i]
            if i < k:
                Xtr.append(feat)
                ytr.append(label)
            else:
                Xte.append(feat)
                yte.append(label)
                local = i - k
                test_meta.append((sym, local))
                test_candidates[sym].append(local)

    ds = MlDataset(
        X_train=np.array(Xtr, dtype=float) if Xtr else np.empty((0, len(ML_FEATURES))),
        y_train=np.array(ytr, dtype=int),
        X_test=np.array(Xte, dtype=float) if Xte else np.empty((0, len(ML_FEATURES))),
        y_test=np.array(yte, dtype=int),
        features=list(ML_FEATURES),
        test_meta=test_meta,
        test_candidates=test_candidates,
        split_idx=split_idx,
        split_dates=split_dates,
        train_period={"start": min(tr_starts), "end": max(tr_ends)} if tr_starts else None,
        test_period={"start": min(te_starts), "end": max(te_ends)} if te_starts else None,
    )
    if len(ds.y_train) < MIN_TRAIN_SAMPLES:
        ds.error = f"Not enough training samples ({len(ds.y_train)} < {MIN_TRAIN_SAMPLES}). Add symbols or widen the date range."
    elif len(np.unique(ds.y_train)) < 2:
        ds.error = "Training labels are single-class (all win or all loss) — cannot train. Adjust target/SL or the base setup."
    return ds


def make_model(model_id: str, scale_pos_weight: float = 1.0):
    """Estimator factory. xgboost is imported lazily so the app boots without it."""
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    from sklearn.linear_model import LogisticRegression
    from sklearn.tree import DecisionTreeClassifier
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.svm import SVC

    if model_id == "logreg":
        return make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000, class_weight="balanced"))
    if model_id == "dtree":
        return DecisionTreeClassifier(max_depth=5, class_weight="balanced", random_state=42)
    if model_id == "rf":
        return RandomForestClassifier(n_estimators=300, max_depth=6, class_weight="balanced",
                                      n_jobs=-1, random_state=42)
    if model_id == "svm":
        return make_pipeline(StandardScaler(), SVC(kernel="rbf", probability=True,
                                                   class_weight="balanced", random_state=42))
    if model_id == "xgb":
        from xgboost import XGBClassifier
        return XGBClassifier(n_estimators=300, max_depth=4, learning_rate=0.05,
                             subsample=0.9, colsample_bytree=0.9, eval_metric="logloss",
                             scale_pos_weight=scale_pos_weight, n_jobs=-1, random_state=42)
    raise ValueError(f"Unknown model id: {model_id}")


def _feature_importance(model, features: list[str]) -> list[dict] | None:
    est = model[-1] if hasattr(model, "steps") else model
    if hasattr(est, "feature_importances_"):
        vals = np.abs(np.asarray(est.feature_importances_, dtype=float))
    elif hasattr(est, "coef_"):
        vals = np.abs(np.asarray(est.coef_, dtype=float)).ravel()
    else:
        return None
    total = vals.sum()
    if total > 0:
        vals = vals / total
    pairs = sorted(zip(features, vals), key=lambda kv: kv[1], reverse=True)
    return [{"feature": f, "importance": round(float(v), 4)} for f, v in pairs]


def _pool_stats(trades: list[dict]) -> dict:
    total = len(trades)
    winners = [t for t in trades if t["pnl"] > 0]
    return {
        "total_trades": total,
        "win_rate_pct": round(len(winners) / total * 100, 1) if total else 0.0,
        "total_pnl": round(sum(t["pnl"] for t in trades), 2),
        "avg_pnl_pct": round(sum(t["pnl_pct"] for t in trades) / total, 2) if total else 0.0,
    }


def _simulate_signals(frames, split_idx, sym_signal_positions, base_params) -> tuple[dict, dict]:
    """Run the engine trade loop on each symbol's test slice, entering only at the
    given local positions. Returns (per_symbol, pooled_stats)."""
    per_symbol: dict = {}
    all_trades: list[dict] = []
    for sym, frame in frames.items():
        k = split_idx.get(sym)
        if k is None:
            continue
        test_slice = frame.iloc[k:].reset_index(drop=True)
        if len(test_slice) < 2:
            continue
        sig = np.zeros(len(test_slice), dtype=bool)
        for local in sym_signal_positions.get(sym, []):
            if 0 <= local < len(test_slice):
                sig[local] = True
        signal = pd.Series(sig, index=test_slice.index)
        trades, stats = _run_trades(test_slice, signal, None, base_params)
        per_symbol[sym] = {"trades": trades, "stats": stats}
        all_trades.extend(trades)
    return per_symbol, _pool_stats(all_trades)


def _classification_metrics(y_true, proba) -> dict:
    from sklearn.metrics import (accuracy_score, precision_score, recall_score,
                                 f1_score, roc_auc_score)
    preds = (proba >= 0.5).astype(int)
    auc = None
    if len(np.unique(y_true)) > 1:
        auc = round(float(roc_auc_score(y_true, proba)), 3)
    return {
        "accuracy":  round(float(accuracy_score(y_true, preds)), 3),
        "precision": round(float(precision_score(y_true, preds, zero_division=0)), 3),
        "recall":    round(float(recall_score(y_true, preds, zero_division=0)), 3),
        "f1":        round(float(f1_score(y_true, preds, zero_division=0)), 3),
        "roc_auc":   auc,
    }


def _confusion(y_true, proba) -> dict:
    from sklearn.metrics import confusion_matrix
    preds = (proba >= 0.5).astype(int)
    cm = confusion_matrix(y_true, preds, labels=[0, 1])
    return {"tn": int(cm[0, 0]), "fp": int(cm[0, 1]), "fn": int(cm[1, 0]), "tp": int(cm[1, 1])}


def train_and_evaluate(model_id: str, ds: MlDataset, frames, base_params: BacktestParamsV2,
                       prob_threshold: float) -> dict:
    label = _ML_LABELS.get(model_id, model_id)
    _err = lambda msg: {"label": label, "error": msg, "train_metrics": None, "test_metrics": None,
                        "confusion": None, "stats": None, "per_symbol": {}, "feature_importance": None}
    try:
        pos = int((ds.y_train == 1).sum())
        neg = int((ds.y_train == 0).sum())
        spw = (neg / pos) if pos else 1.0
        model = make_model(model_id, scale_pos_weight=spw)
        model.fit(ds.X_train, ds.y_train)
        proba_train = model.predict_proba(ds.X_train)[:, 1]
        proba = model.predict_proba(ds.X_test)[:, 1]
    except ImportError:
        return _err("xgboost not installed on the server.")
    except Exception as e:
        return _err(str(e))

    train_metrics = _classification_metrics(ds.y_train, proba_train)
    test_metrics = _classification_metrics(ds.y_test, proba)
    confusion = {"train": _confusion(ds.y_train, proba_train), "test": _confusion(ds.y_test, proba)}

    # Trade simulation: enter at test bars where P(win) >= threshold.
    sym_positions: dict[str, list[int]] = {}
    for (sym, local), p in zip(ds.test_meta, proba):
        if p >= prob_threshold:
            sym_positions.setdefault(sym, []).append(local)

    per_symbol, stats = _simulate_signals(frames, ds.split_idx, sym_positions, base_params)
    return {
        "label": label,
        "error": None,
        "train_metrics": train_metrics,
        "test_metrics": test_metrics,
        "confusion": confusion,
        "stats": stats,
        "per_symbol": per_symbol,
        "feature_importance": _feature_importance(model, ds.features),
    }


def run_baseline(ds: MlDataset, frames, base_params: BacktestParamsV2) -> dict:
    """Base strategy with NO ML filter — enter at every eligible test bar."""
    _, stats = _simulate_signals(frames, ds.split_idx, ds.test_candidates, base_params)
    return {"stats": stats}
