# llm

A small decoder-only transformer, trained from scratch on a synthetic sequence task.

    python train.py          # 100 epochs, logs to runs/
    python eval.py           # perplexity on the held-out split
    tensorboard --logdir runs
