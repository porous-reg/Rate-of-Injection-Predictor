from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np


ROOT_DIR = Path(__file__).resolve().parents[2]
MODEL_ROOT = ROOT_DIR / "Model"
SURFACE_PATH = MODEL_ROOT / "mass_smooth_surface.npz"


def _load_surface_metadata() -> dict[str, Any]:
    surface = np.load(SURFACE_PATH, allow_pickle=True)
    pressure_grid = [float(v) for v in np.asarray(surface["p_grid"]).reshape(-1)]
    duration_grid = [float(v) for v in np.asarray(surface["d_grid"]).reshape(-1)]
    pressure_range = [min(pressure_grid), max(pressure_grid)] if pressure_grid else [100.0, 350.0]
    duration_range = [min(duration_grid), max(duration_grid)] if duration_grid else [250.0, 3000.0]
    out_len = 7500
    return {
        "bundle_name": "Model",
        "model_kind": "pdnn",
        "model_label": "ModelB PDNN",
        "model_id": "best_model_ModelB",
        "purpose": "Pressure-duration ROI inference bundle for injector 800 at 30C fixed context",
        "fixed_context": {"injector_id": "800", "temp_c": 30.0},
        "pressure_grid": pressure_grid,
        "duration_grid": duration_grid,
        "supported_pressure_range": pressure_range,
        "supported_duration_range": duration_range,
        "output": {"roi_unit": "mg/ms", "time_axis_unit": "us", "length": out_len},
        "future_extension_note": "This first release is pressure-duration only. Injector geometry, additional temperature conditions, and hole-count-aware variants are reserved for future versions.",
        "bundle_load_errors": [],
    }


MODEL_METADATA = _load_surface_metadata()
SUPPORTED_PRESSURE_RANGE = tuple(MODEL_METADATA["supported_pressure_range"])
SUPPORTED_DURATION_RANGE = tuple(MODEL_METADATA["supported_duration_range"])


def _within_range(value: float, bounds: tuple[float, float]) -> bool:
    return float(bounds[0]) <= float(value) <= float(bounds[1])


def validate_request(pressure_bar: float, duration_us: float) -> dict[str, Any]:
    errors: list[str] = []
    if not _within_range(float(pressure_bar), SUPPORTED_PRESSURE_RANGE):
        errors.append(f"pressure_bar {pressure_bar!r} is outside the supported range")
    if not _within_range(float(duration_us), SUPPORTED_DURATION_RANGE):
        errors.append(f"duration_us {duration_us!r} is outside the supported range")
    if errors:
        raise ValueError("; ".join(errors))
    return {"pressure_bar": float(pressure_bar), "duration_us": float(duration_us)}


def supported_conditions_payload() -> dict[str, Any]:
    return {
        "bundle_name": MODEL_METADATA["bundle_name"],
        "purpose": MODEL_METADATA["purpose"],
        "fixed_context": MODEL_METADATA["fixed_context"],
        "supported_pressure_range_bar": list(SUPPORTED_PRESSURE_RANGE),
        "supported_duration_range_us": list(SUPPORTED_DURATION_RANGE),
        "pressure_grid": MODEL_METADATA["pressure_grid"],
        "duration_grid": MODEL_METADATA["duration_grid"],
        "output": MODEL_METADATA["output"],
        "future_extension_note": MODEL_METADATA["future_extension_note"],
        "bundle_load_errors": MODEL_METADATA["bundle_load_errors"],
        "model_kind": MODEL_METADATA["model_kind"],
        "model_label": MODEL_METADATA["model_label"],
        "model_id": MODEL_METADATA["model_id"],
    }
