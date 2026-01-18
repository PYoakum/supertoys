/**
 * @fileoverview Voice Clone Tool
 * @module voice-clone-tool
 *
 * Tool registry integration for voice cloning using Coqui TTS XTTS v2.
 * Supports voice cloning from reference audio, voice conversion, and
 * multi-lingual speech synthesis with cloned voices.
 */

import { spawn, execSync } from 'child_process';
import { readFile, writeFile, unlink, mkdir, readdir, stat, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, basename, extname, dirname } from 'path';
import { tmpdir, homedir, platform } from 'os';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get the custom TTS model directory in assets
 */
function getCustomModelDir() {
  return join(__dirname, '..', 'assets', 'other_models', 'tts');
}

/**
 * Supported languages for XTTS v2
 */
const XTTS_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'pl', name: 'Polish' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ru', name: 'Russian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'cs', name: 'Czech' },
  { code: 'ar', name: 'Arabic' },
  { code: 'zh-cn', name: 'Chinese (Simplified)' },
  { code: 'ja', name: 'Japanese' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'ko', name: 'Korean' },
  { code: 'hi', name: 'Hindi' }
];

/**
 * XTTS v2 preset speakers
 */
const XTTS_PRESET_SPEAKERS = [
  'Ana Florence',
  'Craig Gutsy',
  'Damien Black',
  'Dionisio Schuyler',
  'Gitta Nikolina',
  'Henriette Usha',
  'Nova Hogarth',
  'Sofia Hellen',
  'Suad Qasim',
  'Tamaru Valeria'
];

/**
 * Supported audio formats for reference
 */
const SUPPORTED_AUDIO_FORMATS = ['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.webm'];

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  tempDir: join(tmpdir(), 'voice-clone-tool'),
  voiceCacheDir: null, // Set per-platform
  xttsModel: 'tts_models/multilingual/multi-dataset/xtts_v2',
  freevcModel: 'voice_conversion_models/multilingual/vctk/freevc24',
  minReferenceSeconds: 3,
  maxReferenceSeconds: 30,
  optimalReferenceSeconds: 6,
  timeout: 600000 // 10 minutes for voice cloning
};

/**
 * Get platform-specific voice cache directory
 */
function getVoiceCacheDir() {
  const plat = platform();
  if (plat === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'voice-clone');
  } else if (plat === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'voice-clone');
  } else {
    return join(homedir(), '.local', 'share', 'voice-clone');
  }
}

/**
 * Check if TTS CLI is available and determine how to run it
 * Returns: { available: boolean, method: 'direct' | 'pipx' | null }
 */
function checkTtsCli() {
  // First check if tts is directly available (e.g., installed via pip in PATH)
  try {
    execSync('which tts', { stdio: 'ignore' });
    return { available: true, method: 'direct' };
  } catch {
    // Not directly available, check for pipx
  }

  // Check if pipx is available and TTS is installed via pipx
  try {
    execSync('which pipx', { stdio: 'ignore' });
    // Check if TTS package is installed in pipx
    const result = execSync('pipx list', { encoding: 'utf-8' });
    if (result.includes('tts') || result.includes('TTS')) {
      return { available: true, method: 'pipx' };
    }
    // pipx is available but TTS not installed - can still use pipx run
    return { available: true, method: 'pipx' };
  } catch {
    // pipx not available
  }

  return { available: false, method: null };
}

/**
 * Check if ffmpeg/ffprobe is available
 */
function checkFfmpeg() {
  try {
    execSync('which ffmpeg', { stdio: 'ignore' });
    execSync('which ffprobe', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a command with timeout
 */
function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout || DEFAULT_CONFIG.timeout;
    const proc = spawn(cmd, args, { env: { ...process.env, ...options.env } });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Command timed out: ${cmd}`));
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${cmd} failed (code ${code}): ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`${cmd} error: ${err.message}`));
    });
  });
}

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get audio info using ffprobe
 */
async function getAudioInfo(filePath) {
  try {
    const result = await runCommand('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ], { timeout: 10000 });

    const info = JSON.parse(result.stdout);
    const audioStream = info.streams?.find(s => s.codec_type === 'audio');

    return {
      duration: parseFloat(info.format?.duration || 0),
      sampleRate: parseInt(audioStream?.sample_rate || 0),
      channels: parseInt(audioStream?.channels || 0),
      codec: audioStream?.codec_name || null
    };
  } catch {
    return { duration: 0, sampleRate: 0, channels: 0, codec: null };
  }
}

/**
 * Get audio volume level using ffmpeg volumedetect
 * Returns max_volume in dB (e.g., -30.5 for normal audio, -91.0 for silence)
 */
async function getAudioLevel(filePath) {
  try {
    const result = await runCommand('ffmpeg', [
      '-i', filePath,
      '-af', 'volumedetect',
      '-f', 'null',
      '-'
    ], { timeout: 30000 });

    // volumedetect outputs to stderr
    const output = result.stderr;
    const maxMatch = output.match(/max_volume:\s*([-\d.]+)\s*dB/);
    if (maxMatch) {
      return parseFloat(maxMatch[1]);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Voice Clone Tool Class
 */
export class VoiceCloneTool {
  /**
   * @param {Object} sessionManager - Session manager instance
   * @param {Object} options - Configuration options
   */
  constructor(sessionManager, options = {}) {
    this.sessionManager = sessionManager;
    this.config = {
      ...DEFAULT_CONFIG,
      voiceCacheDir: getVoiceCacheDir(),
      ...options
    };

    const ttsStatus = checkTtsCli();
    this.hasTts = ttsStatus.available;
    this.ttsMethod = ttsStatus.method; // 'direct' | 'pipx' | null
    this.hasFfmpeg = checkFfmpeg();
    this.warmedUpModels = new Set(); // Track which models have been warmed up

    // Set up custom model directory if it exists
    const customModelDir = getCustomModelDir();
    this.ttsEnv = existsSync(customModelDir) ? { TTS_HOME: customModelDir } : {};
  }

  /**
   * Get environment variables for TTS commands
   */
  _getTtsEnv() {
    return this.ttsEnv;
  }

  /**
   * Run a TTS command using the appropriate method (direct or pipx)
   * @param {string[]} args - Arguments to pass to the tts command
   * @param {Object} options - Options for runCommand
   * @returns {Promise<{stdout: string, stderr: string}>}
   */
  async _runTts(args, options = {}) {
    const env = { ...this._getTtsEnv(), ...options.env };
    const timeout = options.timeout || this.config.timeout;

    if (this.ttsMethod === 'pipx') {
      // Use pipx run TTS tts <args>
      return runCommand('pipx', ['run', 'TTS', 'tts', ...args], { ...options, env, timeout });
    } else {
      // Direct tts command
      return runCommand('tts', args, { ...options, env, timeout });
    }
  }

  /**
   * Warm up a model by running a short test synthesis
   * This ensures the model is fully loaded before actual synthesis
   */
  async _warmupModel(model) {
    if (this.warmedUpModels.has(model)) {
      return; // Already warmed up
    }

    await this._ensureDirs();
    const warmupPath = join(this.config.tempDir, `warmup_${Date.now()}.wav`);

    try {
      // Run a short test synthesis to load the model
      const args = [
        '--text', 'test',
        '--model_name', model,
        '--out_path', warmupPath
      ];

      // XTTS needs language
      if (model.includes('xtts')) {
        args.push('--language_idx', 'en');
      }

      await this._runTts(args, { timeout: this.config.timeout });

      // Give the model a moment to stabilize
      await sleep(1000);

      this.warmedUpModels.add(model);
    } catch (err) {
      // Warmup failed, but we'll still try the actual synthesis
      console.error(`Model warmup failed for ${model}:`, err.message);
    } finally {
      // Clean up warmup file
      await unlink(warmupPath).catch(() => {});
    }
  }

  /**
   * Ensure directories exist
   */
  async _ensureDirs() {
    if (!existsSync(this.config.tempDir)) {
      await mkdir(this.config.tempDir, { recursive: true });
    }
    if (!existsSync(this.config.voiceCacheDir)) {
      await mkdir(this.config.voiceCacheDir, { recursive: true });
    }
  }

  /**
   * Resolve file path relative to session
   */
  _resolvePath(filePath, session) {
    if (!filePath) return null;
    if (session?.sandboxPath && !filePath.startsWith('/')) {
      return resolve(join(session.sandboxPath, filePath));
    }
    return resolve(filePath);
  }

  /**
   * Validate reference audio file
   */
  async _validateReferenceAudio(filePath) {
    if (!existsSync(filePath)) {
      throw new Error(`Reference audio not found: ${filePath}`);
    }

    const ext = extname(filePath).toLowerCase();
    if (!SUPPORTED_AUDIO_FORMATS.includes(ext)) {
      throw new Error(`Unsupported format: ${ext}. Supported: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`);
    }

    const info = await getAudioInfo(filePath);

    if (info.duration < this.config.minReferenceSeconds) {
      throw new Error(`Reference audio too short (${info.duration.toFixed(1)}s). Minimum: ${this.config.minReferenceSeconds}s`);
    }

    if (info.duration > this.config.maxReferenceSeconds) {
      // Warn but don't error - will be truncated
      return {
        valid: true,
        warning: `Reference audio long (${info.duration.toFixed(1)}s). Will use first ${this.config.maxReferenceSeconds}s.`,
        ...info
      };
    }

    return { valid: true, ...info };
  }

  /**
   * Preprocess reference audio (convert to WAV 22050Hz mono if needed)
   */
  async _preprocessAudio(inputPath) {
    await this._ensureDirs();

    const outputPath = join(this.config.tempDir, `ref_${Date.now()}.wav`);

    // Convert to WAV 22050Hz mono, trim to max length
    await runCommand('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-t', String(this.config.maxReferenceSeconds),
      '-ar', '22050',
      '-ac', '1',
      outputPath
    ]);

    return outputPath;
  }

  /**
   * Generate speaker ID from reference audio
   */
  _generateSpeakerId(referenceAudio) {
    const hash = crypto.createHash('sha256');
    hash.update(referenceAudio);
    return hash.digest('hex').slice(0, 16);
  }

  /**
   * Handle clone action - synthesize with cloned voice
   */
  async _handleClone(args, session) {
    const {
      text,
      reference_audio,
      language = 'en',
      output_format = 'wav',
      output_path
    } = args;

    if (!text) throw new Error('text is required');
    if (!reference_audio) throw new Error('reference_audio is required');

    if (!this.hasTts) {
      throw new Error('Coqui TTS is not installed. Install with: pipx install TTS (recommended) or pip install TTS');
    }

    // Validate language
    const langValid = XTTS_LANGUAGES.some(l => l.code === language);
    if (!langValid) {
      throw new Error(`Unsupported language: ${language}. Supported: ${XTTS_LANGUAGES.map(l => l.code).join(', ')}`);
    }

    await this._ensureDirs();

    // Resolve and validate reference audio
    const refPath = this._resolvePath(reference_audio, session);
    const validation = await this._validateReferenceAudio(refPath);

    // Preprocess reference audio
    const processedRef = await this._preprocessAudio(refPath);

    try {
      // Determine output path
      const ext = output_format.startsWith('.') ? output_format : `.${output_format}`;
      let finalPath;

      if (output_path) {
        finalPath = this._resolvePath(output_path, session);
      } else {
        finalPath = join(this.config.tempDir, `clone_output_${Date.now()}${ext}`);
      }

      // Ensure parent directory exists
      const parentDir = dirname(finalPath);
      if (!existsSync(parentDir)) {
        await mkdir(parentDir, { recursive: true });
      }

      // Create temp WAV output
      const tempOutput = join(this.config.tempDir, `clone_temp_${Date.now()}.wav`);

      // Warm up the model to ensure it's fully loaded
      await this._warmupModel(this.config.xttsModel);

      // Run TTS with XTTS and speaker_wav
      await this._runTts([
        '--text', text,
        '--model_name', this.config.xttsModel,
        '--speaker_wav', processedRef,
        '--language_idx', language,
        '--out_path', tempOutput
      ], { timeout: this.config.timeout });

      // Convert to final format if needed
      if (ext !== '.wav' && this.hasFfmpeg) {
        await runCommand('ffmpeg', [
          '-y',
          '-i', tempOutput,
          '-b:a', '192k',
          finalPath
        ]);
        await unlink(tempOutput).catch(() => {});
      } else {
        // Rename to final path
        const content = await readFile(tempOutput);
        await writeFile(finalPath, content);
        await unlink(tempOutput).catch(() => {});
      }

      // Get output info and audio level
      const outputInfo = await getAudioInfo(finalPath);
      const audioLevelDb = await getAudioLevel(finalPath);
      const isSilent = audioLevelDb !== null && audioLevelDb < -80;

      return {
        success: true,
        output_path: finalPath,
        duration_ms: Math.round(outputInfo.duration * 1000),
        max_volume_db: audioLevelDb,
        is_silent: isSilent,
        text_length: text.length,
        language,
        reference_duration_s: validation.duration,
        warning: isSilent ? 'Audio output appears to be silent' : (validation.warning || undefined),
        model_used: this.config.xttsModel
      };
    } finally {
      // Cleanup preprocessed reference
      await unlink(processedRef).catch(() => {});
    }
  }

  /**
   * Handle convert action - voice conversion
   */
  async _handleConvert(args, session) {
    const {
      source_audio,
      target_audio,
      output_path
    } = args;

    if (!source_audio) throw new Error('source_audio is required');
    if (!target_audio) throw new Error('target_audio is required');

    if (!this.hasTts) {
      throw new Error('Coqui TTS is not installed. Install with: pipx install TTS (recommended) or pip install TTS');
    }

    await this._ensureDirs();

    // Resolve paths
    const sourcePath = this._resolvePath(source_audio, session);
    const targetPath = this._resolvePath(target_audio, session);

    // Validate files
    if (!existsSync(sourcePath)) {
      throw new Error(`Source audio not found: ${source_audio}`);
    }
    if (!existsSync(targetPath)) {
      throw new Error(`Target audio not found: ${target_audio}`);
    }

    // Get info
    const sourceInfo = await getAudioInfo(sourcePath);
    const targetInfo = await getAudioInfo(targetPath);

    // Determine output path
    let finalPath;
    if (output_path) {
      finalPath = this._resolvePath(output_path, session);
    } else {
      finalPath = join(this.config.tempDir, `convert_${Date.now()}.wav`);
    }

    // Ensure parent directory exists
    const parentDir = dirname(finalPath);
    if (!existsSync(parentDir)) {
      await mkdir(parentDir, { recursive: true });
    }

    // Warm up the model
    await this._warmupModel(this.config.freevcModel);

    // Run voice conversion
    await this._runTts([
      '--model_name', this.config.freevcModel,
      '--source_wav', sourcePath,
      '--target_wav', targetPath,
      '--out_path', finalPath
    ], { timeout: this.config.timeout });

    // Get output info and audio level
    const outputInfo = await getAudioInfo(finalPath);
    const audioLevelDb = await getAudioLevel(finalPath);
    const isSilent = audioLevelDb !== null && audioLevelDb < -80;

    return {
      success: true,
      output_path: finalPath,
      duration_ms: Math.round(outputInfo.duration * 1000),
      max_volume_db: audioLevelDb,
      is_silent: isSilent,
      source_duration_s: sourceInfo.duration,
      target_duration_s: targetInfo.duration,
      model_used: this.config.freevcModel,
      warning: isSilent ? 'Audio output appears to be silent' : undefined
    };
  }

  /**
   * Handle synthesize action - use cached speaker or preset
   */
  async _handleSynthesize(args, session) {
    const {
      text,
      speaker_id,
      preset_speaker,
      language = 'en',
      output_format = 'wav',
      output_path
    } = args;

    if (!text) throw new Error('text is required');

    if (!this.hasTts) {
      throw new Error('Coqui TTS is not installed. Install with: pipx install TTS (recommended) or pip install TTS');
    }

    await this._ensureDirs();

    // Determine output
    const ext = output_format.startsWith('.') ? output_format : `.${output_format}`;
    let finalPath;

    if (output_path) {
      finalPath = this._resolvePath(output_path, session);
    } else {
      finalPath = join(this.config.tempDir, `synth_${Date.now()}${ext}`);
    }

    // Ensure parent directory exists
    const parentDir = dirname(finalPath);
    if (!existsSync(parentDir)) {
      await mkdir(parentDir, { recursive: true });
    }

    const tempOutput = join(this.config.tempDir, `synth_temp_${Date.now()}.wav`);

    // Build TTS command
    const ttsArgs = [
      '--text', text,
      '--model_name', this.config.xttsModel,
      '--language_idx', language,
      '--out_path', tempOutput
    ];

    // Use cached speaker
    if (speaker_id) {
      const speakerPath = join(this.config.voiceCacheDir, speaker_id, 'reference.wav');
      if (!existsSync(speakerPath)) {
        throw new Error(`Speaker not found: ${speaker_id}. Use list_speakers to see cached speakers.`);
      }
      ttsArgs.push('--speaker_wav', speakerPath);
    }
    // Use preset speaker
    else if (preset_speaker) {
      if (!XTTS_PRESET_SPEAKERS.includes(preset_speaker)) {
        throw new Error(`Unknown preset speaker: ${preset_speaker}. Available: ${XTTS_PRESET_SPEAKERS.join(', ')}`);
      }
      ttsArgs.push('--speaker_idx', preset_speaker);
    }

    // Warm up the model
    await this._warmupModel(this.config.xttsModel);

    await this._runTts(ttsArgs, { timeout: this.config.timeout });

    // Convert format if needed
    if (ext !== '.wav' && this.hasFfmpeg) {
      await runCommand('ffmpeg', ['-y', '-i', tempOutput, '-b:a', '192k', finalPath]);
      await unlink(tempOutput).catch(() => {});
    } else {
      const content = await readFile(tempOutput);
      await writeFile(finalPath, content);
      await unlink(tempOutput).catch(() => {});
    }

    // Get output info and audio level
    const outputInfo = await getAudioInfo(finalPath);
    const audioLevelDb = await getAudioLevel(finalPath);
    const isSilent = audioLevelDb !== null && audioLevelDb < -80;

    return {
      success: true,
      output_path: finalPath,
      duration_ms: Math.round(outputInfo.duration * 1000),
      max_volume_db: audioLevelDb,
      is_silent: isSilent,
      text_length: text.length,
      language,
      speaker: speaker_id || preset_speaker || 'default',
      warning: isSilent ? 'Audio output appears to be silent' : undefined
    };
  }

  /**
   * Handle extract_speaker action - cache speaker embedding
   */
  async _handleExtractSpeaker(args, session) {
    const { reference_audio, speaker_id, name, consent = false } = args;

    if (!reference_audio) throw new Error('reference_audio is required');
    if (!consent) {
      throw new Error('consent flag required to confirm you have permission to clone this voice');
    }

    await this._ensureDirs();

    // Resolve and validate reference
    const refPath = this._resolvePath(reference_audio, session);
    const validation = await this._validateReferenceAudio(refPath);

    // Generate or use provided speaker ID
    const speakerId = speaker_id || this._generateSpeakerId(refPath);
    const speakerDir = join(this.config.voiceCacheDir, speakerId);

    if (!existsSync(speakerDir)) {
      await mkdir(speakerDir, { recursive: true });
    }

    // Preprocess and copy reference audio
    const processedRef = await this._preprocessAudio(refPath);
    const savedRefPath = join(speakerDir, 'reference.wav');
    await copyFile(processedRef, savedRefPath);
    await unlink(processedRef).catch(() => {});

    // Save metadata
    const metadata = {
      speaker_id: speakerId,
      name: name || speakerId,
      source_file: basename(refPath),
      duration_s: validation.duration,
      sample_rate: validation.sampleRate,
      created_at: new Date().toISOString(),
      model: this.config.xttsModel
    };

    await writeFile(
      join(speakerDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    );

    return {
      success: true,
      speaker_id: speakerId,
      name: metadata.name,
      reference_path: savedRefPath,
      duration_s: validation.duration,
      warning: validation.warning || undefined
    };
  }

  /**
   * Handle list_speakers action
   */
  async _handleListSpeakers() {
    await this._ensureDirs();

    const speakers = [];

    // List cached speakers
    try {
      const dirs = await readdir(this.config.voiceCacheDir);

      for (const dir of dirs) {
        const metaPath = join(this.config.voiceCacheDir, dir, 'metadata.json');
        if (existsSync(metaPath)) {
          try {
            const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
            speakers.push({
              speaker_id: meta.speaker_id,
              name: meta.name,
              duration_s: meta.duration_s,
              created_at: meta.created_at,
              type: 'cached'
            });
          } catch {}
        }
      }
    } catch {}

    // Add preset speakers
    for (const preset of XTTS_PRESET_SPEAKERS) {
      speakers.push({
        speaker_id: preset,
        name: preset,
        type: 'preset'
      });
    }

    return {
      success: true,
      speakers,
      cached_count: speakers.filter(s => s.type === 'cached').length,
      preset_count: XTTS_PRESET_SPEAKERS.length,
      voice_cache_dir: this.config.voiceCacheDir
    };
  }

  /**
   * Handle delete_speaker action
   */
  async _handleDeleteSpeaker(args) {
    const { speaker_id } = args;
    if (!speaker_id) throw new Error('speaker_id is required');

    // Don't allow deleting preset speakers
    if (XTTS_PRESET_SPEAKERS.includes(speaker_id)) {
      throw new Error('Cannot delete preset speaker');
    }

    const speakerDir = join(this.config.voiceCacheDir, speaker_id);
    if (!existsSync(speakerDir)) {
      throw new Error(`Speaker not found: ${speaker_id}`);
    }

    // Remove directory contents
    const files = await readdir(speakerDir);
    for (const file of files) {
      await unlink(join(speakerDir, file)).catch(() => {});
    }

    // Remove directory
    await unlink(speakerDir).catch(() => {});

    return {
      success: true,
      deleted_speaker: speaker_id
    };
  }

  /**
   * Handle list_languages action
   */
  async _handleListLanguages() {
    return {
      success: true,
      languages: XTTS_LANGUAGES,
      count: XTTS_LANGUAGES.length
    };
  }

  /**
   * Handle validate_audio action
   */
  async _handleValidateAudio(args, session) {
    const { audio_path } = args;
    if (!audio_path) throw new Error('audio_path is required');

    const filePath = this._resolvePath(audio_path, session);

    if (!existsSync(filePath)) {
      return {
        success: true,
        valid: false,
        error: 'File not found'
      };
    }

    try {
      const validation = await this._validateReferenceAudio(filePath);
      return {
        success: true,
        valid: true,
        duration_s: validation.duration,
        sample_rate: validation.sampleRate,
        channels: validation.channels,
        codec: validation.codec,
        optimal: validation.duration >= this.config.optimalReferenceSeconds,
        warning: validation.warning || undefined
      };
    } catch (err) {
      return {
        success: true,
        valid: false,
        error: err.message
      };
    }
  }

  /**
   * Handle check_backends action
   */
  async _handleCheckBackends() {
    // Check for GPU
    let hasGpu = false;
    try {
      const result = await runCommand('python3', ['-c', 'import torch; print(torch.cuda.is_available())'], { timeout: 10000 });
      hasGpu = result.stdout.trim().toLowerCase() === 'true';
    } catch {}

    return {
      success: true,
      tts_available: this.hasTts,
      ffmpeg_available: this.hasFfmpeg,
      gpu_available: hasGpu,
      ready: this.hasTts && this.hasFfmpeg,
      xtts_model: this.config.xttsModel,
      freevc_model: this.config.freevcModel,
      voice_cache_dir: this.config.voiceCacheDir,
      min_reference_seconds: this.config.minReferenceSeconds,
      max_reference_seconds: this.config.maxReferenceSeconds,
      optimal_reference_seconds: this.config.optimalReferenceSeconds
    };
  }

  /**
   * Main handler for tool execution
   * @param {Object} args - Tool arguments
   * @param {Object} session - Session object
   * @returns {Promise<Object>}
   */
  async handle(args, session) {
    const { action } = args;

    switch (action) {
      case 'clone': return this._handleClone(args, session);
      case 'convert': return this._handleConvert(args, session);
      case 'synthesize': return this._handleSynthesize(args, session);
      case 'extract_speaker': return this._handleExtractSpeaker(args, session);
      case 'list_speakers': return this._handleListSpeakers();
      case 'delete_speaker': return this._handleDeleteSpeaker(args);
      case 'list_languages': return this._handleListLanguages();
      case 'validate_audio': return this._handleValidateAudio(args, session);
      case 'check_backends': return this._handleCheckBackends();
      default:
        throw new Error(`Unknown action: ${action}. Valid actions: clone, convert, synthesize, extract_speaker, list_speakers, delete_speaker, list_languages, validate_audio, check_backends`);
    }
  }

  /**
   * Register tools with the router
   * @param {ToolRouter} router - Tool router instance
   */
  registerTools(router) {
    router.registerTool('voice_clone', this.handle.bind(this), {
      name: 'voice_clone',
      description: 'Voice cloning and synthesis using Coqui TTS XTTS v2 - clone voices from reference audio',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['clone', 'convert', 'synthesize', 'extract_speaker', 'list_speakers', 'delete_speaker', 'list_languages', 'validate_audio', 'check_backends'],
            description: 'Action to perform'
          },
          text: {
            type: 'string',
            description: 'Text to synthesize (for clone/synthesize actions)'
          },
          reference_audio: {
            type: 'string',
            description: 'Path to reference audio for voice cloning (6+ seconds recommended)'
          },
          source_audio: {
            type: 'string',
            description: 'Source audio for voice conversion'
          },
          target_audio: {
            type: 'string',
            description: 'Target voice audio for conversion'
          },
          speaker_id: {
            type: 'string',
            description: 'Cached speaker ID'
          },
          preset_speaker: {
            type: 'string',
            description: 'XTTS preset speaker name'
          },
          language: {
            type: 'string',
            description: 'Language code (default: en)'
          },
          output_format: {
            type: 'string',
            enum: ['wav', 'mp3', 'ogg'],
            description: 'Output audio format'
          },
          output_path: {
            type: 'string',
            description: 'Path for output file'
          },
          name: {
            type: 'string',
            description: 'Friendly name for cached speaker'
          },
          consent: {
            type: 'boolean',
            description: 'Confirm permission to clone voice (required for extract_speaker)'
          },
          audio_path: {
            type: 'string',
            description: 'Audio file to validate'
          }
        },
        required: ['action']
      }
    });

    // Quick clone tool
    router.registerTool('clone_voice', async (args, session) => {
      return this.handle({
        action: 'clone',
        text: args.text,
        reference_audio: args.reference,
        language: args.language,
        output_format: args.format,
        output_path: args.output_path
      }, session);
    }, {
      name: 'clone_voice',
      description: 'Quick voice cloning - synthesize speech with a cloned voice',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to speak' },
          reference: { type: 'string', description: 'Reference audio file path' },
          language: { type: 'string', description: 'Language code (default: en)' },
          format: { type: 'string', description: 'Output format (wav, mp3)' },
          output_path: { type: 'string', description: 'Output file path' }
        },
        required: ['text', 'reference']
      }
    });

    // Voice conversion tool
    router.registerTool('convert_voice', async (args, session) => {
      return this.handle({
        action: 'convert',
        source_audio: args.source,
        target_audio: args.target,
        output_path: args.output_path
      }, session);
    }, {
      name: 'convert_voice',
      description: 'Convert voice in audio to match target speaker voice',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Source audio with content to keep' },
          target: { type: 'string', description: 'Target audio with voice to match' },
          output_path: { type: 'string', description: 'Output file path' }
        },
        required: ['source', 'target']
      }
    });
  }
}

export default VoiceCloneTool;
