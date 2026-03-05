#!/usr/bin/env python3
import argparse
import json
import math
import sys


def load_json(path: str):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def regression_pct(direction: str, baseline: float, current: float) -> float:
    if baseline == 0:
        return 0.0
    if direction == "higher_better":
        return ((baseline - current) / baseline) * 100.0
    if direction == "lower_better":
        return ((current - baseline) / baseline) * 100.0
    raise ValueError(f"unsupported direction: {direction}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Check benchmark regression")
    parser.add_argument("--baseline", required=True, help="baseline json file")
    parser.add_argument("--result", required=True, help="current result json file")
    parser.add_argument("--thresholds", required=True, help="threshold config json")
    args = parser.parse_args()

    baseline = load_json(args.baseline)
    result = load_json(args.result)
    thresholds = load_json(args.thresholds)

    baseline_metrics = baseline.get("metrics", {})
    result_metrics = result.get("metrics", {})
    specs = thresholds.get("metrics", {})

    failed = False
    print("Regression check:")
    for metric, spec in specs.items():
        if metric not in baseline_metrics or metric not in result_metrics:
            print(f"  SKIP {metric}: missing in baseline or result")
            continue

        direction = spec["direction"]
        max_reg = float(spec["max_regression_pct"])
        b = float(baseline_metrics[metric])
        c = float(result_metrics[metric])
        reg = regression_pct(direction, b, c)

        status = "PASS"
        if math.isfinite(reg) and reg > max_reg:
            status = "FAIL"
            failed = True

        print(
            f"  {status} {metric}: baseline={b:.4f} current={c:.4f} "
            f"regression={reg:.2f}% limit={max_reg:.2f}%"
        )

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
