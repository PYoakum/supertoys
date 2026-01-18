/**
 * @fileoverview Edit Audio Tool
 * @module edit-audio-tool
 *
 * Tool registry integration for audio editing using ffmpeg.
 * Supports: slice, trim, concatenate, overlay, volume, fade, pan, speed, EQ, effects.
 */

import { spawn, execSync } from 'child_process';
import { readFile, writeFile, unlink, stat, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, basename, extname, dirname } from 'path';
import { tmpdir, homedir, platform } from 'os';

/**
 * Supported audio formats
 */
const SUPPORTED_FORMATS = ['.wav', '.mp3', '.ogg', '.flac', '.aac', '.m4a', '.aiff', '.wma'];

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  tempDir: join(tmpdir(), 'edit-audio-tool'),
  defaultSampleRate: 44100,
  defaultChannels: 2,
  defaultBitrate: '192k',
  timeout: 300000 // 5 minutes
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
 * Parse time string to seconds
 * Supports: seconds (float), milliseconds (with 'ms'), timestamp (HH:MM:SS.mmm)
 */
function parseTime(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    return value;
  }

  const str = String(value).trim();

  // Milliseconds: "5000ms"
  if (str.endsWith('ms')) {
    return parseFloat(str.slice(0, -2)) / 1000;
  }

  // Timestamp: "00:01:30.500" or "1:30.5"
  if (str.includes(':')) {
    const parts = str.split(':');
    let seconds = 0;
    if (parts.length === 3) {
      seconds = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
      seconds = parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return seconds;
  }

  // Plain seconds
  return parseFloat(str);
}

/**
 * Format seconds to timestamp string
 */
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toFixed(3);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.padStart(6, '0')}`;
}

/**
 * Run ffmpeg command
 */
function runFfmpeg(args, timeout = DEFAULT_CONFIG.timeout) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]);

    let stderr = '';
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
        resolve({ success: true });
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
 * Edit Audio Tool Class
 */
export class EditAudioTool {
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
   * Generate output path if not provided
   */
  async _getOutputPath(inputPath, suffix, outputPath, session) {
    if (outputPath) {
      return this._resolvePath(outputPath, session);
    }
    await this._ensureTempDir();
    const ext = extname(inputPath);
    const base = basename(inputPath, ext);
    return join(this.config.tempDir, `${base}_${suffix}_${Date.now()}${ext}`);
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
   * Get audio file info
   */
  async _handleInfo(args, session) {
    const { input_path } = args;
    if (!input_path) throw new Error('input_path is required');

    const filePath = this._resolvePath(input_path, session);
    this._validateAudioFile(filePath);

    const info = await runFfprobe(filePath);
    const audioStream = info.streams?.find(s => s.codec_type === 'audio');
    const format = info.format || {};

    return {
      success: true,
      file_path: input_path,
      duration_ms: Math.round(parseFloat(format.duration || 0) * 1000),
      duration_formatted: formatTime(parseFloat(format.duration || 0)),
      sample_rate: parseInt(audioStream?.sample_rate || 0),
      channels: parseInt(audioStream?.channels || 0),
      bit_depth: audioStream?.bits_per_sample || null,
      codec: audioStream?.codec_name || null,
      bitrate_kbps: Math.round(parseInt(format.bit_rate || 0) / 1000),
      file_size_bytes: parseInt(format.size || 0),
      format: format.format_name || null
    };
  }

  /**
   * Slice audio - extract portion by time range
   */
  async _handleSlice(args, session) {
    const { input_path, start, end, output_path } = args;
    if (!input_path) throw new Error('input_path is required');
    if (start === undefined && end === undefined) {
      throw new Error('At least one of start or end is required');
    }

    const inputFile = this._resolvePath(input_path, session);
    this._validateAudioFile(inputFile);

    const outputFile = await this._getOutputPath(inputFile, 'slice', output_path, session);

    const ffmpegArgs = ['-i', inputFile];

    if (start !== undefined) {
      ffmpegArgs.push('-ss', String(parseTime(start)));
    }
    if (end !== undefined) {
      ffmpegArgs.push('-to', String(parseTime(end)));
    }

    // Try stream copy first for speed
    ffmpegArgs.push('-c', 'copy', outputFile);

    await runFfmpeg(ffmpegArgs);

    const info = await runFfprobe(outputFile);
    const duration = parseFloat(info.format?.duration || 0);

    return {
      success: true,
      output_path: outputFile,
      duration_ms: Math.round(duration * 1000),
      operation: 'slice',
      start: parseTime(start),
      end: parseTime(end)
    };
  }

  /**
   * Trim silence from audio
   */
  async _handleTrimSilence(args, session) {
    const { input_path, threshold_db = -50, min_duration = 0.1, output_path } = args;
    if (!input_path) throw new Error('input_path is required');

    const inputFile = this._resolvePath(input_path, session);
    this._validateAudioFile(inputFile);

    const outputFile = await this._getOutputPath(inputFile, 'trimmed', output_path, session);

    const filter = `silenceremove=start_periods=1:start_silence=${min_duration}:start_threshold=${threshold_db}dB,areverse,silenceremove=start_periods=1:start_silence=${min_duration}:start_threshold=${threshold_db}dB,areverse`;

    await runFfmpeg(['-i', inputFile, '-af', filter, outputFile]);

    const info = await runFfprobe(outputFile);
    const duration = parseFloat(info.format?.duration || 0);

    return {
      success: true,
      output_path: outputFile,
      duration_ms: Math.round(duration * 1000),
      operation: 'trim_silence',
      threshold_db,
      min_duration
    };
  }

  /**
   * Concatenate multiple audio files
   */
  async _handleConcat(args, session) {
    const { input_paths, crossfade_ms = 0, output_path } = args;
    if (!input_paths || !Array.isArray(input_paths) || input_paths.length < 2) {
      throw new Error('input_paths array with at least 2 files is required');
    }

    const inputFiles = input_paths.map(p => {
      const resolved = this._resolvePath(p, session);
      this._validateAudioFile(resolved);
      return resolved;
    });

    await this._ensureTempDir();
    const outputFile = await this._getOutputPath(inputFiles[0], 'concat', output_path, session);

    if (crossfade_ms > 0) {
      // Use acrossfade filter for crossfade
      const crossfadeSec = crossfade_ms / 1000;
      let filterComplex = '';
      let currentInput = '[0:a]';

      for (let i = 1; i < inputFiles.length; i++) {
        const nextInput = `[${i}:a]`;
        const outputLabel = i === inputFiles.length - 1 ? '' : `[a${i}]`;
        filterComplex += `${currentInput}${nextInput}acrossfade=d=${crossfadeSec}:c1=tri:c2=tri${outputLabel};`;
        currentInput = `[a${i}]`;
      }

      filterComplex = filterComplex.slice(0, -1); // Remove trailing semicolon

      const ffmpegArgs = inputFiles.flatMap(f => ['-i', f]);
      ffmpegArgs.push('-filter_complex', filterComplex, outputFile);

      await runFfmpeg(ffmpegArgs);
    } else {
      // Use concat demuxer for simple concatenation
      const listFile = join(this.config.tempDir, `concat_${Date.now()}.txt`);
      const listContent = inputFiles.map(f => `file '${f}'`).join('\n');
      await writeFile(listFile, listContent);

      try {
        await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outputFile]);
      } finally {
        await unlink(listFile).catch(() => {});
      }
    }

    const info = await runFfprobe(outputFile);
    const duration = parseFloat(info.format?.duration || 0);

    return {
      success: true,
      output_path: outputFile,
      duration_ms: Math.round(duration * 1000),
      operation: 'concat',
      files_count: inputFiles.length,
      crossfade_ms
    };
  }

  /**
   * Overlay audio on top of base audio
   */
  async _handleOverlay(args, session) {
    const { base_path, overlay_path, offset_ms = 0, overlay_volume = 1.0, output_path } = args;
    if (!base_path) throw new Error('base_path is required');
    if (!overlay_path) throw new Error('overlay_path is required');

    const baseFile = this._resolvePath(base_path, session);
    const overlayFile = this._resolvePath(overlay_path, session);
    this._validateAudioFile(baseFile);
    this._validateAudioFile(overlayFile);

    const outputFile = await this._getOutputPath(baseFile, 'overlay', output_path, session);

    // Build filter: delay overlay, adjust volume, mix with base
    const delayFilter = offset_ms > 0 ? `adelay=${offset_ms}|${offset_ms}` : '';
    const volumeFilter = overlay_volume !== 1.0 ? `volume=${overlay_volume}` : '';

    let overlayChain = '[1:a]';
    if (delayFilter) overlayChain += delayFilter + ',';
    if (volumeFilter) overlayChain += volumeFilter + ',';
    overlayChain = overlayChain.replace(/,$/, '');
    if (overlayChain === '[1:a]') {
      overlayChain = '[1:a]anull';
    }
    overlayChain += '[delayed]';

    const filterComplex = `${overlayChain};[0:a][delayed]amix=inputs=2:duration=longest:normalize=0`;

    await runFfmpeg(['-i', baseFile, '-i', overlayFile, '-filter_complex', filterComplex, outputFile]);

    const info = await runFfprobe(outputFile);
    const duration = parseFloat(info.format?.duration || 0);

    return {
      success: true,
      output_path: outputFile,
      duration_ms: Math.round(duration * 1000),
      operation: 'overlay',
      offset_ms,
      overlay_volume
    };
  }

  /**
   * Adjust volume
   */
  async _handleVolume(args, session) {
    const { input_path, gain_db, output_path } = args;
    if (!input_path) throw new Error('input_path is required');
    if (gain_db === undefined) throw new Error('gain_db is required');

    const inputFile = this._resolvePath(input_path, session);
    this._validateAudioFile(inputFile);

    const outputFile = await this._getOutputPath(inputFile, 'volume', output_path, session);

    await runFfmpeg(['-i', inputFile, '-af', `volume=${gain_db}dB`, outputFile]);

    const info = await runFfprobe(outputFile);
    const duration = parseFloat(info.format?.duration || 0);

    return {
      success: true,
      output_path: outputFile,
      duration_ms: Math.round(duration * 1000),
      operation: 'volume',
      gain_db
    };
  }

  /**
   * Normalize loudness
   */
  async _handleNormalize(args, session) {
    const { input_path, target_lufs = -16, output_path } = args;
    if (!input_path) throw new Error('input_path is required');

    const inputFile = this._resolvePath(input_path, session);
    this._validateAudioFile(inputFile);

    const outputFile = await this._getOutputPath(inputFile, 'normalized', output_path, session);

    const filter = `loudnorm=I=${target_lufs}:TP=-1.5:LRA=11`;
    await runFfmpeg(['-i', inputFile, '-af', filter, outputFile]);

    const info = await runFfprobe(outputFile);
    const duration = parseFloat(info.format?.duration || 0);

    return {
      success: true,
      output_path: outputFile,
      duration_ms: Math.round(duration * 1000),
      operation: 'normalize',
      target_lufs
    };
  }

  /**
   * Apply fade in/out
   */
  async _handleFade(args, session) {
    const { input_path, fade_in_ms = 0, fade_out_ms = 0, curve = 'tri', output_path } = args;
    if (!input_path) throw new Error('input_path is required');
    if (!fade_in_ms && !fade_out_ms) {
      throw new Error('At least one of fade_in_ms or fade_out_ms is required');
    }

    const inputFile = this._resolvePath(input_path, session);
    this._validateAudioFile(inputFile);

    const outputFile = await this._getOutputPath(inputFile, 'fade', output_path, session);

    // Get duration for fade out calculation
    const inputInfo = await runFfprobe(inputFile);
    const duration = parseFloat(inputInfo.format?.duration || 0);

    const filters = [];
    if (fade_in_ms > 0) {
      filters.push(`afade=t=in:st=0:d=${fade_in_ms / 1000}:curve=${curve}`);
    }
    if (fade_out_ms > 0) {
      const fadeOutStart = duration - (fade_out_ms / 1000);
      filters.push(`afade=t=out:st=${fadeOutStart}:d=${fade_out_ms / 1000}:curve=${curve}`);
    }

    await runFfmpeg(['-i', inputFile, '-af', filters.join(','), outputFile]);

    return {
      success: true,
      output_path: outputFile,
      duration_ms: Math.round(duration * 1000),
      operation: 'fade',
      fade_in_ms,
      fade_out_ms,
      curve
    };
  }

  /**
   * Adjust stereo pan
   */
  async _handlePan(args, session) {
    const { input_path, position = 0, output_path } = args;
    if (!input_path) throw new Error('input_path is required');

    const inputFile = this._resolvePath(input_path, session);
    this._validateAudioFile(inputFile);

    const outputFile = await this._getOutputPath(inputFile, 'pan', output_path, session);

    // Position: -1 (full left) to 1 (full right), 0 = center
    const leftGain = Math.min(1, 1 - position);
    const rightGain = Math.min(1, 1 + position);

    const filter = `pan=stereo|c0=${leftGain}*c0|c1=${rightGain}*c1`;
    await runFfmpeg(['-i', inputFile, '-af', filter, outputFile]);

    const info = await runFfprobe(outputFile);
    const duration = parseFloat(info.format?.duration || 0);

    return {
      success: true,
      output_path: outputFile,
      duration_ms: Math.round(duration * 1000),
      operation: 'pan',
      position
    };
  }

  /**
   * Change playback speed (affects pitch)
   */
  async _handleSpeed(args, session) {
    const { input_path, factor, output_path } = args;
    if (!input_path) throw new Error('input_path is required');
    if (!factor) throw new Error('factor is required');
    if (factor < 0.5 || factor > 2.0) {
      throw new Error('factor must be between 0.5 and 2.0');
    }

    const inputFile = this._resolvePath(input_path, session);
    this._validateAudioFile(inputFile);

    const outputFile = await this._getOutputPath(inputFile, 'speed', output_path, session);

    await runFfmpeg(['-i', inputFile, '-af', `atempo=${factor}`, outputFile]);

    const info = await runFfprobe(outputFile);
    const duration = parseFloat(info.format?.duration || 0);

    return {
      success: true,
      output_path: outputFile,
      duration_ms: Math.round(duration * 1000),
      operation: 'speed',
      factor
    };
  }

  /**
   * Change tempo (preserves pitch)
   */
  async _handleTempo(args, session) {
    const { input_path, factor, output_path } = args;
    if (!input_path) throw new Error('input_path is required');
    if (!factor) throw new Error('factor is required');

    const inputFile = this._resolvePath(input_path, session);
    this._validateAudioFile(inputFile);

    const outputFile = await this._getOutputPath(inputFile, 'tempo', output_path, session);

    // atempo filter only supports 0.5-2.0, chain for larger changes
    let tempoFilters = [];
    let remaining = factor;

    while (remaining > 2.0) {
      tempoFilters.push('atempo=2.0');
      remaining /= 2.0;
    }
    while (remaining < 0.5) {
      tempoFilters.push('atempo=0.5');
      remaining /= 0.5;
    }
    tempoFilters.push(`atempo=${remaining}`);

    await runFfmpeg(['-i', inputFile, '-af', tempoFilters.join(','), outputFile]);

    const info = await runFfprobe(outputFile);
    const duration = parseFloat(info.format?.duration || 0);

    return {
      success: true,
      output_path: outputFile,
      duration_ms: Math.round(duration * 1000),
      operation: 'tempo',
      factor
    };
  }

  /**
   * Apply high-pass filter
   */
  async _handleHighpass(args, session) {
    const { input_path, frequency, output_path } = args;
    if (!input_path) throw new Error('input_path is required');
    if (!frequency) throw new Error('frequency is required');

    const inputFile = this._resolvePath(input_path, session);
    this._validateAudioFile(inputFile);

    const outputFile = await this._getOutputPath(inputFile, 'highpass', output_path, session);

    await runFfmpeg(['-i', inputFile, '-af', `highpass=f=${frequency}`, outputFile]);

    const info = await runFfprobe(outputFile);
    const duration = parseFloat(info.format?.duration || 0);

    return {
      success: true,
      output_path: outputFile,
      duration_ms: Math.round(duration * 1000),
      operation: 'highpass',
      frequency
    };
  }

  /**
   * Apply low-pass filter
   */
  async _handleLowpass(args, session) {
    const { input_path, frequency, output_path } = args;
    if (!input_path) throw new Error('input_path is required');
    if (!frequency) throw new Error('frequency is required');

    const inputFile = this._resolvePath(input_path, session);
    this._validateAudioFile(inputFile);

    const outputFile = await this._getOutputPath(inputFile, 'lowpass', output_path, session);

    await runFfmpeg(['-i', inputFile, '-af', `lowpass=f=${frequency}`, outputFile]);

    const info = await runFfprobe(outputFile);
    const duration = parseFloat(info.format?.duration || 0);

    return {
      success: true,
      output_path: outputFile,
      duration_ms: Math.round(duration * 1000),
      operation: 'lowpass',
      frequency
    };
  }

  /**
   * Apply parametric EQ
   */
  async _handleEq(args, session) {
    const { input_path, frequency, gain_db, q = 1.0, output_path } = args;
    if (!input_path) throw new Error('input_path is required');
    if (!frequency) throw new Error('frequency is required');
    if (gain_db === undefined) throw new Error('gain_db is required');

    const inputFile = this._resolvePath(input_path, session);
    this._validateAudioFile(inputFile);

    const outputFile = await this._getOutputPath(inputFile, 'eq', output_path, session);

    const filter = `equalizer=f=${frequency}:width_type=q:width=${q}:g=${gain_db}`;
    await runFfmpeg(['-i', inputFile, '-af', filter, outputFile]);

    const info = await runFfprobe(outputFile);
    const duration = parseFloat(info.format?.duration || 0);

    return {
      success: true,
      output_path: outputFile,
      duration_ms: Math.round(duration * 1000),
      operation: 'eq',
      frequency,
      gain_db,
      q
    };
  }

  /**
   * Add echo effect
   */
  async _handleEcho(args, session) {
    const { input_path, delay_ms = 500, decay = 0.5, output_path } = args;
    if (!input_path) throw new Error('input_path is required');

    const inputFile = this._resolvePath(input_path, session);
    this._validateAudioFile(inputFile);

    const outputFile = await this._getOutputPath(inputFile, 'echo', output_path, session);

    const filter = `aecho=0.8:0.88:${delay_ms}:${decay}`;
    await runFfmpeg(['-i', inputFile, '-af', filter, outputFile]);

    const info = await runFfprobe(outputFile);
    const duration = parseFloat(info.format?.duration || 0);

    return {
      success: true,
      output_path: outputFile,
      duration_ms: Math.round(duration * 1000),
      operation: 'echo',
      delay_ms,
      decay
    };
  }

  /**
   * Add chorus effect
   */
  async _handleChorus(args, session) {
    const { input_path, depth = 0.5, rate = 1.0, output_path } = args;
    if (!input_path) throw new Error('input_path is required');

    const inputFile = this._resolvePath(input_path, session);
    this._validateAudioFile(inputFile);

    const outputFile = await this._getOutputPath(inputFile, 'chorus', output_path, session);

    const filter = `chorus=0.5:0.9:50|60|40:0.4|0.32|0.3:0.25|0.4|0.3:2|2.3|1.3`;
    await runFfmpeg(['-i', inputFile, '-af', filter, outputFile]);

    const info = await runFfprobe(outputFile);
    const duration = parseFloat(info.format?.duration || 0);

    return {
      success: true,
      output_path: outputFile,
      duration_ms: Math.round(duration * 1000),
      operation: 'chorus',
      depth,
      rate
    };
  }

  /**
   * Convert audio format
   */
  async _handleConvert(args, session) {
    const { input_path, output_format, sample_rate, channels, bitrate, output_path } = args;
    if (!input_path) throw new Error('input_path is required');
    if (!output_format) throw new Error('output_format is required');

    const inputFile = this._resolvePath(input_path, session);
    this._validateAudioFile(inputFile);

    const ext = output_format.startsWith('.') ? output_format : `.${output_format}`;
    const defaultOutput = await this._getOutputPath(inputFile, 'converted', null, session);
    const outputFile = output_path
      ? this._resolvePath(output_path, session)
      : defaultOutput.replace(extname(defaultOutput), ext);

    const ffmpegArgs = ['-i', inputFile];

    if (sample_rate) ffmpegArgs.push('-ar', String(sample_rate));
    if (channels) ffmpegArgs.push('-ac', String(channels));
    if (bitrate) ffmpegArgs.push('-b:a', bitrate);

    ffmpegArgs.push(outputFile);

    await runFfmpeg(ffmpegArgs);

    const info = await runFfprobe(outputFile);
    const duration = parseFloat(info.format?.duration || 0);

    return {
      success: true,
      output_path: outputFile,
      duration_ms: Math.round(duration * 1000),
      operation: 'convert',
      output_format: ext,
      sample_rate,
      channels,
      bitrate
    };
  }

  /**
   * Apply multiple operations in pipeline
   */
  async _handlePipeline(args, session) {
    const { input_path, operations, output_path } = args;
    if (!input_path) throw new Error('input_path is required');
    if (!operations || !Array.isArray(operations) || operations.length === 0) {
      throw new Error('operations array is required');
    }

    let currentInput = this._resolvePath(input_path, session);
    this._validateAudioFile(currentInput);

    const tempFiles = [];
    const appliedOps = [];

    try {
      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        const isLast = i === operations.length - 1;
        const opOutput = isLast && output_path
          ? this._resolvePath(output_path, session)
          : null;

        const opArgs = {
          ...op,
          input_path: currentInput,
          output_path: opOutput
        };

        let result;
        switch (op.action) {
          case 'slice': result = await this._handleSlice(opArgs, session); break;
          case 'trim_silence': result = await this._handleTrimSilence(opArgs, session); break;
          case 'volume': result = await this._handleVolume(opArgs, session); break;
          case 'normalize': result = await this._handleNormalize(opArgs, session); break;
          case 'fade': result = await this._handleFade(opArgs, session); break;
          case 'pan': result = await this._handlePan(opArgs, session); break;
          case 'speed': result = await this._handleSpeed(opArgs, session); break;
          case 'tempo': result = await this._handleTempo(opArgs, session); break;
          case 'highpass': result = await this._handleHighpass(opArgs, session); break;
          case 'lowpass': result = await this._handleLowpass(opArgs, session); break;
          case 'eq': result = await this._handleEq(opArgs, session); break;
          case 'echo': result = await this._handleEcho(opArgs, session); break;
          case 'chorus': result = await this._handleChorus(opArgs, session); break;
          default:
            throw new Error(`Unknown pipeline operation: ${op.action}`);
        }

        // Track temp file for cleanup
        if (!isLast && currentInput !== this._resolvePath(input_path, session)) {
          tempFiles.push(currentInput);
        }

        currentInput = result.output_path;
        appliedOps.push(op.action);
      }

      // Cleanup intermediate files
      for (const tempFile of tempFiles) {
        await unlink(tempFile).catch(() => {});
      }

      const info = await runFfprobe(currentInput);
      const duration = parseFloat(info.format?.duration || 0);

      return {
        success: true,
        output_path: currentInput,
        duration_ms: Math.round(duration * 1000),
        operation: 'pipeline',
        operations_applied: appliedOps
      };
    } catch (error) {
      // Cleanup on error
      for (const tempFile of tempFiles) {
        await unlink(tempFile).catch(() => {});
      }
      throw error;
    }
  }

  /**
   * Check available backends
   */
  async _handleCheckBackends() {
    return {
      success: true,
      ffmpeg_available: this.hasFfmpeg,
      ffprobe_available: this.hasFfprobe,
      ready: this.hasFfmpeg && this.hasFfprobe,
      supported_formats: SUPPORTED_FORMATS
    };
  }

  /**
   * Main handler for tool execution
   * @param {Object} args - Tool arguments
   * @param {Object} session - Session object
   * @returns {Promise<Object>}
   */
  async handle(args, session) {
    if (!this.hasFfmpeg) {
      throw new Error('FFmpeg is not installed. Please install ffmpeg.');
    }

    const { action } = args;

    switch (action) {
      case 'info': return this._handleInfo(args, session);
      case 'slice': return this._handleSlice(args, session);
      case 'trim_silence': return this._handleTrimSilence(args, session);
      case 'concat': return this._handleConcat(args, session);
      case 'overlay': return this._handleOverlay(args, session);
      case 'volume': return this._handleVolume(args, session);
      case 'normalize': return this._handleNormalize(args, session);
      case 'fade': return this._handleFade(args, session);
      case 'pan': return this._handlePan(args, session);
      case 'speed': return this._handleSpeed(args, session);
      case 'tempo': return this._handleTempo(args, session);
      case 'highpass': return this._handleHighpass(args, session);
      case 'lowpass': return this._handleLowpass(args, session);
      case 'eq': return this._handleEq(args, session);
      case 'echo': return this._handleEcho(args, session);
      case 'chorus': return this._handleChorus(args, session);
      case 'convert': return this._handleConvert(args, session);
      case 'pipeline': return this._handlePipeline(args, session);
      case 'check_backends': return this._handleCheckBackends();
      default:
        throw new Error(`Unknown action: ${action}. Valid actions: info, slice, trim_silence, concat, overlay, volume, normalize, fade, pan, speed, tempo, highpass, lowpass, eq, echo, chorus, convert, pipeline, check_backends`);
    }
  }

  /**
   * Register tools with the router
   * @param {ToolRouter} router - Tool router instance
   */
  registerTools(router) {
    router.registerTool('edit_audio', this.handle.bind(this), {
      name: 'edit_audio',
      description: 'Edit audio files using ffmpeg - slice, trim, concatenate, overlay, adjust volume, apply effects, and convert formats',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['info', 'slice', 'trim_silence', 'concat', 'overlay', 'volume', 'normalize', 'fade', 'pan', 'speed', 'tempo', 'highpass', 'lowpass', 'eq', 'echo', 'chorus', 'convert', 'pipeline', 'check_backends'],
            description: 'Audio editing action to perform'
          },
          input_path: {
            type: 'string',
            description: 'Path to input audio file'
          },
          input_paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of input paths for concat action'
          },
          output_path: {
            type: 'string',
            description: 'Path for output file (auto-generated if not provided)'
          },
          start: {
            type: ['number', 'string'],
            description: 'Start time for slice (seconds, "HH:MM:SS", or "5000ms")'
          },
          end: {
            type: ['number', 'string'],
            description: 'End time for slice'
          },
          gain_db: {
            type: 'number',
            description: 'Volume gain in decibels (-60 to +20)'
          },
          target_lufs: {
            type: 'number',
            description: 'Target loudness in LUFS for normalize (default: -16)'
          },
          fade_in_ms: {
            type: 'number',
            description: 'Fade in duration in milliseconds'
          },
          fade_out_ms: {
            type: 'number',
            description: 'Fade out duration in milliseconds'
          },
          position: {
            type: 'number',
            description: 'Pan position: -1 (left) to 1 (right), 0 = center'
          },
          factor: {
            type: 'number',
            description: 'Speed/tempo factor (0.5 to 2.0)'
          },
          frequency: {
            type: 'number',
            description: 'Filter frequency in Hz'
          },
          q: {
            type: 'number',
            description: 'EQ Q factor (bandwidth)'
          },
          delay_ms: {
            type: 'number',
            description: 'Echo delay in milliseconds'
          },
          decay: {
            type: 'number',
            description: 'Echo decay factor (0 to 1)'
          },
          base_path: {
            type: 'string',
            description: 'Base audio path for overlay'
          },
          overlay_path: {
            type: 'string',
            description: 'Overlay audio path'
          },
          offset_ms: {
            type: 'number',
            description: 'Overlay offset in milliseconds'
          },
          overlay_volume: {
            type: 'number',
            description: 'Overlay volume multiplier'
          },
          crossfade_ms: {
            type: 'number',
            description: 'Crossfade duration for concat'
          },
          output_format: {
            type: 'string',
            description: 'Output format for convert (wav, mp3, ogg, flac)'
          },
          sample_rate: {
            type: 'number',
            description: 'Sample rate for convert'
          },
          channels: {
            type: 'number',
            description: 'Channel count for convert (1=mono, 2=stereo)'
          },
          bitrate: {
            type: 'string',
            description: 'Bitrate for convert (e.g., "192k")'
          },
          operations: {
            type: 'array',
            description: 'Array of operations for pipeline action'
          },
          threshold_db: {
            type: 'number',
            description: 'Silence threshold in dB for trim_silence'
          }
        },
        required: ['action']
      }
    });

    // Convenience alias
    router.registerTool('audio_edit', this.handle.bind(this), {
      name: 'audio_edit',
      description: 'Alias for edit_audio tool',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'Audio editing action' },
          input_path: { type: 'string', description: 'Input audio file' },
          output_path: { type: 'string', description: 'Output file path' }
        },
        required: ['action']
      }
    });
  }
}

export default EditAudioTool;
