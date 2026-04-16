## Model

This folder contains **trained PDNN artifacts** and all derived outputs.

### Core artifacts (keep these for inference)
- `best_model_ModelB.pth`: best checkpoint selected during training
- `checkpoint_last.pth`: last checkpoint saved
- `scaler_X.pkl`, `scaler_y.pkl`: input/output scalers required for prediction

### Training diagnostics
- `loss_curve.csv`, `loss_curve.png`

### Validation outputs
- `validation/` contains:
  - metrics CSV + summary text
  - sweep plots (waveform overlays)
  - report pack (trend overlays, true-vs-pred grids, etc.)

### How this folder is produced
- Train: `scripts/train_pdnn.py`
- Validate: `scripts/validate_pdnn_processed.py`
- Predict: `scripts/predict_roi_from_pdnn.py`

