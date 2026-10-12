import math
import time

import torch
import torch.nn as nn
from torch.utils.tensorboard import SummaryWriter

EPOCHS = 100
STEPS = 40
VOCAB, CTX, DIM, LAYERS = 512, 256, 768, 8

torch.manual_seed(0)
dev = "cuda"


def make_data(n=4096):
    # sequences with learnable structure: each token follows from the two before it
    x = torch.randint(0, VOCAB, (n, CTX + 1), device=dev)
    for t in range(2, CTX + 1):
        keep = torch.rand(n, device=dev) < 0.85
        x[:, t] = torch.where(keep, (x[:, t - 1] * 3 + x[:, t - 2]) % VOCAB, x[:, t])
    return x


DATA = make_data()


def batch(n=24):
    idx = torch.randint(0, DATA.size(0), (n,), device=dev)
    x = DATA[idx]
    return x[:, :-1], x[:, 1:]


class Model(nn.Module):
    def __init__(self):
        super().__init__()
        self.emb = nn.Embedding(VOCAB, DIM)
        self.pos = nn.Parameter(torch.zeros(CTX, DIM))
        layer = nn.TransformerEncoderLayer(DIM, 12, 4 * DIM, batch_first=True, norm_first=True)
        self.body = nn.TransformerEncoder(layer, LAYERS, enable_nested_tensor=False)
        self.head = nn.Linear(DIM, VOCAB)

    def forward(self, x):
        mask = nn.Transformer.generate_square_subsequent_mask(x.size(1), device=x.device)
        return self.head(self.body(self.emb(x) + self.pos, mask=mask, is_causal=True))


model = Model().to(dev)
opt = torch.optim.AdamW(model.parameters(), lr=3e-4)
params = sum(p.numel() for p in model.parameters()) / 1e6
print(f"model {params:.0f}M params · {torch.cuda.get_device_name()} · bf16")
writer = SummaryWriter("runs/exp1")

for epoch in range(1, EPOCHS + 1):
    t0 = time.time()
    total = 0.0
    for _ in range(STEPS):
        x, y = batch()
        with torch.autocast("cuda", dtype=torch.bfloat16):
            loss = nn.functional.cross_entropy(model(x).flatten(0, 1), y.flatten())
        opt.zero_grad(set_to_none=True)
        loss.backward()
        opt.step()
        total += loss.item()
    loss = total / STEPS
    writer.add_scalar("loss/train", loss, epoch)
    writer.flush()
    print(f"epoch {epoch:3d}/{EPOCHS}  loss {loss:.4f}  ppl {math.exp(loss):7.2f}  {time.time() - t0:.1f}s")
print("done · saved runs/exp1")
