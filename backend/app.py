from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .services.roi_runtime import RoiRuntime

ROOT_DIR = Path(__file__).resolve().parents[1]
FRONTEND_DIR = ROOT_DIR / "frontend"

app = FastAPI(title="ROI Predictor Webapp", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

runtime = RoiRuntime()


class PredictRequest(BaseModel):
    case_id: str | None = Field(default=None, description="Optional case identifier.")
    pressure_bar: float = Field(..., description="Rail pressure in bar.")
    duration_us: float = Field(..., description="Injection duration in microseconds.")


class BatchPredictRequest(BaseModel):
    cases: list[PredictRequest]


@app.get("/api/health")
def health() -> dict[str, Any]:
    return runtime.health_payload()


@app.get("/api/supported-conditions")
def supported_conditions() -> dict[str, Any]:
    return runtime.get_supported_conditions_payload()


@app.post("/api/predict")
def predict(request: PredictRequest) -> dict[str, Any]:
    try:
        return runtime.predict(request.pressure_bar, request.duration_us)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/predict-batch")
def predict_batch(request: BatchPredictRequest) -> dict[str, Any]:
    return {"results": runtime.predict_batch([case.model_dump() for case in request.cases])}


app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="assets")


def _frontend_file(name: str) -> FileResponse:
    return FileResponse(FRONTEND_DIR / name)


@app.get("/", include_in_schema=False)
def root() -> FileResponse:
    return _frontend_file("index.html")


@app.get("/index.html", include_in_schema=False)
def index_html() -> FileResponse:
    return _frontend_file("index.html")


@app.get("/intro.html", include_in_schema=False)
def intro_html() -> FileResponse:
    return _frontend_file("intro.html")


@app.get("/logic.html", include_in_schema=False)
def logic_html() -> FileResponse:
    return _frontend_file("logic.html")


@app.get("/references.html", include_in_schema=False)
def references_html() -> FileResponse:
    return _frontend_file("references.html")


@app.get("/program", include_in_schema=False)
def program_redirect() -> RedirectResponse:
    return RedirectResponse(url="/index.html", status_code=302)
