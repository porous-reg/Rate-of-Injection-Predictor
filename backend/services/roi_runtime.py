from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from .validators import MODEL_METADATA, SUPPORTED_DURATION_RANGE, SUPPORTED_PRESSURE_RANGE, validate_request


ROOT_DIR = Path(__file__).resolve().parents[2]
MODEL_ROOT = ROOT_DIR / "Model"
CHECKPOINT_PATH = MODEL_ROOT / "best_model_ModelB.pth"
SCALER_X_PATH = MODEL_ROOT / "scaler_X.pkl"
SCALER_Y_PATH = MODEL_ROOT / "scaler_y.pkl"
SURFACE_PATH = MODEL_ROOT / "mass_smooth_surface.npz"


@dataclass
class LoadedModel:
    model: Any
    scaler_x: Any
    scaler_y: Any
    low_res_len: int
    out_len: int
    time_us: np.ndarray
def _build_pdnn_model(torch_mod: Any, hidden: list[int], low_res_len: int) -> Any:
    class PdnnModel(torch_mod.nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.base = torch_mod.nn.Sequential(
                torch_mod.nn.Linear(2, hidden[0]),
                torch_mod.nn.ReLU(),
                torch_mod.nn.Linear(hidden[0], hidden[1]),
                torch_mod.nn.ReLU(),
                torch_mod.nn.Linear(hidden[1], hidden[2]),
                torch_mod.nn.ReLU(),
                torch_mod.nn.Linear(hidden[2], low_res_len),
            )

        def forward(self, x: Any) -> Any:  # type: ignore[override]
            return self.base(x)

    return PdnnModel()


class RoiRuntime:
    def __init__(self) -> None:
        self.model_metadata = MODEL_METADATA
        self.pressure_range = SUPPORTED_PRESSURE_RANGE
        self.duration_range = SUPPORTED_DURATION_RANGE
        self._cache: LoadedModel | None = None

    def health_payload(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "bundle_name": self.model_metadata["bundle_name"],
            "model_kind": self.model_metadata["model_kind"],
            "fixed_context": self.model_metadata["fixed_context"],
            "supported_pressure_range_bar": list(self.pressure_range),
            "supported_duration_range_us": list(self.duration_range),
            "output_points": self.model_metadata["output"]["length"],
            "bundle_load_errors": self.model_metadata.get("bundle_load_errors", []),
        }

    def get_supported_conditions_payload(self) -> dict[str, Any]:
        return {
            "bundle_name": self.model_metadata["bundle_name"],
            "purpose": self.model_metadata["purpose"],
            "fixed_context": self.model_metadata["fixed_context"],
            "supported_pressure_range_bar": list(self.pressure_range),
            "supported_duration_range_us": list(self.duration_range),
            "pressure_grid": self.model_metadata.get("pressure_grid", []),
            "duration_grid": self.model_metadata.get("duration_grid", []),
            "output": self.model_metadata["output"],
            "future_extension_note": self.model_metadata.get("future_extension_note", ""),
            "bundle_load_errors": self.model_metadata.get("bundle_load_errors", []),
        }

    @staticmethod
    def _load_scaler(path: Path) -> Any:
        import joblib

        return joblib.load(path)

    @staticmethod
    def _load_torch() -> Any:
        import torch

        return torch

    @staticmethod
    def _catmull_rom_resample(values: np.ndarray, target_len: int) -> np.ndarray:
        values = np.asarray(values, dtype=np.float32).reshape(-1)
        if values.size == target_len:
            return values.copy()
        if values.size < 2:
            return np.full(target_len, float(values[0]) if values.size else 0.0, dtype=np.float32)
        x_new = np.linspace(0.0, float(values.size - 1), target_len, dtype=np.float32)
        i = np.floor(x_new).astype(np.int32)
        t = x_new - i
        i0 = np.clip(i - 1, 0, values.size - 1)
        i1 = np.clip(i, 0, values.size - 1)
        i2 = np.clip(i + 1, 0, values.size - 1)
        i3 = np.clip(i + 2, 0, values.size - 1)
        p0 = values[i0]
        p1 = values[i1]
        p2 = values[i2]
        p3 = values[i3]
        out = 0.5 * (
            (2.0 * p1)
            + (-p0 + p2) * t
            + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * (t**2)
            + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * (t**3)
        )
        return out.astype(np.float32)

    def _load_time_grid(self, out_len: int) -> np.ndarray:
        surface = np.load(SURFACE_PATH, allow_pickle=True)
        t_start = float(surface["t_start_s"]) * 1_000_000.0
        t_end = float(surface["t_end_s"]) * 1_000_000.0
        dt = float(surface["dt_int_s"]) * 1_000_000.0
        grid = np.arange(t_start, t_end, dt, dtype=np.float32)
        if grid.size != out_len:
            grid = np.linspace(t_start, t_end, out_len, endpoint=False, dtype=np.float32)
        return grid

    def _load_model(self) -> LoadedModel:
        if self._cache is not None:
            return self._cache

        torch = self._load_torch()
        checkpoint = torch.load(CHECKPOINT_PATH, map_location="cpu")
        state_dict = checkpoint["model_state_dict"]
        hidden = list(checkpoint.get("config", {}).get("hidden", [256, 256, 256]))
        low_res_len = int(state_dict["base.6.weight"].shape[0])
        out_len = int(checkpoint.get("config", {}).get("out_len", 7500))

        model = _build_pdnn_model(torch, hidden, low_res_len)
        model.load_state_dict(state_dict)
        model.eval()

        loaded = LoadedModel(
            model=model,
            scaler_x=self._load_scaler(SCALER_X_PATH),
            scaler_y=self._load_scaler(SCALER_Y_PATH),
            low_res_len=low_res_len,
            out_len=out_len,
            time_us=self._load_time_grid(out_len),
        )
        self._cache = loaded
        return loaded

    @staticmethod
    def _summarize(time_us: np.ndarray, roi: np.ndarray) -> dict[str, float]:
        y = np.asarray(roi, dtype=np.float32).reshape(-1)
        t = np.asarray(time_us, dtype=np.float32).reshape(-1)
        peak_index = int(np.argmax(y))
        peak_value = float(y[peak_index])
        peak_time = float(t[peak_index])
        area_mg = float(np.trapz(y, t / 1000.0))
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

    def predict(self, pressure_bar: float, duration_us: float) -> dict[str, Any]:
        request = validate_request(pressure_bar, duration_us)
        loaded = self._load_model()
        torch = self._load_torch()

        features = np.array([request["pressure_bar"], math.log(request["duration_us"])], dtype=np.float32)
        x = loaded.scaler_x.transform(features.reshape(1, -1)).astype(np.float32)
        x_t = torch.tensor(x, dtype=torch.float32)

        with torch.inference_mode():
            pred = loaded.model(x_t)
            pred = pred.detach().cpu().numpy().reshape(-1, 1)

        roi_processed = loaded.scaler_y.inverse_transform(pred).reshape(-1)
        roi_processed = np.maximum(roi_processed, 0.0)
        roi = self._catmull_rom_resample(roi_processed, loaded.out_len)
        summary = self._summarize(loaded.time_us, roi)
        return {
            "fixed_context": self.model_metadata["fixed_context"],
            "input": request,
            "time_us": loaded.time_us.tolist(),
            "roi_mg_per_ms": roi.tolist(),
            "summary": summary,
        }

    def predict_batch(self, cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for idx, case in enumerate(cases):
            case_id = case.get("case_id") or case.get("id") or f"case_{idx + 1}"
            try:
                result = self.predict(case["pressure_bar"], case["duration_us"])
                results.append({"case_id": case_id, "ok": True, "result": result})
            except Exception as exc:  # noqa: BLE001
                results.append({"case_id": case_id, "ok": False, "error": str(exc)})
        return results
