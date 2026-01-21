/**
 * @fileoverview Audio Cleanup Tool
 * @module audio-cleanup-tool
 *
 * Tool for cleaning up "dead air" (silence) in speech audio files.
 * Uses ffmpeg for silence detection/removal and optional Coqui TTS VAD.
 * Supports batch processing and concatenation with consistent gaps.
 */

import { spawn, execSync } from 'child_process';
import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, basename, extname, dirname } from 'path';
import { tmpdir } from 'os';

/**
 * Supported audio formats
 */
const SUPPORTED_FORMATS = ['.wav', '.mp3', '.ogg', '.flac', '.aac', '.m4a'];

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  tempDir: join(tmpdir(), 'audio-cleanup-tool'),
  // Silence detection thresholds
  silenceThresholdDb: -40,      // Audio below this is considered silence
  minSilenceDuration: 0.3,      // Minimum silence duration to detect (seconds)
  // Gap settings for concatenation
  defaultGapMs: 200,            // Default gap between clips (milliseconds)
  // Processing settings
  timeout: 300000,              // 5 minutes
  defaultSampleRate: 44100,
  defaultChannels: 2
};

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
 * Check if ffprobe is available
 */
function checkFfprobe() {
  try {
    execSync('which ffprobe', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run ffmpeg command
 */
function runFfmpeg(args, timeout = DEFAULT_CONFIG.timeout) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'info', ...args]);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('FFmpeg operation timed out'));
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ success: true, stdout, stderr });
      } else {
        reject(new Error(`FFmpeg failed (code ${code}): ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`FFmpeg error: ${err.message}`));
    });
  });
}

/**
 * Run ffprobe to get audio info
 */
function runFfprobe(filePath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ];

    const proc = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(new Error(`Failed to parse ffprobe output: ${e.message}`));
        }
      } else {
        reject(new Error(`ffprobe failed: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`ffprobe error: ${err.message}`));
    });
  });
}

/**
 * Detect silence regions in audio file
 * Returns array of { start, end, duration } for each silence region
 */
async function detectSilence(filePath, thresholdDb = -40, minDuration = 0.3) {
  const args = [
    '-i', filePath,
    '-af', `silencedetect=noise=${thresholdDb}dB:d=${minDuration}`,
    '-f', 'null',
    '-'
  ];

  const result = await runFfmpeg(args);
  const silenceRegions = [];

  // Parse silence detection output from stderr
  const lines = result.stderr.split('\n');
  let currentStart = null;

  for (const line of lines) {
    const startMatch = line.match(/silence_start:\s*([\d.]+)/);
    const endMatch = line.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);

    if (startMatch) {
      currentStart = parseFloat(startMatch[1]);
    }

    if (endMatch && currentStart !== null) {
      silenceRegions.push({
        start: currentStart,
        end: parseFloat(endMatch[1]),
        duration: parseFloat(endMatch[2])
      });
      currentStart = null;
    }
  }

  return silenceRegions;
}

/**
 * Get audio duration in seconds
 */
async function getAudioDuration(filePath) {
  const info = await runFfprobe(filePath);
  return parseFloat(info.format?.duration || 0);
}

/**
 * Audio Cleanup Tool Class
 */
export class AudioCleanupTool {
  /**
   * @param {Object} sessionManager - Session manager instance
   * @param {Object} options - Configuration options
   */
  constructor(sessionManager, options = {}) {
    this.sessionManager = sessionManager;
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.hasFfmpeg = checkFfmpeg();
    this.hasFfprobe = checkFfprobe();
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
   * Resolve file path relative to session sandbox
   */
  _resolvePath(filePath, session) {
    if (!filePath) return null;
    if (session?.sandboxPath && !filePath.startsWith('/')) {
      return resolve(join(session.sandboxPath, filePath));
    }
    return resolve(filePath);
  }

  /**
   * Validate audio file exists and is supported format
   */
  _validateAudioFile(filePath) {
    if (!existsSync(filePath)) {
      throw new Error(`Audio file not found: ${filePath}`);
    }
    const ext = extname(filePath).toLowerCase();
    if (!SUPPORTED_FORMATS.includes(ext)) {
      throw new Error(`Unsupported format: ${ext}. Supported: ${SUPPORTED_FORMATS.join(', ')}`);
    }
  }

  /**
   * Generate silence audio of specified duration
   */
  async _generateSilence(durationMs, outputPath, sampleRate = 44100) {
    const durationSec = durationMs / 1000;
    await runFfmpeg([
      '-f', 'lavfi',
      '-i', `anullsrc=r=${sampleRate}:cl=stereo`,
      '-t', String(durationSec),
      outputPath
    ]);
    return outputPath;
  }

  /**
   * Trim silence from beginning and end of audio file
   * Uses silenceremove filter with forward and reverse pass
   */
  async _trimSilence(inputPath, outputPath, options = {}) {
    const {
      thresholdDb = this.config.silenceThresholdDb,
      minDuration = this.config.minSilenceDuration,
      trimStart = true,
      trimEnd = true
    } = options;

    let filter = '';

    if (trimStart && trimEnd) {
      // Forward pass to trim start, reverse, trim start again (was end), reverse back
      filter = `silenceremove=start_periods=1:start_silence=${minDuration}:start_threshold=${thresholdDb}dB,areverse,silenceremove=start_periods=1:start_silence=${minDuration}:start_threshold=${thresholdDb}dB,areverse`;
    } else if (trimStart) {
      filter = `silenceremove=start_periods=1:start_silence=${minDuration}:start_threshold=${thresholdDb}dB`;
    } else if (trimEnd) {
      filter = `areverse,silenceremove=start_periods=1:start_silence=${minDuration}:start_threshold=${thresholdDb}dB,areverse`;
    } else {
      // No trimming, just copy
      await runFfmpeg(['-i', inputPath, '-c', 'copy', outputPath]);
      return;
    }

    await runFfmpeg(['-i', inputPath, '-af', filter, outputPath]);
  }

  /**
   * Trim internal silence (reduce long pauses to specified max duration)
   */
  async _trimInternalSilence(inputPath, outputPath, options = {}) {
    const {
      thresholdDb = this.config.silenceThresholdDb,
      maxSilenceDuration = 0.5 // Maximum silence to keep
    } = options;

    // Use silenceremove to trim all silence periods beyond max duration
    // stop_periods=-1 means remove all silence occurrences
    // stop_duration is the maximum silence to keep
    const filter = `silenceremove=stop_periods=-1:stop_duration=${maxSilenceDuration}:stop_threshold=${thresholdDb}dB`;

    await runFfmpeg(['-i', inputPath, '-af', filter, outputPath]);
  }

  /**
   * Handle analyze action - detect silence regions in audio
   */
  async _handleAnalyze(args, session) {
    const { input_path, threshold_db, min_duration } = args;
    if (!input_path) throw new Error('input_path is required');

    const filePath = this._resolvePath(input_path, session);
    this._validateAudioFile(filePath);

    const thresholdDb = threshold_db ?? this.config.silenceThresholdDb;
    const minDuration = min_duration ?? this.config.minSilenceDuration;

    const duration = await getAudioDuration(filePath);
    const silenceRegions = await detectSilence(filePath, thresholdDb, minDuration);

    // Calculate statistics
    const totalSilence = silenceRegions.reduce((sum, r) => sum + r.duration, 0);
    const speechDuration = duration - totalSilence;
    const silencePercent = (totalSilence / duration) * 100;

    // Identify leading and trailing silence
    const leadingSilence = silenceRegions.find(r => r.start < 0.01);
    const trailingSilence = silenceRegions.find(r => Math.abs(r.end - duration) < 0.01);

    return {
      success: true,
      file_path: input_path,
      duration_seconds: Math.round(duration * 1000) / 1000,
      silence_regions: silenceRegions,
      silence_count: silenceRegions.length,
      total_silence_seconds: Math.round(totalSilence * 1000) / 1000,
      speech_duration_seconds: Math.round(speechDuration * 1000) / 1000,
      silence_percent: Math.round(silencePercent * 10) / 10,
      leading_silence_seconds: leadingSilence ? Math.round(leadingSilence.duration * 1000) / 1000 : 0,
      trailing_silence_seconds: trailingSilence ? Math.round(trailingSilence.duration * 1000) / 1000 : 0,
      threshold_db: thresholdDb,
      min_duration: minDuration
    };
  }

  /**
   * Handle trim action - remove silence from single file
   */
  async _handleTrim(args, session) {
    const {
      input_path,
      output_path,
      threshold_db,
      min_duration,
      trim_start = true,
      trim_end = true,
      trim_internal = false,
      max_internal_silence = 0.5
    } = args;

    if (!input_path) throw new Error('input_path is required');

    const inputFile = this._resolvePath(input_path, session);
    this._validateAudioFile(inputFile);

    await this._ensureTempDir();

    const thresholdDb = threshold_db ?? this.config.silenceThresholdDb;
    const minDuration = min_duration ?? this.config.minSilenceDuration;

    // Get original duration
    const originalDuration = await getAudioDuration(inputFile);

    // Determine output path
    let outputFile;
    if (output_path) {
      outputFile = this._resolvePath(output_path, session);
    } else {
      const ext = extname(inputFile);
      const base = basename(inputFile, ext);
      outputFile = join(this.config.tempDir, `${base}_cleaned_${Date.now()}${ext}`);
    }

    // Ensure output directory exists
    const outputDir = dirname(outputFile);
    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
    }

    // First pass: trim start/end
    const tempFile1 = join(this.config.tempDir, `trim_temp1_${Date.now()}.wav`);
    await this._trimSilence(inputFile, tempFile1, {
      thresholdDb,
      minDuration,
      trimStart: trim_start,
      trimEnd: trim_end
    });

    // Second pass (optional): trim internal silence
    if (trim_internal) {
      await this._trimInternalSilence(tempFile1, outputFile, {
        thresholdDb,
        maxSilenceDuration: max_internal_silence
      });
      await unlink(tempFile1).catch(() => {});
    } else {
      // Just rename temp file to output
      const content = await readFile(tempFile1);
      await writeFile(outputFile, content);
      await unlink(tempFile1).catch(() => {});
    }

    // Get new duration
    const newDuration = await getAudioDuration(outputFile);
    const removedDuration = originalDuration - newDuration;

    return {
      success: true,
      output_path: outputFile,
      original_duration_ms: Math.round(originalDuration * 1000),
      new_duration_ms: Math.round(newDuration * 1000),
      removed_ms: Math.round(removedDuration * 1000),
      reduction_percent: Math.round((removedDuration / originalDuration) * 1000) / 10,
      settings: {
        threshold_db: thresholdDb,
        min_duration: minDuration,
        trim_start,
        trim_end,
        trim_internal,
        max_internal_silence: trim_internal ? max_internal_silence : null
      }
    };
  }

  /**
   * Handle batch_trim action - trim multiple files
   */
  async _handleBatchTrim(args, session) {
    const {
      input_paths,
      output_dir,
      threshold_db,
      min_duration,
      trim_start = true,
      trim_end = true,
      trim_internal = false,
      max_internal_silence = 0.5
    } = args;

    if (!input_paths || !Array.isArray(input_paths) || input_paths.length === 0) {
      throw new Error('input_paths array is required');
    }

    await this._ensureTempDir();

    const thresholdDb = threshold_db ?? this.config.silenceThresholdDb;
    const minDuration = min_duration ?? this.config.minSilenceDuration;

    // Determine output directory
    let outputDirectory;
    if (output_dir) {
      outputDirectory = this._resolvePath(output_dir, session);
    } else {
      outputDirectory = this.config.tempDir;
    }

    if (!existsSync(outputDirectory)) {
      await mkdir(outputDirectory, { recursive: true });
    }

    const results = [];
    let totalOriginal = 0;
    let totalNew = 0;

    for (const inputPath of input_paths) {
      const inputFile = this._resolvePath(inputPath, session);

      try {
        this._validateAudioFile(inputFile);

        const ext = extname(inputFile);
        const base = basename(inputFile, ext);
        const outputFile = join(outputDirectory, `${base}_cleaned${ext}`);

        const result = await this._handleTrim({
          input_path: inputFile,
          output_path: outputFile,
          threshold_db: thresholdDb,
          min_duration: minDuration,
          trim_start,
          trim_end,
          trim_internal,
          max_internal_silence
        }, session);

        totalOriginal += result.original_duration_ms;
        totalNew += result.new_duration_ms;

        results.push({
          input: inputPath,
          output: outputFile,
          success: true,
          original_ms: result.original_duration_ms,
          new_ms: result.new_duration_ms,
          removed_ms: result.removed_ms
        });
      } catch (err) {
        results.push({
          input: inputPath,
          output: null,
          success: false,
          error: err.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;

    return {
      success: true,
      files_processed: input_paths.length,
      files_succeeded: successCount,
      files_failed: input_paths.length - successCount,
      total_original_ms: totalOriginal,
      total_new_ms: totalNew,
      total_removed_ms: totalOriginal - totalNew,
      output_directory: outputDirectory,
      results
    };
  }

  /**
   * Handle concat action - trim and concatenate multiple files
   */
  async _handleConcat(args, session) {
    const {
      input_paths,
      output_path,
      gap_ms,
      threshold_db,
      min_duration,
      trim_clips = true,
      trim_internal = false,
      max_internal_silence = 0.5,
      crossfade_ms = 0,
      normalize = false
    } = args;

    if (!input_paths || !Array.isArray(input_paths) || input_paths.length === 0) {
      throw new Error('input_paths array is required');
    }

    await this._ensureTempDir();

    const gapMs = gap_ms ?? this.config.defaultGapMs;
    const thresholdDb = threshold_db ?? this.config.silenceThresholdDb;
    const minDuration = min_duration ?? this.config.minSilenceDuration;

    const cleanedFiles = [];
    const tempFiles = [];
    let totalOriginal = 0;

    try {
      // Process each input file
      for (let i = 0; i < input_paths.length; i++) {
        const inputPath = input_paths[i];
        const inputFile = this._resolvePath(inputPath, session);
        this._validateAudioFile(inputFile);

        const originalDuration = await getAudioDuration(inputFile);
        totalOriginal += originalDuration * 1000;

        if (trim_clips) {
          // Trim silence from this clip
          const cleanedFile = join(this.config.tempDir, `cleaned_${i}_${Date.now()}.wav`);
          tempFiles.push(cleanedFile);

          // First trim start/end
          const tempTrimmed = join(this.config.tempDir, `trimmed_${i}_${Date.now()}.wav`);
          tempFiles.push(tempTrimmed);

          await this._trimSilence(inputFile, tempTrimmed, {
            thresholdDb,
            minDuration,
            trimStart: true,
            trimEnd: true
          });

          // Optionally trim internal silence
          if (trim_internal) {
            await this._trimInternalSilence(tempTrimmed, cleanedFile, {
              thresholdDb,
              maxSilenceDuration: max_internal_silence
            });
          } else {
            const content = await readFile(tempTrimmed);
            await writeFile(cleanedFile, content);
          }

          cleanedFiles.push(cleanedFile);
        } else {
          cleanedFiles.push(inputFile);
        }
      }

      // Generate gap silence if needed
      let gapFile = null;
      if (gapMs > 0 && crossfade_ms === 0) {
        gapFile = join(this.config.tempDir, `gap_${Date.now()}.wav`);
        tempFiles.push(gapFile);
        await this._generateSilence(gapMs, gapFile);
      }

      // Determine output path
      let outputFile;
      if (output_path) {
        outputFile = this._resolvePath(output_path, session);
      } else {
        outputFile = join(this.config.tempDir, `concat_output_${Date.now()}.wav`);
      }

      // Ensure output directory exists
      const outputDir = dirname(outputFile);
      if (!existsSync(outputDir)) {
        await mkdir(outputDir, { recursive: true });
      }

      // Concatenate files
      if (crossfade_ms > 0) {
        // Use acrossfade filter for crossfade
        const crossfadeSec = crossfade_ms / 1000;
        let filterComplex = '';
        let currentInput = '[0:a]';

        for (let i = 1; i < cleanedFiles.length; i++) {
          const nextInput = `[${i}:a]`;
          const outputLabel = i === cleanedFiles.length - 1 ? '' : `[a${i}]`;
          filterComplex += `${currentInput}${nextInput}acrossfade=d=${crossfadeSec}:c1=tri:c2=tri${outputLabel};`;
          currentInput = `[a${i}]`;
        }

        filterComplex = filterComplex.slice(0, -1); // Remove trailing semicolon

        const ffmpegArgs = cleanedFiles.flatMap(f => ['-i', f]);
        ffmpegArgs.push('-filter_complex', filterComplex, outputFile);

        await runFfmpeg(ffmpegArgs);
      } else {
        // Use concat demuxer with optional gap
        const listFile = join(this.config.tempDir, `concat_list_${Date.now()}.txt`);
        tempFiles.push(listFile);

        let listContent = '';
        for (let i = 0; i < cleanedFiles.length; i++) {
          listContent += `file '${cleanedFiles[i]}'\n`;
          if (gapFile && i < cleanedFiles.length - 1) {
            listContent += `file '${gapFile}'\n`;
          }
        }

        await writeFile(listFile, listContent);
        await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outputFile]);
      }

      // Optional normalization
      if (normalize) {
        const normalizedFile = join(this.config.tempDir, `normalized_${Date.now()}.wav`);
        tempFiles.push(normalizedFile);

        await runFfmpeg([
          '-i', outputFile,
          '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
          normalizedFile
        ]);

        // Replace output with normalized version
        const content = await readFile(normalizedFile);
        await writeFile(outputFile, content);
      }

      // Get final duration
      const finalDuration = await getAudioDuration(outputFile);

      return {
        success: true,
        output_path: outputFile,
        clips_processed: input_paths.length,
        total_original_ms: Math.round(totalOriginal),
        final_duration_ms: Math.round(finalDuration * 1000),
        removed_ms: Math.round(totalOriginal - (finalDuration * 1000)),
        settings: {
          gap_ms: gapMs,
          crossfade_ms,
          trim_clips,
          trim_internal,
          normalize,
          threshold_db: thresholdDb
        }
      };
    } finally {
      // Cleanup temp files
      for (const tempFile of tempFiles) {
        await unlink(tempFile).catch(() => {});
      }
    }
  }

  /**
   * Handle check_backends action
   */
  async _handleCheckBackends() {
    return {
      success: true,
      ffmpeg_available: this.hasFfmpeg,
      ffprobe_available: this.hasFfprobe,
      ready: this.hasFfmpeg && this.hasFfprobe,
      supported_formats: SUPPORTED_FORMATS,
      default_settings: {
        silence_threshold_db: this.config.silenceThresholdDb,
        min_silence_duration: this.config.minSilenceDuration,
        default_gap_ms: this.config.defaultGapMs
      }
    };
  }

  /**
   * Main handler for tool execution
   * @param {Object} args - Tool arguments
   * @returns {Promise<Object>}
   */
  async handle(args, session) {
    if (!this.hasFfmpeg) {
      throw new Error('FFmpeg is not installed. Please install ffmpeg.');
    }

    const { action } = args;

    switch (action) {
      case 'analyze': return this._handleAnalyze(args, session);
      case 'trim': return this._handleTrim(args, session);
      case 'batch_trim': return this._handleBatchTrim(args, session);
      case 'concat': return this._handleConcat(args, session);
      case 'check_backends': return this._handleCheckBackends();
      default:
        throw new Error(`Unknown action: ${action}. Valid actions: analyze, trim, batch_trim, concat, check_backends`);
    }
  }

  /**
   * Register tools with the router
   * @param {ToolRouter} router - Tool router instance
   */
  registerTools(router) {
    router.registerTool('audio_cleanup', this.handle.bind(this), {
      name: 'audio_cleanup',
      description: 'Clean up dead air (silence) in speech audio files - analyze, trim, and concatenate with consistent gaps',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['analyze', 'trim', 'batch_trim', 'concat', 'check_backends'],
            description: 'Action to perform: analyze (detect silence), trim (single file), batch_trim (multiple files), concat (trim and join)'
          },
          input_path: {
            type: 'string',
            description: 'Path to input audio file (for analyze, trim)'
          },
          input_paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of input audio file paths (for batch_trim, concat)'
          },
          output_path: {
            type: 'string',
            description: 'Path for output file'
          },
          output_dir: {
            type: 'string',
            description: 'Output directory for batch_trim'
          },
          threshold_db: {
            type: 'number',
            description: 'Silence threshold in dB (default: -40, lower = more sensitive)'
          },
          min_duration: {
            type: 'number',
            description: 'Minimum silence duration to detect in seconds (default: 0.3)'
          },
          trim_start: {
            type: 'boolean',
            description: 'Trim silence from start (default: true)'
          },
          trim_end: {
            type: 'boolean',
            description: 'Trim silence from end (default: true)'
          },
          trim_internal: {
            type: 'boolean',
            description: 'Also trim internal silence/long pauses (default: false)'
          },
          max_internal_silence: {
            type: 'number',
            description: 'Maximum internal silence to keep in seconds when trim_internal=true (default: 0.5)'
          },
          trim_clips: {
            type: 'boolean',
            description: 'Trim each clip before concatenating (default: true)'
          },
          gap_ms: {
            type: 'number',
            description: 'Gap between clips in milliseconds for concat (default: 200)'
          },
          crossfade_ms: {
            type: 'number',
            description: 'Crossfade duration in milliseconds (0 = no crossfade)'
          },
          normalize: {
            type: 'boolean',
            description: 'Normalize loudness after concatenation (default: false)'
          }
        },
        required: ['action']
      }
    });

    // Convenience alias
    router.registerTool('clean_audio', this.handle.bind(this), {
      name: 'clean_audio',
      description: 'Alias for audio_cleanup - remove dead air from speech audio',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'Action to perform' },
          input_path: { type: 'string', description: 'Input audio file' },
          input_paths: { type: 'array', items: { type: 'string' }, description: 'Input audio files' },
          output_path: { type: 'string', description: 'Output file path' }
        },
        required: ['action']
      }
    });

    // Quick trim tool
    router.registerTool('trim_silence', async (args, session) => {
      return this.handle({
        action: 'trim',
        input_path: args.input_path,
        output_path: args.output_path,
        threshold_db: args.threshold_db,
        trim_start: true,
        trim_end: true,
        trim_internal: args.trim_internal || false
      }, session);
    }, {
      name: 'trim_silence',
      description: 'Quick tool to trim silence from audio file',
      inputSchema: {
        type: 'object',
        properties: {
          input_path: { type: 'string', description: 'Input audio file' },
          output_path: { type: 'string', description: 'Output file path' },
          threshold_db: { type: 'number', description: 'Silence threshold in dB' },
          trim_internal: { type: 'boolean', description: 'Also trim internal pauses' }
        },
        required: ['input_path']
      }
    });
  }
}

export default AudioCleanupTool;
