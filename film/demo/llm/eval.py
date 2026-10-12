import math

import torch
import torch.nn as nn

from train import Model, batch, dev

model = Model().to(dev).eval()
total = 0.0
with torch.no_grad():
    for _ in range(20):
        x, y = batch()
        with torch.autocast("cuda", dtype=torch.bfloat16):
            total += nn.functional.cross_entropy(model(x).flatten(0, 1), y.flatten()).item()
loss = total / 20
print(f"eval loss {loss:.4f}  ppl {math.exp(loss):.2f}")
