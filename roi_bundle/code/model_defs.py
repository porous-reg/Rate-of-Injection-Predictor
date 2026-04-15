from __future__ import annotations

import math
import torch
from torch import nn


class MLPSequence(nn.Module):
    def __init__(self, in_features: int, seq_len: int, hidden: int = 128):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_features, hidden),
            nn.ReLU(),
            nn.Linear(hidden, hidden),
            nn.ReLU(),
            nn.Linear(hidden, seq_len),
        )

    def forward(self, x):
        out = self.net(x)
        return out.unsqueeze(1)


class PositionalEncoding(nn.Module):
    def __init__(self, d_model: int, max_len: int, dropout: float = 0.1):
        super().__init__()
        self.dropout = nn.Dropout(p=dropout)
        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        self.register_buffer('pe', pe.unsqueeze(0))

    def forward(self, x):
        return self.dropout(x + self.pe[:, :x.size(1), :])


class TinyTransformerBlock(nn.Module):
    def __init__(self, d_model: int, nhead: int, dim_feedforward: int = 128, dropout: float = 0.1):
        super().__init__()
        self.self_attn = nn.MultiheadAttention(d_model, nhead, dropout=dropout, batch_first=True)
        self.ff = nn.Sequential(
            nn.Linear(d_model, dim_feedforward),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(dim_feedforward, d_model),
            nn.Dropout(dropout),
        )
        self.norm1 = nn.LayerNorm(d_model)
        self.norm2 = nn.LayerNorm(d_model)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x):
        attn_out, _ = self.self_attn(x, x, x)
        x = self.norm1(x + self.dropout(attn_out))
        ff_out = self.ff(x)
        return self.norm2(x + ff_out)


class InjectorTRM(nn.Module):
    def __init__(self, input_size: int, d_model: int = 64, nhead: int = 4, num_layers: int = 2, dim_feedforward: int = 128, output_size: int = 1, dropout: float = 0.1, max_len: int = 1024):
        super().__init__()
        self.input_proj = nn.Linear(input_size, d_model)
        self.pos_encoder = PositionalEncoding(d_model, max_len=max_len, dropout=dropout)
        self.transformer_blocks = nn.ModuleList([TinyTransformerBlock(d_model, nhead, dim_feedforward, dropout) for _ in range(num_layers)])
        self.output_proj = nn.Linear(d_model, output_size)

    def forward(self, x):
        x = self.input_proj(x)
        x = self.pos_encoder(x)
        for block in self.transformer_blocks:
            x = block(x)
        return self.output_proj(x)


class TRMSeq(nn.Module):
    def __init__(self, in_ch: int, seq_len: int):
        super().__init__()
        self.core = InjectorTRM(input_size=in_ch, max_len=seq_len)

    def forward(self, x):
        x = x.permute(0, 2, 1)
        y = self.core(x)
        return y.permute(0, 2, 1)


def build_condition_model(model_id: str, seq_len: int = 1024):
    if model_id == 'B_MLP_BayesReg_scalar':
        return MLPSequence(in_features=3, seq_len=seq_len)
    if model_id == 'TRM_NO_CURRENT':
        # In the original training code, NO_CURRENT practical checkpoints are
        # instantiated through the MLP path before the TRM branch is reached.
        # The serialized inj800 TRM_NO_CURRENT checkpoint therefore has MLP
        # weights and must be restored with the matching runtime module.
        return MLPSequence(in_features=3, seq_len=seq_len)
    raise ValueError(f'Unsupported condition-only model: {model_id}')
