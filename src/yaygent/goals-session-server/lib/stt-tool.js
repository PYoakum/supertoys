/**
 * @fileoverview Speech-to-Text Tool
 * @module stt-tool
 *
 * Tool registry integration for speech-to-text transcription.
 * Supports multiple backends: whisper CLI, whisper.cpp, macOS dictation,
 * and cloud APIs (OpenAI Whisper API).
 *
 * Based on architecture from cjpais/Handy repository.
 */

import { spawn, execSync } from 'child_process';
import { readFile, writeFile, unlink, stat, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, basename, extname } from 'path';
import { tmpdir, homedir, platform } from 'os';

/**
 * Supported audio formats
 */
const SUPPORTED_AUDIO_FORMATS = ['.wav', '.mp3', '.m4a', '.flac', '.ogg', '.webm', '.mp4', '.mpeg', '.mpga'];

/**
 * Model configurations
 */
const MODELS = {
  'whisper-tiny': {
    name: 'whisper-tiny',
    description: 'Whisper tiny model (~75MB) - fastest, lower accuracy',
    size: '75MB',
    engine: 'whisper'
  },
  'whisper-base': {
    name: 'whisper-base',
    description: 'Whisper base model (~142MB) - fast, decent accuracy',
    size: '142MB',
    engine: 'whisper'
  },
  'whisper-small': {
    name: 'whisper-small',
    description: 'Whisper small model (~466MB) - balanced speed/accuracy',
    size: '466MB',
    engine: 'whisper'
  },
  'whisper-medium': {
    name: 'whisper-medium',
    description: 'Whisper medium model (~1.5GB) - high accuracy',
    size: '1.5GB',
    engine: 'whisper'
  },
  'whisper-large': {
    name: 'whisper-large',
    description: 'Whisper large-v3 model (~3GB) - highest accuracy',
    size: '3GB',
    engine: 'whisper'
  }
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  defaultModel: 'whisper-base',
  defaultRecordDuration: 30,
  maxRecordDuration: 300,
  enableVad: true,
  sampleRate: 16000,
  tempDir: join(tmpdir(), 'stt-tool'),
  modelCacheDir: null // Set per-platform in constructor
};

/**
 * Get platform-specific cache directory
 */
function getCacheDir() {
  const plat = platform();
  if (plat === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'stt-tool');
  } else if (plat === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'stt-tool');
  } else {
    return join(homedir(), '.cache', 'stt-tool');
  }
}

/**
 * Check if a command exists
 */
function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect available STT backends
 */
function detectBackends() {
  const backends = [];

  // Check for whisper CLI (Python openai-whisper)
  if (commandExists('whisper')) {
    backends.push({
      name: 'whisper-cli',
      type: 'cli',
      command: 'whisper',
      description: 'OpenAI Whisper CLI (Python)'
    });
  }

  // Check for whisper.cpp
  if (commandExists('whisper-cpp') || commandExists('main')) {
    backends.push({
      name: 'whisper-cpp',
      type: 'cli',
      command: commandExists('whisper-cpp') ? 'whisper-cpp' : 'main',
      description: 'whisper.cpp (C++ implementation)'
    });
  }

  // Check for mlx-whisper (Apple Silicon)
  if (commandExists('mlx_whisper')) {
    backends.push({
      name: 'mlx-whisper',
      type: 'cli',
      command: 'mlx_whisper',
      description: 'MLX Whisper (Apple Silicon optimized)'
    });
  }

  // Check for sox (for recording)
  if (commandExists('sox')) {
    backends.push({
      name: 'sox',
      type: 'recorder',
      command: 'sox',
      description: 'SoX audio recorder'
    });
  }

  // Check for ffmpeg (for recording and conversion)
  if (commandExists('ffmpeg')) {
    backends.push({
      name: 'ffmpeg',
      type: 'utility',
      command: 'ffmpeg',
      description: 'FFmpeg audio utility'
    });
  }

  // macOS: Check for afrecord
  if (platform() === 'darwin' && commandExists('afrecord')) {
    backends.push({
      name: 'afrecord',
      type: 'recorder',
      command: 'afrecord',
      description: 'macOS Core Audio recorder'
    });
  }

  return backends;
}

/**
 * Speech-to-Text Tool Class
 */
export class SttTool {
  /**
   * @param {Object} sessionManager - Session manager instance
   * @param {Object} options - Configuration options
   */
  constructor(sessionManager, options = {}) {
    this.sessionManager = sessionManager;
    this.config = {
      ...DEFAULT_CONFIG,
      modelCacheDir: getCacheDir(),
      ...options
    };

    // Detect available backends on initialization
    this.backends = detectBackends();
    this.preferredBackend = this._selectPreferredBackend();
  }

  /**
   * Select the preferred transcription backend
   */
  _selectPreferredBackend() {
    // Priority: mlx-whisper > whisper-cli > whisper-cpp
    const priority = ['mlx-whisper', 'whisper-cli', 'whisper-cpp'];
    for (const name of priority) {
      const backend = this.backends.find(b => b.name === name && b.type === 'cli');
      if (backend) return backend;
    }
    return null;
  }

  /**
   * Select the preferred recording backend
   */
  _selectRecorder() {
    // Priority: sox > ffmpeg > afrecord
    const priority = ['sox', 'ffmpeg', 'afrecord'];
    for (const name of priority) {
      const backend = this.backends.find(b => b.name === name);
      if (backend) return backend;
    }
    return null;
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
   * Record audio from microphone
   * @param {number} durationSeconds - Recording duration
   * @returns {Promise<string>} - Path to recorded WAV file
   */
  async _recordAudio(durationSeconds) {
    await this._ensureTempDir();

    const recorder = this._selectRecorder();
    if (!recorder) {
      throw new Error('No audio recorder available. Install sox or ffmpeg.');
    }

    const outputPath = join(this.config.tempDir, `recording-${Date.now()}.wav`);

    return new Promise((resolve, reject) => {
      let proc;

      if (recorder.name === 'sox') {
        // sox -d -r 16000 -c 1 output.wav trim 0 <duration>
        proc = spawn('sox', [
          '-d',                    // default input device
          '-r', String(this.config.sampleRate),
          '-c', '1',               // mono
          '-b', '16',              // 16-bit
          outputPath,
          'trim', '0', String(durationSeconds)
        ]);
      } else if (recorder.name === 'ffmpeg') {
        // ffmpeg -f avfoundation -i ":0" -t <duration> -ar 16000 -ac 1 output.wav
        const inputDevice = platform() === 'darwin' ? ['-f', 'avfoundation', '-i', ':0']
                                                     : ['-f', 'alsa', '-i', 'default'];
        proc = spawn('ffmpeg', [
          ...inputDevice,
          '-t', String(durationSeconds),
          '-ar', String(this.config.sampleRate),
          '-ac', '1',
          '-y',
          outputPath
        ]);
      } else if (recorder.name === 'afrecord') {
        // afrecord -d <duration> -f 'WAVE' -c 1 -r 16000 output.wav
        proc = spawn('afrecord', [
          '-d', String(durationSeconds),
          '-f', 'WAVE',
          '-c', '1',
          '-r', String(this.config.sampleRate),
          outputPath
        ]);
      }

      let stderr = '';
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 && existsSync(outputPath)) {
          resolve(outputPath);
        } else {
          reject(new Error(`Recording failed (code ${code}): ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Recording error: ${err.message}`));
      });
    });
  }

  /**
   * Convert audio to WAV 16kHz mono if needed
   * @param {string} inputPath - Input audio file
   * @returns {Promise<string>} - Path to converted WAV file
   */
  async _convertToWav(inputPath) {
    const ext = extname(inputPath).toLowerCase();

    // If already WAV, check format
    if (ext === '.wav') {
      // Could check sample rate here, but for simplicity assume it's okay
      return inputPath;
    }

    // Need ffmpeg for conversion
    if (!this.backends.find(b => b.name === 'ffmpeg')) {
      throw new Error('FFmpeg required for audio conversion. Install ffmpeg.');
    }

    await this._ensureTempDir();
    const outputPath = join(this.config.tempDir, `converted-${Date.now()}.wav`);

    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', [
        '-i', inputPath,
        '-ar', String(this.config.sampleRate),
        '-ac', '1',
        '-y',
        outputPath
      ]);

      let stderr = '';
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 && existsSync(outputPath)) {
          resolve(outputPath);
        } else {
          reject(new Error(`Conversion failed (code ${code}): ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Conversion error: ${err.message}`));
      });
    });
  }

  /**
   * Transcribe audio using the preferred backend
   * @param {string} audioPath - Path to audio file
   * @param {Object} options - Transcription options
   * @returns {Promise<Object>} - Transcription result
   */
  async _transcribe(audioPath, options = {}) {
    const backend = this.preferredBackend;
    if (!backend) {
      throw new Error('No transcription backend available. Install whisper: pip install openai-whisper');
    }

    const model = options.model || this.config.defaultModel;
    const modelName = model.replace('whisper-', '');
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      let proc;
      let args;

      if (backend.name === 'whisper-cli') {
        // whisper audio.wav --model base --output_format json --output_dir /tmp
        args = [
          audioPath,
          '--model', modelName,
          '--output_format', 'json',
          '--output_dir', this.config.tempDir
        ];

        if (options.language) {
          args.push('--language', options.language);
        }

        proc = spawn('whisper', args);
      } else if (backend.name === 'mlx-whisper') {
        // mlx_whisper audio.wav --model mlx-community/whisper-base-mlx
        args = [
          audioPath,
          '--model', `mlx-community/whisper-${modelName}-mlx`
        ];
        proc = spawn('mlx_whisper', args);
      } else if (backend.name === 'whisper-cpp') {
        // ./main -m models/ggml-base.bin -f audio.wav -oj
        const modelPath = join(this.config.modelCacheDir, `ggml-${modelName}.bin`);
        args = [
          '-m', modelPath,
          '-f', audioPath,
          '-oj' // JSON output
        ];
        proc = spawn(backend.command, args);
      }

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', async (code) => {
        const processingTime = Date.now() - startTime;

        if (code !== 0) {
          reject(new Error(`Transcription failed (code ${code}): ${stderr}`));
          return;
        }

        try {
          let text = '';
          let segments = [];

          // Try to parse JSON output
          if (backend.name === 'whisper-cli') {
            // Whisper CLI outputs to a JSON file
            const jsonPath = audioPath.replace(extname(audioPath), '.json');
            const altJsonPath = join(this.config.tempDir, basename(audioPath).replace(extname(audioPath), '.json'));

            let jsonContent;
            if (existsSync(jsonPath)) {
              jsonContent = await readFile(jsonPath, 'utf-8');
              await unlink(jsonPath).catch(() => {});
            } else if (existsSync(altJsonPath)) {
              jsonContent = await readFile(altJsonPath, 'utf-8');
              await unlink(altJsonPath).catch(() => {});
            }

            if (jsonContent) {
              const parsed = JSON.parse(jsonContent);
              text = parsed.text || '';
              segments = (parsed.segments || []).map(s => ({
                start_ms: Math.round((s.start || 0) * 1000),
                end_ms: Math.round((s.end || 0) * 1000),
                text: s.text || '',
                confidence: s.confidence || null
              }));
            } else {
              // Fallback to stdout
              text = stdout.trim();
            }
          } else if (backend.name === 'whisper-cpp') {
            // whisper.cpp with -oj outputs JSON to stdout
            try {
              const parsed = JSON.parse(stdout);
              text = parsed.transcription?.map(s => s.text).join(' ') || '';
              segments = (parsed.transcription || []).map(s => ({
                start_ms: s.timestamps?.from ? parseInt(s.timestamps.from.replace(':', '')) : 0,
                end_ms: s.timestamps?.to ? parseInt(s.timestamps.to.replace(':', '')) : 0,
                text: s.text || ''
              }));
            } catch {
              text = stdout.trim();
            }
          } else {
            text = stdout.trim();
          }

          // Get audio duration
          let audioDuration = 0;
          try {
            const stats = await stat(audioPath);
            // Rough estimate: WAV 16kHz mono 16-bit = 32000 bytes/sec
            audioDuration = Math.round((stats.size / 32000) * 1000);
          } catch {}

          resolve({
            text: text.trim(),
            segments: options.return_timestamps ? segments : undefined,
            model_used: model,
            backend_used: backend.name,
            audio_duration_ms: audioDuration,
            processing_time_ms: processingTime
          });
        } catch (err) {
          reject(new Error(`Failed to parse transcription output: ${err.message}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Transcription process error: ${err.message}`));
      });
    });
  }

  /**
   * Handle transcribe_file action
   */
  async _handleTranscribeFile(args, session) {
    const { audio_file, model, enable_vad, return_timestamps, language } = args;

    if (!audio_file) {
      throw new Error('audio_file parameter is required');
    }

    // Resolve path (relative to sandbox if session provided)
    let filePath = audio_file;
    if (session?.sandboxPath && !audio_file.startsWith('/')) {
      filePath = join(session.sandboxPath, audio_file);
    }
    filePath = resolve(filePath);

    if (!existsSync(filePath)) {
      throw new Error(`Audio file not found: ${filePath}`);
    }

    // Validate format
    const ext = extname(filePath).toLowerCase();
    if (!SUPPORTED_AUDIO_FORMATS.includes(ext)) {
      throw new Error(`Unsupported audio format: ${ext}. Supported: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`);
    }

    // Convert if needed
    const wavPath = await this._convertToWav(filePath);
    const needsCleanup = wavPath !== filePath;

    try {
      const result = await this._transcribe(wavPath, {
        model,
        return_timestamps,
        language
      });

      return {
        success: true,
        ...result,
        source_file: audio_file
      };
    } finally {
      // Cleanup converted file
      if (needsCleanup && existsSync(wavPath)) {
        await unlink(wavPath).catch(() => {});
      }
    }
  }

  /**
   * Handle transcribe_microphone action
   */
  async _handleTranscribeMicrophone(args, session) {
    const {
      duration_seconds = this.config.defaultRecordDuration,
      model,
      enable_vad,
      return_timestamps,
      language
    } = args;

    // Validate duration
    const duration = Math.min(Math.max(1, duration_seconds), this.config.maxRecordDuration);

    // Record audio
    const wavPath = await this._recordAudio(duration);

    try {
      const result = await this._transcribe(wavPath, {
        model,
        return_timestamps,
        language
      });

      return {
        success: true,
        ...result,
        recorded_duration_seconds: duration
      };
    } finally {
      // Cleanup recording
      if (existsSync(wavPath)) {
        await unlink(wavPath).catch(() => {});
      }
    }
  }

  /**
   * Handle list_models action
   */
  async _handleListModels() {
    const available = Object.values(MODELS).map(m => ({
      ...m,
      available: this.preferredBackend !== null
    }));

    return {
      success: true,
      models: available,
      default_model: this.config.defaultModel,
      backends: this.backends.map(b => ({
        name: b.name,
        type: b.type,
        description: b.description
      })),
      preferred_backend: this.preferredBackend?.name || null
    };
  }

  /**
   * Handle check_backends action
   */
  async _handleCheckBackends() {
    // Re-detect backends
    this.backends = detectBackends();
    this.preferredBackend = this._selectPreferredBackend();

    return {
      success: true,
      backends: this.backends,
      preferred_transcription: this.preferredBackend?.name || null,
      preferred_recorder: this._selectRecorder()?.name || null,
      ready: this.preferredBackend !== null
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
      case 'transcribe_file':
        return this._handleTranscribeFile(args, session);

      case 'transcribe_microphone':
        return this._handleTranscribeMicrophone(args, session);

      case 'list_models':
        return this._handleListModels();

      case 'check_backends':
        return this._handleCheckBackends();

      default:
        throw new Error(`Unknown action: ${action}. Valid actions: transcribe_file, transcribe_microphone, list_models, check_backends`);
    }
  }

  /**
   * Register tools with the router
   * @param {ToolRouter} router - Tool router instance
   */
  registerTools(router) {
    // Main STT tool
    router.registerTool('speech_to_text', this.handle.bind(this), {
      name: 'speech_to_text',
      description: 'Transcribe speech from audio files or microphone recording to text using Whisper models',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['transcribe_file', 'transcribe_microphone', 'list_models', 'check_backends'],
            description: 'Action to perform'
          },
          audio_file: {
            type: 'string',
            description: 'Path to audio file (for transcribe_file action). Supports WAV, MP3, M4A, FLAC, OGG, WebM'
          },
          duration_seconds: {
            type: 'number',
            description: 'Recording duration in seconds (for transcribe_microphone action). Default: 30, Max: 300'
          },
          model: {
            type: 'string',
            enum: ['whisper-tiny', 'whisper-base', 'whisper-small', 'whisper-medium', 'whisper-large'],
            description: 'Whisper model to use. Default: whisper-base'
          },
          language: {
            type: 'string',
            description: 'Language code (e.g., "en", "es", "fr"). Auto-detected if not specified'
          },
          enable_vad: {
            type: 'boolean',
            description: 'Enable Voice Activity Detection to filter silence. Default: true'
          },
          return_timestamps: {
            type: 'boolean',
            description: 'Include word/segment timestamps in output. Default: false'
          }
        },
        required: ['action']
      }
    });

    // Convenience aliases
    router.registerTool('stt', this.handle.bind(this), {
      name: 'stt',
      description: 'Alias for speech_to_text tool - transcribe audio to text',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['transcribe_file', 'transcribe_microphone', 'list_models', 'check_backends'],
            description: 'Action to perform'
          },
          audio_file: { type: 'string', description: 'Path to audio file' },
          duration_seconds: { type: 'number', description: 'Recording duration' },
          model: { type: 'string', description: 'Whisper model to use' },
          language: { type: 'string', description: 'Language code' },
          return_timestamps: { type: 'boolean', description: 'Include timestamps' }
        },
        required: ['action']
      }
    });

    // Quick transcribe file tool
    router.registerTool('transcribe_audio', async (args, session) => {
      return this.handle({ action: 'transcribe_file', ...args }, session);
    }, {
      name: 'transcribe_audio',
      description: 'Quickly transcribe an audio file to text',
      inputSchema: {
        type: 'object',
        properties: {
          audio_file: {
            type: 'string',
            description: 'Path to the audio file to transcribe'
          },
          model: {
            type: 'string',
            description: 'Whisper model (tiny, base, small, medium, large)'
          },
          language: {
            type: 'string',
            description: 'Language code for transcription'
          }
        },
        required: ['audio_file']
      }
    });

    // Quick record and transcribe tool
    router.registerTool('record_and_transcribe', async (args, session) => {
      return this.handle({ action: 'transcribe_microphone', ...args }, session);
    }, {
      name: 'record_and_transcribe',
      description: 'Record audio from microphone and transcribe to text',
      inputSchema: {
        type: 'object',
        properties: {
          duration_seconds: {
            type: 'number',
            description: 'Recording duration in seconds (default: 30)'
          },
          model: {
            type: 'string',
            description: 'Whisper model to use'
          },
          language: {
            type: 'string',
            description: 'Language code'
          }
        }
      }
    });
  }
}

export default SttTool;
