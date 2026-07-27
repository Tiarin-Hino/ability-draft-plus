# ML Pipeline — from missing ability to shipped model

This documents the semi-automated retraining loop. The only inherently manual part
is data capture (the game must run on a real PC); everything after "dataset
uploaded" is automated with one click and one PR review.

## The loop

```
┌─ Your PC ────────────────────────────────────────────────────────────────┐
│ 1. App: Data → Update Windrun Data                                       │
│    → staleness detector flags abilities missing from the model           │
│ 2. App: Dashboard → "Export Model Gaps (N)" → model-gaps.json            │
│ 3. ad_data_gather_script:                                                │
│      python gather_missing_data.py --gaps-file model-gaps.json           │
│    (~40 min unattended; drives Dota 2, crops icons into tf_training_data)│
│ 4. Seed splits for new classes (create_splits.ps1), then:                │
│      python upload_dataset.py --bucket <DATASET_BUCKET>                  │
│    → s3://<bucket>/datasets/dataset-vN.zip (+ manifest.json provenance)  │
└──────────────────────────────────────────────────────────────────────────┘
┌─ GitHub ─────────────────────────────────────────────────────────────────┐
│ 5. Actions → "Retrain ML model" → dataset_version = N                    │
│    - trains MobileNetV2 head (seeded, class-weighted, early stopping)    │
│    - converts SavedModel → ONNX (opset 18) → FP16 (~5.6 MB)              │
│    - REGRESSION GATE: evaluates the actual INT8 artifact on the test     │
│      split; fails below --min-accuracy (default 97%) or if quantization  │
│      costs more than 1% accuracy                                         │
│    - opens a PR: new model + class_names.json + minor version bump,      │
│      with the metrics report (per-class recall, confusions) as PR body   │
│ 6. You review the metrics, merge → release workflow ships the version    │
│    → users receive it via the in-app auto-updater                        │
└──────────────────────────────────────────────────────────────────────────┘
```

## One-time setup

GitHub repository secrets (Settings → Secrets → Actions), in addition to the
existing release secrets:

| Secret | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | IAM user with `s3:GetObject`/`s3:ListBucket` on the dataset bucket |
| `AWS_REGION` | e.g. `eu-north-1` |
| `DATASET_BUCKET` | bucket name holding `datasets/dataset-vN.zip` |

Create the bucket (private, no public access) and give your local AWS CLI write
access for `upload_dataset.py`.

## Training details (`training/train.py`)

- Supersedes the 17 loose Colab cells in `colab/` (kept for reference only).
- Deterministic: seeded TF/NumPy/Python, class order = sorted train subfolders,
  written to `class_names.json` (the app derives its class count from this file —
  there is no hardcoded count anymore).
- Input contract: raw 0–255 float32 `[N,96,96,3]`; rescaling to [-1,1] lives
  inside the graph. This matches `src/core/ml/preprocessing.ts`, which
  deliberately does not normalize.
- Improvements over the Colab recipe: inverse-frequency class weights (tail
  classes have as few as 8 images), EarlyStopping with best-weights restore,
  horizontal flip removed from augmentation (icons never appear mirrored),
  optional `--fine-tune` of the top MobileNetV2 block at lr=1e-5.
- The shipped model is **FP16**, not INT8 — a deliberate decision after INT8
  failed twice: dynamic quantization collapsed accuracy to random (99% → 0.1%),
  and static per-channel QDQ proved weight-distribution-sensitive (98.8% on one
  converged model, 92.2% on another with identical code — training is not
  bit-reproducible across platforms). FP16 matches FP32 accuracy exactly, needs
  no calibration, is deterministic on every run, and runs on all ORT providers
  (DirectML natively prefers it). ~5.6 MB vs ~3.2 MB INT8 is irrelevant on
  desktop; pipeline reliability is not.
- The gate still evaluates the actual shipped FP16 artifact on the test split
  (never the Keras model) — it has caught two real would-be-shipped disasters.

Run locally (Python 3.11):

```bash
pip install -r training/requirements.txt
python training/train.py --data-dir ../tf_training_data --output-dir training_output --previous-class-names resources/model/class_names.json
```

## Known limitations

- PRs opened with the default `GITHUB_TOKEN` do not trigger the CI workflow
  automatically — close and reopen the PR (or push an empty commit) to run CI,
  or configure a PAT in `create-pull-request` if this becomes annoying.
- The gate checks aggregate accuracy and quantization drop; a subtle per-class
  regression can pass it. The PR body lists the 15 worst per-class recalls and
  top confusions — review them before merging.
- A lobby holds 12 heroes, so a gaps file spanning more than 12 heroes needs
  multiple gather runs (the script tells you which heroes were deferred).
