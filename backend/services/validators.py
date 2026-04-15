from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[2]
BUNDLE_ROOT = ROOT_DIR / "roi_bundle"

SUPPORTED_CONDITIONS = json.loads((BUNDLE_ROOT / "metadata" / "supported_conditions.json").read_text(encoding="utf-8"))
MODEL_SELECTION = json.loads((BUNDLE_ROOT / "metadata" / "model_selection.json").read_text(encoding="utf-8"))
BUNDLE_MANIFEST = json.loads((BUNDLE_ROOT / "metadata" / "bundle_manifest.json").read_text(encoding="utf-8"))
TIME_GRID = json.loads((BUNDLE_ROOT / "metadata" / "time_grid.json").read_text(encoding="utf-8"))


def normalize_injector_id(value: Any) -> str:
    injector_id = str(value).strip()
    if injector_id in SUPPORTED_CONDITIONS:
        return injector_id
    raise ValueError(f"Unsupported injector_id: {value!r}")


def _is_exact_member(value: float, allowed_values: list[float]) -> bool:
    for candidate in allowed_values:
        if abs(float(value) - float(candidate)) <= 1e-9:
            return True
    return False


def validate_condition(
    injector_id: Any,
    pressure_bar: float,
    temp_c: float,
    et_us: float,
) -> dict[str, Any]:
    injector_key = normalize_injector_id(injector_id)
    catalog = SUPPORTED_CONDITIONS[injector_key]

    errors: list[str] = []
    if not _is_exact_member(float(pressure_bar), catalog["pressure_bar"]):
        errors.append(f"pressure_bar {pressure_bar!r} is not supported for injector {injector_key}")
    if not _is_exact_member(float(temp_c), catalog["temp_c"]):
        errors.append(f"temp_c {temp_c!r} is not supported for injector {injector_key}")
    if not _is_exact_member(float(et_us), catalog["et_us"]):
        errors.append(f"et_us {et_us!r} is not supported for injector {injector_key}")

    if errors:
        raise ValueError("; ".join(errors))

    return {
        "injector_id": injector_key,
        "pressure_bar": float(pressure_bar),
        "temp_c": float(temp_c),
        "et_us": float(et_us),
    }


def supported_conditions_payload() -> dict[str, Any]:
    return {
        "bundle_name": BUNDLE_MANIFEST["bundle_name"],
        "purpose": BUNDLE_MANIFEST["purpose"],
        "time_axis_unit": BUNDLE_MANIFEST["output"]["time_axis_unit"],
        "roi_unit": BUNDLE_MANIFEST["output"]["roi_unit"],
        "time_axis_length": BUNDLE_MANIFEST["output"]["length"],
        "selected_models": MODEL_SELECTION,
        "supported_conditions": SUPPORTED_CONDITIONS,
        "time_grid": TIME_GRID,
        "geometry_extension_note": "Condition-only v1; geometry-aware inputs such as injector hole count are reserved for future versions.",
    }

