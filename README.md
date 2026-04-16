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

If you host the frontend on Cloudflare Pages, point the Program page at the backend URL using the new Backend URL field, the `?api=` query parameter, or the `roiApiBase` localStorage key. Cloudflare Pages serves the static shell; the FastAPI backend must still run on a separate Python host.

For a no-manual-entry setup on Cloudflare Pages, add a Pages Function at `functions/api/[[path]].ts` and set a Cloudflare Pages environment variable named `BACKEND_URL` to the Render service URL. The frontend can keep calling `/api/*` on the same origin, and the Pages Function will forward those requests to the Python backend.
