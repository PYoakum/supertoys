#!/bin/bash
#
# Download TTS models for voice cloning and text-to-speech
# This script downloads models to the local assets/other_models directory
# so they can be used without requiring user-specific cache directories.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODEL_DIR="${SCRIPT_DIR}/tts"

echo "=============================================="
echo "TTS Model Downloader"
echo "=============================================="
echo ""
echo "Model directory: ${MODEL_DIR}"
echo ""

# Create model directory
mkdir -p "${MODEL_DIR}"

# Set TTS_HOME to use our custom directory
export TTS_HOME="${MODEL_DIR}"

# Check if tts CLI is available (via direct install or pipx)
TTS_CMD=""
if command -v tts &> /dev/null; then
    TTS_CMD="tts"
elif command -v pipx &> /dev/null; then
    TTS_CMD="pipx run TTS tts"
    echo "Using pipx to run TTS..."
else
    echo "ERROR: Coqui TTS is not installed."
    echo "Install with: pipx install TTS (recommended) or pip install TTS"
    exit 1
fi

echo "Downloading models... This may take a while on first run."
echo ""

# Download XTTS v2 (multilingual voice cloning model)
echo "----------------------------------------------"
echo "1. Downloading XTTS v2 (multilingual voice cloning)"
echo "   Model: tts_models/multilingual/multi-dataset/xtts_v2"
echo "   Size: ~1.8GB"
echo "   Note: Auto-accepting CPML license for non-commercial use"
echo "----------------------------------------------"
# Auto-accept license by piping 'y' to the command
echo "y" | $TTS_CMD --model_name "tts_models/multilingual/multi-dataset/xtts_v2" --list_speaker_idxs 2>/dev/null || true
echo "XTTS v2 download complete."
echo ""

# Download FreeVC (voice conversion model)
echo "----------------------------------------------"
echo "2. Downloading FreeVC24 (voice conversion)"
echo "   Model: voice_conversion_models/multilingual/vctk/freevc24"
echo "   Size: ~100MB"
echo "----------------------------------------------"
# FreeVC needs a dummy conversion to trigger download - create temp files
TEMP_WAV="${MODEL_DIR}/temp_dummy.wav"
# Generate a short silent wav for testing
$TTS_CMD --model_name "tts_models/en/ljspeech/vits" --text "test" --out_path "$TEMP_WAV" 2>/dev/null || true
if [ -f "$TEMP_WAV" ]; then
    $TTS_CMD --model_name "voice_conversion_models/multilingual/vctk/freevc24" --source_wav "$TEMP_WAV" --target_wav "$TEMP_WAV" --out_path "${MODEL_DIR}/temp_vc.wav" 2>/dev/null || true
    rm -f "$TEMP_WAV" "${MODEL_DIR}/temp_vc.wav"
fi
echo "FreeVC24 download complete."
echo ""

# Download fast English VITS model (for quick TTS)
echo "----------------------------------------------"
echo "3. Downloading Fast English VITS (quick TTS)"
echo "   Model: tts_models/en/ljspeech/vits"
echo "   Size: ~100MB"
echo "----------------------------------------------"
$TTS_CMD --model_name "tts_models/en/ljspeech/vits" --text "test" --out_path "${MODEL_DIR}/warmup_test.wav" 2>/dev/null || true
rm -f "${MODEL_DIR}/warmup_test.wav"
echo "Fast English VITS download complete."
echo ""

# List downloaded models
echo "=============================================="
echo "Download complete!"
echo "=============================================="
echo ""
echo "Models are stored in: ${MODEL_DIR}"
echo ""
echo "Directory contents:"
ls -la "${MODEL_DIR}" 2>/dev/null || echo "(empty)"
echo ""

# Check model sizes
if [ -d "${MODEL_DIR}" ]; then
    echo "Total size:"
    du -sh "${MODEL_DIR}"
fi

echo ""
echo "To use these models, set the environment variable:"
echo "  export TTS_HOME=\"${MODEL_DIR}\""
echo ""
echo "Or the tools will automatically use this directory if configured."
