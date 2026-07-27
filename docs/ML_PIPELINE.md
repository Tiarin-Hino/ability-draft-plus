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
│    - converts SavedModel → ONNX (opset 18) → static QDQ INT8             │
│      (per-channel, calibrated on validation images)                      │
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
- The gate exists because quantization has silently destroyed accuracy twice in
  this project's history (UINT8 in the TFJS era; per-tensor dynamic quantization
  of the TF 2.15 graph collapsed 99% → 0.1% in the first CI run) — the INT8
  artifact itself is evaluated on the test split, not the Keras model.
- Quantization is static QDQ, per-channel, calibrated on a seeded sample of
  validation images. QDQ ops run on every ORT version and provider (including
  DirectML), unlike the ConvInteger ops dynamic quantization emits.

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
