"""End-to-end training pipeline for the Ability Draft Plus ability classifier.

Replaces the 17 loose Colab cells (colab/step*.py) with one reproducible script:

    dataset dir ({train,validation,test}/<class>/*.png [+ manifest.json])
        │  seeded tf.data pipelines, class weights
        ▼
    MobileNetV2 (frozen, imagenet) + GAP + Dropout + Dense softmax
        │  augmentation: rotation + zoom (NO horizontal flip — icons never mirror)
        │  EarlyStopping(restore_best_weights), optional fine-tune of the top block
        ▼
    clean inference graph (augmentation stripped, head weights copied)
        ▼
    SavedModel ──tf2onnx──▶ FP32 ONNX ──quantize_dynamic──▶ INT8 ONNX
        ▼
    REGRESSION GATE: the actual INT8 artifact is evaluated on the test split.
    Fails (exit 1) if accuracy < --min-accuracy or the INT8 model drops more than
    --max-quant-drop below the Keras model (guards against the historical
    "quantization destroyed accuracy" failure mode).

Outputs in --output-dir:
    ability_classifier_int8.onnx   ← ships in resources/model/
    class_names.json               ← ships in resources/model/
    metrics.json                   ← machine-readable results
    report.md                      ← human-readable summary (used as PR body)

The model consumes raw 0-255 float32 [N,96,96,3]; rescaling to [-1,1] happens
inside the graph (Rescaling 1/127.5, offset -1) — matching the app's
preprocessing.ts, which deliberately does NOT normalize.
"""

import argparse
import json
import os
import random
import subprocess
import sys
from datetime import datetime, timezone

import numpy as np

IMG_SIZE = 96
IMG_SHAPE = (IMG_SIZE, IMG_SIZE, 3)


def parse_args():
    p = argparse.ArgumentParser(description="Train the ability classifier")
    p.add_argument("--data-dir", required=True,
                   help="Dataset root containing train/validation/test folders")
    p.add_argument("--output-dir", default="training_output")
    p.add_argument("--epochs", type=int, default=30)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--fine-tune", action="store_true",
                   help="After head training, unfreeze the top MobileNetV2 block "
                        "and continue at a low learning rate")
    p.add_argument("--fine-tune-epochs", type=int, default=8)
    p.add_argument("--previous-class-names", default=None,
                   help="Path to the currently shipped class_names.json, for the "
                        "added/removed class diff in the report")
    return p.parse_args()


def set_seeds(seed):
    os.environ["PYTHONHASHSEED"] = str(seed)
    random.seed(seed)
    np.random.seed(seed)
    import tensorflow as tf
    tf.random.set_seed(seed)


def load_datasets(tf, data_dir, batch_size, seed):
    """Load the three pre-split folders with a deterministic class order."""
    train_dir = os.path.join(data_dir, "train")
    class_names = sorted(
        d for d in os.listdir(train_dir)
        if os.path.isdir(os.path.join(train_dir, d))
    )

    def load(split, shuffle):
        return tf.keras.utils.image_dataset_from_directory(
            os.path.join(data_dir, split),
            labels="inferred",
            label_mode="int",
            class_names=class_names,
            image_size=(IMG_SIZE, IMG_SIZE),
            batch_size=batch_size,
            shuffle=shuffle,
            seed=seed,
        )

    train_ds = load("train", shuffle=True)
    val_ds = load("validation", shuffle=False)
    test_ds = load("test", shuffle=False)
    return class_names, train_ds, val_ds, test_ds


def compute_class_weights(data_dir, class_names):
    """Inverse-frequency class weights so 8-image tail classes aren't drowned out."""
    counts = []
    for name in class_names:
        class_dir = os.path.join(data_dir, "train", name)
        counts.append(sum(
            1 for f in os.listdir(class_dir)
            if f.lower().endswith((".png", ".jpg", ".jpeg"))
        ))
    counts = np.array(counts, dtype=np.float64)
    weights = counts.sum() / (len(counts) * np.maximum(counts, 1))
    return {i: float(w) for i, w in enumerate(weights)}, counts


def build_model(tf, num_classes):
    from tensorflow import keras
    from tensorflow.keras import layers

    # Augmentation: rotation + zoom only. Horizontal flip is deliberately absent —
    # ability icons never appear mirrored in-game, and many are directionally
    # asymmetric, so flipping teaches the model to ignore a discriminative feature.
    data_augmentation = keras.Sequential(
        [
            keras.Input(shape=IMG_SHAPE),
            layers.RandomRotation(0.1),
            layers.RandomZoom(0.1),
        ],
        name="data_augmentation_block",
    )

    inputs = keras.Input(shape=IMG_SHAPE, name="training_input")
    x = data_augmentation(inputs)
    x = layers.Rescaling(1.0 / 127.5, offset=-1, name="training_rescaling")(x)

    base_model = tf.keras.applications.MobileNetV2(
        input_shape=IMG_SHAPE, include_top=False, weights="imagenet"
    )
    base_model.trainable = False

    x = base_model(x, training=False)
    x = layers.GlobalAveragePooling2D(name="global_avg_pool")(x)
    x = layers.Dropout(0.2, name="dropout_top")(x)
    outputs = layers.Dense(num_classes, activation="softmax",
                           name="classification_head")(x)

    model = keras.Model(inputs=inputs, outputs=outputs, name="training_model")
    return model, base_model


def build_inference_model(tf, base_model, trained_model, num_classes):
    """Clean graph without augmentation; copies the trained head weights."""
    from tensorflow import keras
    from tensorflow.keras import layers

    inf_inputs = keras.Input(shape=IMG_SHAPE, name="input_for_inference")
    x = layers.Rescaling(1.0 / 127.5, offset=-1, name="inference_rescaling")(inf_inputs)
    x = base_model(x, training=False)
    x = layers.GlobalAveragePooling2D(name="inference_gap")(x)
    x = layers.Dropout(0.2, name="inference_dropout")(x)
    inf_outputs = layers.Dense(num_classes, activation="softmax",
                               name="inference_dense_head")(x)
    inference_model = keras.Model(inputs=inf_inputs, outputs=inf_outputs)
    inference_model.get_layer("inference_dense_head").set_weights(
        trained_model.get_layer("classification_head").get_weights()
    )
    return inference_model


def export_test_tensors(test_ds, output_dir):
    """Dump the exact test tensors (raw 0-255 float32) for the isolated gate step.

    The gate (training/gate.py) runs in a separate environment with a modern
    onnxruntime — tf2onnx pins an old `onnx` that conflicts with the ORT
    versions able to execute signed-int8 ConvInteger. Handing over tensors
    instead of re-loading images guarantees both accuracy measurements see
    byte-identical inputs.
    """
    images, labels = [], []
    for batch_images, batch_labels in test_ds:
        images.append(batch_images.numpy().astype(np.float32))
        labels.append(batch_labels.numpy())
    np.savez_compressed(
        os.path.join(output_dir, "test_data.npz"),
        images=np.concatenate(images),
        labels=np.concatenate(labels),
    )


def main():
    args = parse_args()
    set_seeds(args.seed)

    import tensorflow as tf
    print(f"TensorFlow {tf.__version__}, GPUs: {len(tf.config.list_physical_devices('GPU'))}")

    os.makedirs(args.output_dir, exist_ok=True)

    manifest = {}
    manifest_path = os.path.join(args.data_dir, "manifest.json")
    if os.path.isfile(manifest_path):
        with open(manifest_path, encoding="utf-8") as f:
            manifest = json.load(f)

    class_names, train_ds, val_ds, test_ds = load_datasets(
        tf, args.data_dir, args.batch_size, args.seed
    )
    num_classes = len(class_names)
    print(f"{num_classes} classes")

    class_weights, train_counts = compute_class_weights(args.data_dir, class_names)

    autotune = tf.data.AUTOTUNE
    train_ds_p = train_ds.cache().shuffle(1000, seed=args.seed).prefetch(autotune)
    val_ds_p = val_ds.cache().prefetch(autotune)

    model, base_model = build_model(tf, num_classes)
    model.compile(
        optimizer="adam",
        loss=tf.keras.losses.SparseCategoricalCrossentropy(),
        metrics=["accuracy"],
    )

    early_stop = tf.keras.callbacks.EarlyStopping(
        monitor="val_accuracy", patience=4, restore_best_weights=True
    )

    print(f"\n=== Phase 1: head training (max {args.epochs} epochs) ===")
    history = model.fit(
        train_ds_p,
        validation_data=val_ds_p,
        epochs=args.epochs,
        class_weight=class_weights,
        callbacks=[early_stop],
    )

    if args.fine_tune:
        print(f"\n=== Phase 2: fine-tuning top block (max {args.fine_tune_epochs} epochs) ===")
        base_model.trainable = True
        # Unfreeze only the last block; small LR to avoid wrecking pretrained features
        for layer in base_model.layers[:-30]:
            layer.trainable = False
        model.compile(
            optimizer=tf.keras.optimizers.Adam(learning_rate=1e-5),
            loss=tf.keras.losses.SparseCategoricalCrossentropy(),
            metrics=["accuracy"],
        )
        model.fit(
            train_ds_p,
            validation_data=val_ds_p,
            epochs=args.fine_tune_epochs,
            class_weight=class_weights,
            callbacks=[tf.keras.callbacks.EarlyStopping(
                monitor="val_accuracy", patience=2, restore_best_weights=True
            )],
        )

    print("\n=== Keras evaluation on test split ===")
    keras_loss, keras_acc = model.evaluate(test_ds, verbose=0)
    print(f"Keras test accuracy: {keras_acc:.4f}")

    # ── Export: clean inference graph → SavedModel → ONNX → INT8 ──────────────
    inference_model = build_inference_model(tf, base_model, model, num_classes)
    saved_model_dir = os.path.join(args.output_dir, "saved_model")
    inference_model.export(saved_model_dir)

    class_names_path = os.path.join(args.output_dir, "class_names.json")
    with open(class_names_path, "w", encoding="utf-8") as f:
        json.dump(class_names, f)

    fp32_path = os.path.join(args.output_dir, "ability_classifier.onnx")
    int8_path = os.path.join(args.output_dir, "ability_classifier_int8.onnx")

    print("\n=== tf2onnx conversion (opset 18) ===")
    result = subprocess.run(
        [sys.executable, "-m", "tf2onnx.convert",
         "--saved-model", saved_model_dir,
         "--output", fp32_path,
         "--opset", "18"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr)
        raise RuntimeError("tf2onnx conversion failed")

    print("=== INT8 dynamic quantization ===")
    from onnxruntime.quantization import quantize_dynamic, QuantType
    quantize_dynamic(model_input=fp32_path, model_output=int8_path,
                     weight_type=QuantType.QInt8)
    int8_mb = os.path.getsize(int8_path) / (1024 * 1024)
    print(f"INT8 model: {int8_mb:.1f} MB")

    # ── Hand-off to the isolated gate step (training/gate.py) ─────────────────
    print("\n=== Exporting test tensors + training summary for the gate ===")
    export_test_tensors(test_ds, args.output_dir)

    added, removed = [], []
    if args.previous_class_names and os.path.isfile(args.previous_class_names):
        with open(args.previous_class_names, encoding="utf-8") as f:
            previous = set(json.load(f))
        current = set(class_names)
        added = sorted(current - previous)
        removed = sorted(previous - current)

    summary = {
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "datasetVersion": manifest.get("version"),
        "datasetCreatedAt": manifest.get("createdAt"),
        "numClasses": num_classes,
        "trainImages": int(train_counts.sum()),
        "seed": args.seed,
        "fineTuned": bool(args.fine_tune),
        "epochsRun": len(history.history.get("accuracy", [])),
        "kerasTestAccuracy": round(float(keras_acc), 5),
        "classesAdded": added,
        "classesRemoved": removed,
        "int8SizeMb": round(int8_mb, 2),
    }
    with open(os.path.join(args.output_dir, "train_summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    print("Training complete. Run training/gate.py (isolated env) for the "
          "INT8 regression gate and report.")


if __name__ == "__main__":
    main()
