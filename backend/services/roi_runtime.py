from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import torch

from .validators import BUNDLE_ROOT, MODEL_SELECTION, SUPPORTED_CONDITIONS, TIME_GRID, validate_condition

BUNDLE_CODE = BUNDLE_ROOT / "code"
if str(BUNDLE_CODE) not in sys.path:
    sys.path.insert(0, str(BUNDLE_CODE))

from model_defs import build_condition_model  # noqa: E402


@dataclass
class LoadedModel:
    injector_id: str
    paper_label: str
    code_model_id: str
    model: torch.nn.Module
    norm: dict[str, np.ndarray]
    seq_len: int
    checkpoint_dir: Path
    model_label: str


class RoiRuntime:
    def __init__(self) -> None:
        self.bundle_root = BUNDLE_ROOT
        self.model_selection = MODEL_SELECTION
        self.supported_conditions = SUPPORTED_CONDITIONS
        self.time_grid = np.linspace(
            float(TIME_GRID["grid_start_us"]),
            float(TIME_GRID["grid_end_us"]),
            int(TIME_GRID["target_len"]),
            dtype=np.float32,
        )
        self._cache: dict[str, LoadedModel] = {}

    def preload_all(self) -> None:
        for injector_id in self.model_selection:
            self._load_model(injector_id)

    def health_payload(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "bundle_name": json.loads((self.bundle_root / "metadata" / "bundle_manifest.json").read_text(encoding="utf-8"))["bundle_name"],
            "loaded_models": sorted(self._cache.keys()),
            "supported_injectors": sorted(self.model_selection.keys()),
        }

    def get_supported_conditions_payload(self) -> dict[str, Any]:
        from .validators import supported_conditions_payload

        return supported_conditions_payload()

    def _load_norm(self, path: Path) -> dict[str, np.ndarray]:
        payload = json.loads(path.read_text(encoding="utf-8"))
        out: dict[str, np.ndarray] = {}
        for key in ("x_mean", "x_std", "y_mean", "y_std"):
            if key in payload:
                out[key] = np.asarray(payload[key], dtype=np.float32)
        return out

    def _load_model(self, injector_id: str) -> LoadedModel:
        injector_id = str(injector_id)
        if injector_id in self._cache:
            return self._cache[injector_id]

        meta = self.model_selection[injector_id]
        checkpoint_dir = self.bundle_root / "models" / f"inj{injector_id}" / meta["paper_label"]
        cfg = json.loads((checkpoint_dir / "config.json").read_text(encoding="utf-8"))
        seq_len = int(cfg.get("target_len", self.time_grid.size))
        model = build_condition_model(str(meta["code_model_id"]), seq_len=seq_len)
        state = torch.load(checkpoint_dir / "model.pt", map_location="cpu")
        model.load_state_dict(state)
        model.eval()
        norm = self._load_norm(checkpoint_dir / "norm.json")

        loaded = LoadedModel(
            injector_id=injector_id,
            paper_label=meta["paper_label"],
            code_model_id=str(meta["code_model_id"]),
            model=model,
            norm=norm,
            seq_len=seq_len,
            checkpoint_dir=checkpoint_dir,
            model_label=meta["paper_label"],
        )
        self._cache[injector_id] = loaded
        return loaded

    @staticmethod
    def _summarize(time_us: np.ndarray, roi: np.ndarray) -> dict[str, float]:
        y = np.asarray(roi, dtype=np.float32).reshape(-1)
        t = np.asarray(time_us, dtype=np.float32).reshape(-1)
        peak_index = int(np.argmax(y))
        peak_value = float(y[peak_index])
        peak_time = float(t[peak_index])
        t_ms = t / 1000.0
        area_mg = float(np.trapz(y, t_ms))
        dt_us = float(np.mean(np.diff(t))) if t.size > 1 else 0.0
        half_threshold = peak_value * 0.5
        tenth_threshold = peak_value * 0.1
        duration_half_us = float(np.sum(y >= half_threshold) * dt_us) if peak_value > 0 else 0.0
        duration_tenth_us = float(np.sum(y >= tenth_threshold) * dt_us) if peak_value > 0 else 0.0
        return {
            "peak_roi_mg_per_ms": peak_value,
            "peak_time_us": peak_time,
            "roi_area_mg": area_mg,
            "duration_above_half_peak_us": duration_half_us,
            "duration_above_10pct_peak_us": duration_tenth_us,
            "mean_roi_mg_per_ms": float(np.mean(y)),
        }

    def predict(self, injector_id: Any, pressure_bar: float, temp_c: float, et_us: float) -> dict[str, Any]:
        normalized = validate_condition(injector_id, pressure_bar, temp_c, et_us)
        loaded = self._load_model(normalized["injector_id"])
        x = np.asarray([normalized["pressure_bar"], normalized["temp_c"], normalized["et_us"]], dtype=np.float32)
        x = (x - loaded.norm["x_mean"]) / np.maximum(loaded.norm["x_std"], 1e-6)
        x_t = torch.tensor(x, dtype=torch.float32).unsqueeze(0)

        with torch.inference_mode():
            pred = loaded.model(x_t)
            if pred.dim() == 3:
                pred = pred.squeeze(1)
            pred = pred * float(loaded.norm["y_std"].reshape(-1)[0]) + float(loaded.norm["y_mean"].reshape(-1)[0])
            roi = pred.detach().cpu().numpy().reshape(-1)

        summary = self._summarize(self.time_grid, roi)
        return {
            "injector_id": normalized["injector_id"],
            "model_label": loaded.paper_label,
            "model_id": loaded.code_model_id,
            "input": normalized,
            "time_us": self.time_grid.tolist(),
            "roi_mg_per_ms": roi.tolist(),
            "summary": summary,
        }

    def predict_batch(self, cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for idx, case in enumerate(cases):
            case_id = case.get("case_id") or case.get("id") or f"case_{idx + 1}"
            try:
                result = self.predict(
                    case["injector_id"],
                    case["pressure_bar"],
                    case["temp_c"],
                    case["et_us"],
                )
                results.append({"case_id": case_id, "ok": True, "result": result})
            except Exception as exc:  # noqa: BLE001
                results.append({"case_id": case_id, "ok": False, "error": str(exc)})
        return results
