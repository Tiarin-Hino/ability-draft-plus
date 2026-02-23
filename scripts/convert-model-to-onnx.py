"""
Convert TF.js Graph Model to ONNX format with INT8 quantization.

Prerequisites:
    pip install tensorflow==2.18.0 tensorflowjs tf2onnx onnx onnxruntime

Usage:
    python scripts/convert-model-to-onnx.py

Input:  ../ability-draft-plus/model/tfjs_model/  (v1 TFJS Graph Model)
Output: resources/model/ability_classifier.onnx       (FP32)
        resources/model/ability_classifier_int8.onnx   (INT8 quantized)
"""

import os
import sys
import json
import shutil
import tempfile
import subprocess
import numpy as np

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
V1_MODEL_DIR = os.path.join(PROJECT_ROOT, "..", "ability-draft-plus", "model", "tfjs_model")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "resources", "model")

ONNX_FP32_PATH = os.path.join(OUTPUT_DIR, "ability_classifier.onnx")
ONNX_INT8_PATH = os.path.join(OUTPUT_DIR, "ability_classifier_int8.onnx")


def check_prerequisites():
    """Verify input files exist."""
    model_json = os.path.join(V1_MODEL_DIR, "model.json")
    if not os.path.exists(model_json):
        print(f"ERROR: model.json not found at {model_json}")
        print("Make sure the v1 project is at ../ability-draft-plus/")
        sys.exit(1)
    print(f"Found v1 model at: {V1_MODEL_DIR}")


def step1_tfjs_to_saved_model(saved_model_dir: str):
    """Convert TFJS Graph Model to TF SavedModel."""
    print("\n=== Step 1: TFJS Graph Model -> TF SavedModel ===")
    cmd = [
        sys.executable, "-m", "tensorflowjs.converters.converter",
        "--input_format=tfjs_graph_model",
        "--output_format=tf_saved_model",
        V1_MODEL_DIR,
        saved_model_dir,
    ]
    print(f"Running: {' '.join(cmd)}")
    subprocess.run(cmd, check=True)
    print(f"SavedModel written to: {saved_model_dir}")


def step2_saved_model_to_onnx(saved_model_dir: str):
    """Convert TF SavedModel to ONNX (opset 18)."""
    print("\n=== Step 2: TF SavedModel -> ONNX (opset 18) ===")
    cmd = [
        sys.executable, "-m", "tf2onnx.convert",
        "--saved-model", saved_model_dir,
        "--output", ONNX_FP32_PATH,
        "--opset", "18",
    ]
    print(f"Running: {' '.join(cmd)}")
    subprocess.run(cmd, check=True)
    size_mb = os.path.getsize(ONNX_FP32_PATH) / (1024 * 1024)
    print(f"ONNX FP32 model written to: {ONNX_FP32_PATH} ({size_mb:.1f} MB)")


def step3_quantize_int8():
    """Apply dynamic INT8 quantization."""
    print("\n=== Step 3: INT8 Dynamic Quantization ===")
    from onnxruntime.quantization import quantize_dynamic, QuantType

    quantize_dynamic(
        model_input=ONNX_FP32_PATH,
        model_output=ONNX_INT8_PATH,
        weight_type=QuantType.QInt8,
    )
    size_mb = os.path.getsize(ONNX_INT8_PATH) / (1024 * 1024)
    print(f"ONNX INT8 model written to: {ONNX_INT8_PATH} ({size_mb:.1f} MB)")


def step4_validate():
    """Validate the ONNX model produces reasonable output."""
    print("\n=== Step 4: Validation ===")
    import onnxruntime as ort

    class_names_path = os.path.join(OUTPUT_DIR, "class_names.json")
    with open(class_names_path) as f:
        class_names = json.load(f)
    print(f"Loaded {len(class_names)} class names")

    # Test both FP32 and INT8 models
    for label, model_path in [("FP32", ONNX_FP32_PATH), ("INT8", ONNX_INT8_PATH)]:
        session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        input_name = session.get_inputs()[0].name
        output_name = session.get_outputs()[0].name

        print(f"\n{label} model:")
        print(f"  Input:  {input_name} shape={session.get_inputs()[0].shape} dtype={session.get_inputs()[0].type}")
        print(f"  Output: {output_name} shape={session.get_outputs()[0].shape} dtype={session.get_outputs()[0].type}")

        # Run inference with random input
        dummy = np.random.rand(1, 96, 96, 3).astype(np.float32) * 255.0
        result = session.run([output_name], {input_name: dummy})
        output = result[0]
        print(f"  Output shape: {output.shape}")
        print(f"  Output range: [{output.min():.4f}, {output.max():.4f}]")
        print(f"  Top prediction: class {output.argmax()} ({class_names[output.argmax()]}) confidence={output.max():.4f}")

    print("\nValidation complete!")


def main():
    check_prerequisites()
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp_dir:
        saved_model_dir = os.path.join(tmp_dir, "saved_model")
        step1_tfjs_to_saved_model(saved_model_dir)
        step2_saved_model_to_onnx(saved_model_dir)

    step3_quantize_int8()
    step4_validate()

    print("\n=== Done! ===")
    print(f"FP32: {ONNX_FP32_PATH}")
    print(f"INT8: {ONNX_INT8_PATH}")


if __name__ == "__main__":
    main()
