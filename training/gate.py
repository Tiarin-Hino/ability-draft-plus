"""INT8 regression gate + report — runs ISOLATED from the training environment.

Why separate: tf2onnx pins an old `onnx`, which caps onnxruntime at a version
whose CPU provider cannot execute signed-int8 ConvInteger ("Could not find an
implementation for ConvInteger"). The gate therefore runs in its own minimal
environment (requirements-gate.txt: modern onnxruntime + numpy) and consumes
artifacts produced by train.py in --output-dir:

    ability_classifier_int8.onnx   the artifact being judged
    class_names.json               class order
    test_data.npz                  exact test tensors (raw 0-255 float32) + labels
    train_summary.json             training context (keras accuracy, dataset, ...)

Outputs metrics.json + report.md and exits 1 when the gate fails:
INT8 accuracy < --min-accuracy, or quantization drop > --max-quant-drop.
"""

import argparse
import json
import os
import sys
from collections import Counter

import numpy as np
import onnxruntime as ort

BATCH = 64


def parse_args():
    p = argparse.ArgumentParser(description="INT8 regression gate")
    p.add_argument("--output-dir", default="training_output",
                   help="Directory holding train.py's artifacts; reports go here too")
    p.add_argument("--min-accuracy", type=float, default=0.97,
                   help="Gate: minimum INT8 test accuracy")
    p.add_argument("--max-quant-drop", type=float, default=0.01,
                   help="Gate: maximum accuracy drop from Keras to INT8")
    p.add_argument("--no-gate", action="store_true",
                   help="Report metrics but never fail (experiments)")
    return p.parse_args()


def main():
    args = parse_args()
    out = args.output_dir

    print(f"onnxruntime {ort.__version__}")
    with open(os.path.join(out, "class_names.json"), encoding="utf-8") as f:
        class_names = json.load(f)
    with open(os.path.join(out, "train_summary.json"), encoding="utf-8") as f:
        summary = json.load(f)

    data = np.load(os.path.join(out, "test_data.npz"))
    images, labels = data["images"], data["labels"]
    print(f"Test tensors: {images.shape[0]} images, {len(class_names)} classes")

    session = ort.InferenceSession(
        os.path.join(out, "ability_classifier_int8.onnx"),
        providers=["CPUExecutionProvider"],
    )
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name

    y_pred = []
    for i in range(0, len(images), BATCH):
        probs = session.run([output_name], {input_name: images[i:i + BATCH]})[0]
        y_pred.extend(np.argmax(probs, axis=1).tolist())
    y_pred = np.array(y_pred)
    y_true = labels

    int8_acc = float((y_true == y_pred).mean())
    keras_acc = summary["kerasTestAccuracy"]
    quant_drop = keras_acc - int8_acc
    print(f"INT8 test accuracy: {int8_acc:.4f} (drop vs Keras: {quant_drop:+.4f})")

    per_class_recall = {}
    confusions = Counter()
    for cls_idx, name in enumerate(class_names):
        mask = y_true == cls_idx
        if mask.sum() == 0:
            continue
        per_class_recall[name] = float((y_pred[mask] == cls_idx).mean())
    for t, p in zip(y_true, y_pred):
        if t != p:
            confusions[(class_names[t], class_names[p])] += 1

    gate_passed = int8_acc >= args.min_accuracy and quant_drop <= args.max_quant_drop
    worst_classes = sorted(per_class_recall.items(), key=lambda kv: kv[1])[:15]
    top_confusions = confusions.most_common(10)

    metrics = {
        **summary,
        "int8TestAccuracy": round(int8_acc, 5),
        "quantizationDrop": round(float(quant_drop), 5),
        "gate": {
            "minAccuracy": args.min_accuracy,
            "maxQuantDrop": args.max_quant_drop,
            "passed": gate_passed,
        },
        "worstClassRecall": {name: round(r, 4) for name, r in worst_classes},
        "topConfusions": [
            {"true": t, "predicted": p, "count": c}
            for (t, p), c in top_confusions
        ],
    }
    with open(os.path.join(out, "metrics.json"), "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)

    added = summary.get("classesAdded", [])
    removed = summary.get("classesRemoved", [])
    lines = [
        "## Model retrain report",
        "",
        f"- Dataset: v{summary.get('datasetVersion', '?')} ({summary.get('datasetCreatedAt', 'unknown date')})",
        f"- Classes: **{summary['numClasses']}** ({summary['trainImages']} training images, seed {summary['seed']})",
        f"- Keras test accuracy: **{keras_acc:.2%}**",
        f"- INT8 ONNX test accuracy: **{int8_acc:.2%}** (quantization drop {quant_drop:+.2%})",
        f"- Gate (≥{args.min_accuracy:.0%}, drop ≤{args.max_quant_drop:.0%}): "
        + ("**PASSED** ✅" if gate_passed else "**FAILED** ❌"),
        f"- Fine-tuned top block: {'yes' if summary.get('fineTuned') else 'no'}",
        f"- INT8 size: {summary.get('int8SizeMb', '?')} MB",
    ]
    if added:
        lines += ["", f"### New classes ({len(added)})", ""]
        lines += [f"- `{name}`" for name in added]
    if removed:
        lines += ["", f"### Removed classes ({len(removed)})", ""]
        lines += [f"- `{name}`" for name in removed]
    lines += ["", "### Worst per-class recall (test split)", ""]
    lines += [f"- `{name}`: {r:.0%}" for name, r in worst_classes]
    if top_confusions:
        lines += ["", "### Top confusions", ""]
        lines += [f"- `{t}` → `{p}` ({c}×)" for (t, p), c in top_confusions]

    with open(os.path.join(out, "report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print("\n" + "\n".join(lines))

    if not gate_passed and not args.no_gate:
        print("\nGATE FAILED — model artifacts were produced but must not ship.")
        sys.exit(1)


if __name__ == "__main__":
    main()
