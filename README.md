# ROI Predictor Webapp

Web frontend + FastAPI backend for the ROI waveform predictor bundle.

## Local run

```bash
python -m pip install -r backend/requirements.txt
uvicorn backend.app:app --reload
```

Open:

- `http://127.0.0.1:8000/`

## Contract

Inputs:

- `injector_id`
- `pressure_bar`
- `temp_c`
- `et_us`

Outputs:

- `time_us`
- `roi_mg_per_ms`
- summary metrics

## Deployment

Prepared for Render via `render.yaml`.

The shell is intentionally reusable for later geometry-aware ROI variants, such as models that may also accept injector hole count or hole pattern metadata.
