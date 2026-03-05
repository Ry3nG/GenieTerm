#!/usr/bin/env python3
import argparse
import glob
import json
import statistics
import sys
from typing import Dict, List


def load_json(path: str):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def percentile(values: List[float], p: float) -> float:
    if not values:
        return 0.0
    values = sorted(values)
    pos = round((len(values) - 1) * p)
    return values[int(pos)]


def mad(values: List[float]) -> float:
    if not values:
        return 0.0
    med = statistics.median(values)
    deviations = [abs(v - med) for v in values]
    return statistics.median(deviations)


def main() -> int:
    parser = argparse.ArgumentParser(description="Aggregate benchmark runs")
    parser.add_argument("--inputs", required=True, help="glob pattern for input json files")
    parser.add_argument("--output", required=True, help="summary output json file")
    parser.add_argument("--label", default="benchmark_suite", help="suite label")
    args = parser.parse_args()

    files = sorted(glob.glob(args.inputs))
    if not files:
        print(f"no input files matched: {args.inputs}", file=sys.stderr)
        return 1

    reports = [load_json(p) for p in files]
    metric_values: Dict[str, List[float]] = {}

    for r in reports:
        metrics = r.get("metrics", {})
        for k, v in metrics.items():
            if isinstance(v, (int, float)):
                metric_values.setdefault(k, []).append(float(v))

    summary_metrics = {}
    for key, vals in sorted(metric_values.items()):
        summary_metrics[key] = {
            "n": len(vals),
            "median": statistics.median(vals),
            "p95": percentile(vals, 0.95),
            "mad": mad(vals),
            "min": min(vals),
            "max": max(vals),
        }

    summary = {
        "schema_version": 1,
        "label": args.label,
        "runs": len(reports),
        "input_files": files,
        "metrics": summary_metrics,
    }

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2, sort_keys=True)

    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
