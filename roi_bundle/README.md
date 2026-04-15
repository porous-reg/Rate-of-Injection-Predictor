# ROI Web Bundle

Portable inference bundle for a separate web project that predicts ROI waveforms from condition inputs only:

- injector id: `417` or `800`
- rail pressure `[bar]`
- fuel temperature `[degC]`
- energizing time `[us]`

## Included assets

- `models/`: selected checkpoint per injector
- `code/model_defs.py`: minimal runtime model definitions
- `code/predict_roi.py`: CLI/helper for condition-only ROI inference
- `metadata/supported_conditions.json`: allowed pressure / temperature / ET values per injector
- `metadata/time_grid.json`: common 1024-sample ROI time axis
- `examples/requests.json`: sample inputs
- `examples/predictions/`: sample JSON outputs

## Selected checkpoints

- injector `800`: checkpoint `TRM_NO_CURRENT`, exposed as paper label `ET-Transformer`
- injector `417`: checkpoint `B_MLP_BayesReg_scalar`, exposed as paper label `ET-MLP-BayesReg`

Note for injector `800`: the stored `TRM_NO_CURRENT` checkpoint contains MLP weights because the original training code routes `NO_CURRENT` models through the MLP branch before the transformer branch is reached. The bundle runtime handles this explicitly, so the copied checkpoint is usable as-is.

## Output contract

`predict_roi.py` returns JSON with:

- `injector_id`
- `model_label`
- `model_id`
- `input`
- `time_us` (length 1024)
- `roi_mg_per_ms` (length 1024)

## Example usage

```bash
python code/predict_roi.py \
  --injector-id 800 \
  --pressure-bar 200 \
  --temp-c 30 \
  --et-us 700 \
  --output examples/predictions/inj800_P200_T30_ET700.json
```

## Move target

This directory is meant to be copied directly into a separate web-service or frontend-backend project. The new project only needs Python, `torch`, and `numpy` to run the included inference script.
