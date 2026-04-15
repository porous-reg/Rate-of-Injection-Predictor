from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from model_defs import build_condition_model

BUNDLE_ROOT = Path(__file__).resolve().parents[1]
MODEL_MAP = {
    '800': {
        'paper_label': 'ET-Transformer',
        'code_model_id': 'TRM_NO_CURRENT',
        'ckpt_dir': BUNDLE_ROOT / 'models' / 'inj800' / 'ET-Transformer',
    },
    '417': {
        'paper_label': 'ET-MLP-BayesReg',
        'code_model_id': 'B_MLP_BayesReg_scalar',
        'ckpt_dir': BUNDLE_ROOT / 'models' / 'inj417' / 'ET-MLP-BayesReg',
    },
}
TIME_GRID = json.loads((BUNDLE_ROOT / 'metadata' / 'time_grid.json').read_text(encoding='utf-8'))


def _load_norm(path: Path) -> dict[str, np.ndarray]:
    payload = json.loads(path.read_text(encoding='utf-8'))
    return {k: np.array(v, dtype=np.float32) for k, v in payload.items() if k in {'x_mean', 'x_std', 'y_mean', 'y_std'}}


def predict_roi(injector_id: str, pressure_bar: float, temp_c: float, et_us: float, device: str = 'cpu') -> dict[str, object]:
    injector_id = str(injector_id)
    if injector_id not in MODEL_MAP:
        raise ValueError(f'Unsupported injector_id: {injector_id}')
    model_meta = MODEL_MAP[injector_id]
    ckpt_dir = Path(model_meta['ckpt_dir'])
    cfg = json.loads((ckpt_dir / 'config.json').read_text(encoding='utf-8'))
    norm = _load_norm(ckpt_dir / 'norm.json')
    model = build_condition_model(str(model_meta['code_model_id']), seq_len=int(cfg.get('target_len', 1024)))
    state = torch.load(ckpt_dir / 'model.pt', map_location=device)
    model.load_state_dict(state)
    model.to(device)
    model.eval()

    x = np.array([pressure_bar, temp_c, et_us], dtype=np.float32)
    x = (x - norm['x_mean']) / norm['x_std']
    x_t = torch.tensor(x, dtype=torch.float32, device=device).unsqueeze(0)

    with torch.no_grad():
        pred = model(x_t)
        if pred.dim() == 3:
            pred = pred.squeeze(1)
        pred = pred * float(norm['y_std'][0]) + float(norm['y_mean'][0])
        roi = pred.cpu().numpy().reshape(-1)

    time_us = np.linspace(float(TIME_GRID['grid_start_us']), float(TIME_GRID['grid_end_us']), int(TIME_GRID['target_len']), dtype=np.float32)
    return {
        'injector_id': injector_id,
        'model_label': model_meta['paper_label'],
        'model_id': model_meta['code_model_id'],
        'input': {'pressure_bar': float(pressure_bar), 'temp_c': float(temp_c), 'et_us': float(et_us)},
        'time_us': time_us.tolist(),
        'roi_mg_per_ms': roi.tolist(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='Predict ROI shape from (injector, pressure, temp, ET).')
    parser.add_argument('--injector-id', required=True, choices=['417', '800'])
    parser.add_argument('--pressure-bar', required=True, type=float)
    parser.add_argument('--temp-c', required=True, type=float)
    parser.add_argument('--et-us', required=True, type=float)
    parser.add_argument('--device', default='cpu')
    parser.add_argument('--output', default='')
    args = parser.parse_args()

    result = predict_roi(args.injector_id, args.pressure_bar, args.temp_c, args.et_us, device=args.device)
    text = json.dumps(result, indent=2)
    if args.output:
        Path(args.output).write_text(text, encoding='utf-8')
    else:
        print(text)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
