/**
 * @fileoverview Text-to-Speech Tool
 * @module tts-tool
 *
 * Tool registry integration for text-to-speech synthesis using Coqui TTS.
 * Supports multiple models, voices, and 1100+ languages via Fairseq.
 */

import { spawn, execSync } from 'child_process';
import { readFile, writeFile, unlink, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, extname } from 'path';
import { tmpdir, homedir, platform } from 'os';

/**
 * Common TTS models
 */
const COMMON_MODELS = {
  // Fast models (good for quick synthesis)
  'fast_en': {
    name: 'tts_models/en/ljspeech/glow-tts',
    description: 'Fast English synthesis (LJSpeech Glow-TTS)',
    language: 'en',
    quality: 'fast',
    multi_speaker: false
  },
  'fast_en_vits': {
    name: 'tts_models/en/ljspeech/vits',
    description: 'Fast English VITS (end-to-end)',
    language: 'en',
    quality: 'fast',
    multi_speaker: false
  },

  // High quality models
  'vctk_vits': {
    name: 'tts_models/en/vctk/vits',
    description: 'High quality English with 100+ speakers',
    language: 'en',
    quality: 'high',
    multi_speaker: true
  },

  // Multilingual models
  'xtts_v2': {
    name: 'tts_models/multilingual/multi-dataset/xtts_v2',
    description: 'XTTS v2 - Multilingual with voice cloning',
    language: 'multilingual',
    quality: 'high',
    multi_speaker: true
  },
  'your_tts': {
    name: 'tts_models/multilingual/multi-dataset/your_tts',
    description: 'YourTTS - Multilingual voice transfer',
    language: 'multilingual',
    quality: 'high',
    multi_speaker: true
  },

  // Tacotron2 models
  'tacotron2_en': {
    name: 'tts_models/en/ljspeech/tacotron2-DDC',
    description: 'Tacotron2 DDC English',
    language: 'en',
    quality: 'balanced',
    multi_speaker: false
  }
};

/**
 * Language codes supported by Fairseq models
 */
const COMMON_LANGUAGES = [
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
 * Default configuration
 */
const DEFAULT_CONFIG = {
  tempDir: join(tmpdir(), 'tts-tool'),
  modelCacheDir: null, // Set per-platform
  defaultModel: 'tts_models/en/ljspeech/vits',
  defaultSampleRate: 22050,
  maxTextLength: 5000,
  chunkSize: 500,
  timeout: 300000 // 5 minutes
};

/**
 * Get platform-specific model cache directory
 */
function getModelCacheDir() {
  const plat = platform();
  if (plat === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'tts');
  } else if (plat === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'tts');
  } else {
    return join(homedir(), '.local', 'share', 'tts');
  }
}

/**
 * Check if TTS CLI is available
 */
function checkTtsCli() {
  try {
    execSync('which tts', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if ffmpeg is available
 */
function checkFfmpeg() {
  try {
    execSync('which ffmpeg', { stdio: 'ignore' });
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
 * Get audio duration using ffprobe
 */
async function getAudioDuration(filePath) {
  try {
    const result = await runCommand('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath
    ], { timeout: 10000 });

    const info = JSON.parse(result.stdout);
    return parseFloat(info.format?.duration || 0) * 1000;
  } catch {
    return 0;
  }
}

/**
 * Text-to-Speech Tool Class
 */
export class TtsTool {
  /**
   * @param {Object} sessionManager - Session manager instance
   * @param {Object} options - Configuration options
   */
  constructor(sessionManager, options = {}) {
    this.sessionManager = sessionManager;
    this.config = {
      ...DEFAULT_CONFIG,
      modelCacheDir: getModelCacheDir(),
      ...options
    };

    this.hasTts = checkTtsCli();
    this.hasFfmpeg = checkFfmpeg();
    this.modelCache = null; // Cached model list
  }

  /**
   * Ensure temp directory exists
   */
  async _ensureTempDir() {
    if (!existsSync(this.config.tempDir)) {
      await mkdir(this.config.tempDir, { recursive: true });
    }
  }

  /**
   * Resolve model name from shorthand or full path
   */
  _resolveModel(modelName) {
    if (!modelName) return this.config.defaultModel;

    // Check shortcuts
    if (COMMON_MODELS[modelName]) {
      return COMMON_MODELS[modelName].name;
    }

    // Check if it looks like a full model path
    if (modelName.includes('/')) {
      return modelName;
    }

    // Try to find matching model
    const lower = modelName.toLowerCase();
    for (const [key, model] of Object.entries(COMMON_MODELS)) {
      if (key.toLowerCase().includes(lower) ||
          model.name.toLowerCase().includes(lower)) {
        return model.name;
      }
    }

    return modelName;
  }

  /**
   * Get list of available models from TTS
   */
  async _getModelList() {
    if (this.modelCache) return this.modelCache;

    try {
      const result = await runCommand('tts', ['--list_models'], { timeout: 30000 });
      const lines = result.stdout.split('\n');
      const models = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('tts_models/') || trimmed.startsWith('vocoder_models/')) {
          models.push(trimmed);
        }
      }

      this.modelCache = models;
      return models;
    } catch (err) {
      return Object.values(COMMON_MODELS).map(m => m.name);
    }
  }

  /**
   * Split long text into chunks at sentence boundaries
   */
  _splitText(text, maxLength = this.config.chunkSize) {
    if (text.length <= maxLength) {
      return [text];
    }

    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Try to split at sentence boundary
      let splitIndex = maxLength;
      const sentenceEnders = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];

      for (const ender of sentenceEnders) {
        const lastEnder = remaining.lastIndexOf(ender, maxLength);
        if (lastEnder > maxLength / 2) {
          splitIndex = lastEnder + ender.length;
          break;
        }
      }

      // Fallback to word boundary
      if (splitIndex === maxLength) {
        const lastSpace = remaining.lastIndexOf(' ', maxLength);
        if (lastSpace > maxLength / 2) {
          splitIndex = lastSpace + 1;
        }
      }

      chunks.push(remaining.slice(0, splitIndex).trim());
      remaining = remaining.slice(splitIndex).trim();
    }

    return chunks;
  }

  /**
   * Synthesize single chunk of text
   */
  async _synthesizeChunk(text, model, options = {}) {
    const { speaker, language, outputPath } = options;

    const args = [
      '--text', text,
      '--model_name', model,
      '--out_path', outputPath
    ];

    if (speaker) {
      args.push('--speaker_idx', speaker);
    }

    if (language) {
      args.push('--language_idx', language);
    }

    await runCommand('tts', args, { timeout: this.config.timeout });

    return outputPath;
  }

  /**
   * Concatenate audio chunks using ffmpeg
   */
  async _concatenateChunks(chunkPaths, outputPath) {
    if (chunkPaths.length === 1) {
      // Just copy the single chunk
      const content = await readFile(chunkPaths[0]);
      await writeFile(outputPath, content);
      return;
    }

    // Create file list for ffmpeg concat
    const listPath = join(this.config.tempDir, `concat_${Date.now()}.txt`);
    const listContent = chunkPaths.map(p => `file '${p}'`).join('\n');
    await writeFile(listPath, listContent);

    try {
      await runCommand('ffmpeg', [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', listPath,
        '-c', 'copy',
        outputPath
      ]);
    } finally {
      await unlink(listPath).catch(() => {});
    }
  }

  /**
   * Convert audio format using ffmpeg
   */
  async _convertFormat(inputPath, outputPath, format, options = {}) {
    const { sampleRate, bitrate } = options;

    const args = ['-y', '-i', inputPath];

    if (sampleRate) {
      args.push('-ar', String(sampleRate));
    }

    if (format === 'mp3' && bitrate) {
      args.push('-b:a', bitrate);
    }

    args.push(outputPath);

    await runCommand('ffmpeg', args);
  }

  /**
   * Handle synthesize action
   */
  async _handleSynthesize(args, session) {
    const {
      text,
      model,
      speaker,
      language,
      output_format = 'wav',
      output_path,
      speed = 1.0
    } = args;

    if (!text) throw new Error('text is required');

    if (!this.hasTts) {
      throw new Error('Coqui TTS is not installed. Install with: pip install TTS');
    }

    if (text.length > this.config.maxTextLength) {
      throw new Error(`Text too long (${text.length} chars). Maximum: ${this.config.maxTextLength}`);
    }

    await this._ensureTempDir();

    const resolvedModel = this._resolveModel(model);

    // Split text into chunks for long texts
    const textChunks = this._splitText(text);
    const chunkPaths = [];

    try {
      // Synthesize each chunk
      for (let i = 0; i < textChunks.length; i++) {
        const chunkPath = join(this.config.tempDir, `chunk_${Date.now()}_${i}.wav`);
        await this._synthesizeChunk(textChunks[i], resolvedModel, {
          speaker,
          language,
          outputPath: chunkPath
        });
        chunkPaths.push(chunkPath);
      }

      // Determine output path
      const ext = output_format.startsWith('.') ? output_format : `.${output_format}`;
      let finalPath;

      if (output_path) {
        finalPath = session?.sandboxPath && !output_path.startsWith('/')
          ? resolve(join(session.sandboxPath, output_path))
          : resolve(output_path);
      } else {
        finalPath = join(this.config.tempDir, `tts_output_${Date.now()}${ext}`);
      }

      // Concatenate chunks if needed
      const concatenatedPath = join(this.config.tempDir, `concat_${Date.now()}.wav`);
      await this._concatenateChunks(chunkPaths, concatenatedPath);

      // Convert to final format if needed
      if (ext !== '.wav' && this.hasFfmpeg) {
        await this._convertFormat(concatenatedPath, finalPath, output_format.replace('.', ''), {
          bitrate: '192k'
        });
        await unlink(concatenatedPath).catch(() => {});
      } else {
        // Just rename/copy
        const content = await readFile(concatenatedPath);
        await writeFile(finalPath, content);
        await unlink(concatenatedPath).catch(() => {});
      }

      // Get duration
      const durationMs = await getAudioDuration(finalPath);

      return {
        success: true,
        output_path: finalPath,
        duration_ms: Math.round(durationMs),
        characters_processed: text.length,
        chunks_processed: textChunks.length,
        model_used: resolvedModel,
        speaker_used: speaker || null,
        language_used: language || null,
        format: output_format
      };
    } finally {
      // Cleanup chunk files
      for (const chunkPath of chunkPaths) {
        await unlink(chunkPath).catch(() => {});
      }
    }
  }

  /**
   * Handle list_models action
   */
  async _handleListModels() {
    const allModels = await this._getModelList();

    // Filter to TTS models only
    const ttsModels = allModels.filter(m => m.startsWith('tts_models/'));
    const vocoderModels = allModels.filter(m => m.startsWith('vocoder_models/'));

    // Add metadata for common models
    const modelsWithInfo = ttsModels.map(name => {
      const commonEntry = Object.entries(COMMON_MODELS).find(([, m]) => m.name === name);
      if (commonEntry) {
        return {
          name,
          shorthand: commonEntry[0],
          ...commonEntry[1]
        };
      }
      // Extract info from name
      const parts = name.split('/');
      return {
        name,
        language: parts[1] || 'unknown',
        dataset: parts[2] || 'unknown',
        architecture: parts[3] || 'unknown'
      };
    });

    return {
      success: true,
      tts_models: modelsWithInfo,
      vocoder_models: vocoderModels,
      total_tts_models: ttsModels.length,
      total_vocoder_models: vocoderModels.length,
      recommended: Object.entries(COMMON_MODELS).map(([key, model]) => ({
        shorthand: key,
        ...model
      }))
    };
  }

  /**
   * Handle list_speakers action
   */
  async _handleListSpeakers(args) {
    const { model } = args;

    if (!model) throw new Error('model is required');

    const resolvedModel = this._resolveModel(model);

    try {
      const result = await runCommand('tts', [
        '--model_name', resolvedModel,
        '--list_speaker_idxs'
      ], { timeout: 60000 });

      // Parse speaker output
      const speakers = [];
      const lines = result.stdout.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('>') && !trimmed.includes('model')) {
          speakers.push(trimmed);
        }
      }

      return {
        success: true,
        model: resolvedModel,
        speakers,
        speaker_count: speakers.length
      };
    } catch (err) {
      return {
        success: true,
        model: resolvedModel,
        speakers: [],
        speaker_count: 0,
        note: 'This model may not support multiple speakers'
      };
    }
  }

  /**
   * Handle list_languages action
   */
  async _handleListLanguages() {
    // Return common languages and note about Fairseq
    return {
      success: true,
      languages: COMMON_LANGUAGES,
      common_count: COMMON_LANGUAGES.length,
      fairseq_note: 'Additional 1100+ languages available via Fairseq VITS models (tts_models/<lang>/fairseq/vits)',
      multilingual_models: ['xtts_v2', 'your_tts']
    };
  }

  /**
   * Handle get_model_info action
   */
  async _handleGetModelInfo(args) {
    const { model } = args;

    if (!model) throw new Error('model is required');

    const resolvedModel = this._resolveModel(model);

    // Check if it's a common model
    const commonEntry = Object.entries(COMMON_MODELS).find(([, m]) => m.name === resolvedModel);

    if (commonEntry) {
      return {
        success: true,
        model: resolvedModel,
        shorthand: commonEntry[0],
        ...commonEntry[1]
      };
    }

    // Parse model name for info
    const parts = resolvedModel.split('/');
    return {
      success: true,
      model: resolvedModel,
      type: parts[0] || 'unknown',
      language: parts[1] || 'unknown',
      dataset: parts[2] || 'unknown',
      architecture: parts[3] || 'unknown'
    };
  }

  /**
   * Handle recommend_model action
   */
  async _handleRecommendModel(args) {
    const { language = 'en', quality = 'balanced', multi_speaker = false } = args;

    const recommendations = [];

    for (const [key, model] of Object.entries(COMMON_MODELS)) {
      // Check language match
      if (model.language !== 'multilingual' && model.language !== language) {
        continue;
      }

      // Check multi-speaker requirement
      if (multi_speaker && !model.multi_speaker) {
        continue;
      }

      // Score by quality match
      let score = 0;
      if (model.quality === quality) score += 10;
      if (model.language === language) score += 5;
      if (model.multi_speaker === multi_speaker) score += 3;

      recommendations.push({
        shorthand: key,
        ...model,
        score
      });
    }

    // Sort by score
    recommendations.sort((a, b) => b.score - a.score);

    // Fallback for non-common languages
    if (recommendations.length === 0 && language !== 'en') {
      recommendations.push({
        shorthand: null,
        name: `tts_models/${language}/fairseq/vits`,
        description: `Fairseq VITS model for ${language}`,
        language,
        quality: 'balanced',
        multi_speaker: false,
        note: 'Fairseq model - quality varies by language'
      });
    }

    return {
      success: true,
      recommendations: recommendations.slice(0, 5),
      criteria: { language, quality, multi_speaker }
    };
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
      ready: this.hasTts,
      model_cache_dir: this.config.modelCacheDir,
      temp_dir: this.config.tempDir,
      default_model: this.config.defaultModel
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
      case 'synthesize': return this._handleSynthesize(args, session);
      case 'list_models': return this._handleListModels();
      case 'list_speakers': return this._handleListSpeakers(args);
      case 'list_languages': return this._handleListLanguages();
      case 'get_model_info': return this._handleGetModelInfo(args);
      case 'recommend_model': return this._handleRecommendModel(args);
      case 'check_backends': return this._handleCheckBackends();
      default:
        throw new Error(`Unknown action: ${action}. Valid actions: synthesize, list_models, list_speakers, list_languages, get_model_info, recommend_model, check_backends`);
    }
  }

  /**
   * Register tools with the router
   * @param {ToolRouter} router - Tool router instance
   */
  registerTools(router) {
    router.registerTool('tts', this.handle.bind(this), {
      name: 'tts',
      description: 'Text-to-speech synthesis using Coqui TTS with multiple models and 1100+ languages',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['synthesize', 'list_models', 'list_speakers', 'list_languages', 'get_model_info', 'recommend_model', 'check_backends'],
            description: 'Action to perform'
          },
          text: {
            type: 'string',
            description: 'Text to synthesize (for synthesize action)'
          },
          model: {
            type: 'string',
            description: 'TTS model name or shorthand (e.g., "vctk_vits", "xtts_v2")'
          },
          speaker: {
            type: 'string',
            description: 'Speaker ID for multi-speaker models'
          },
          language: {
            type: 'string',
            description: 'Language code for multilingual models (e.g., "en", "es", "fr")'
          },
          output_format: {
            type: 'string',
            enum: ['wav', 'mp3', 'ogg'],
            description: 'Output audio format (default: wav)'
          },
          output_path: {
            type: 'string',
            description: 'Path for output file'
          },
          quality: {
            type: 'string',
            enum: ['fast', 'balanced', 'high'],
            description: 'Quality tier for model recommendation'
          },
          multi_speaker: {
            type: 'boolean',
            description: 'Require multi-speaker model (for recommend_model)'
          }
        },
        required: ['action']
      }
    });

    // Convenience alias
    router.registerTool('text_to_speech', this.handle.bind(this), {
      name: 'text_to_speech',
      description: 'Alias for tts tool - convert text to speech audio',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'Action to perform' },
          text: { type: 'string', description: 'Text to synthesize' },
          model: { type: 'string', description: 'TTS model' }
        },
        required: ['action']
      }
    });

    // Quick synthesize tool
    router.registerTool('speak', async (args, session) => {
      return this.handle({
        action: 'synthesize',
        text: args.text,
        model: args.model || 'fast_en_vits',
        speaker: args.speaker,
        language: args.language,
        output_format: args.format,
        output_path: args.output_path
      }, session);
    }, {
      name: 'speak',
      description: 'Quick text-to-speech synthesis',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to speak' },
          model: { type: 'string', description: 'TTS model (default: fast_en_vits)' },
          speaker: { type: 'string', description: 'Speaker ID' },
          language: { type: 'string', description: 'Language code' },
          format: { type: 'string', description: 'Output format' },
          output_path: { type: 'string', description: 'Output file path' }
        },
        required: ['text']
      }
    });
  }
}

export default TtsTool;
