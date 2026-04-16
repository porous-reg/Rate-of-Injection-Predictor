# ROI Predictor Webapp

Web frontend + FastAPI backend for the fixed-context ROI waveform predictor.

## Current release

This version is fixed to:

- injector `800`
- fuel temperature `30 C`

The user enters only:

- `pressure_bar`
- `duration_us`

The backend returns the full ROI waveform plus summary metrics.

## Local run

```bash
python -m pip install -r backend/requirements.txt
uvicorn backend.app:app --reload
```

Open:

- `http://127.0.0.1:8000/`

## Contract

Inputs:

- `pressure_bar`
- `duration_us`

Outputs:

- `time_us`
- `roi_mg_per_ms`
- summary metrics

## Deployment

Prepared for Render via `render.yaml`.

The shell is intentionally reusable for later geometry-aware ROI variants, such as models that may also accept injector hole count or hole pattern metadata.

If you host the frontend on Cloudflare Pages, point the Program page at the backend URL using the optional Backend URL field or a proxy function. The frontend can keep calling `/api/*` on the same origin if the host proxies those requests to the Python backend.
