/**
 * @fileoverview Create Drum Tool
 * @module create-drum-tool
 *
 * Tool registry integration for TR-808 style drum pattern sequencing.
 * Uses ffmpeg to stitch samples into finished tracks.
 */

import { spawn, execSync } from 'child_process';
import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync, createWriteStream } from 'fs';
import { join, resolve, basename, extname, dirname } from 'path';
import { tmpdir, homedir, platform } from 'os';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

// Bundled assets directory (relative to this module)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BUNDLED_SAMPLES_DIR = join(__dirname, '..', 'assets', 'audio', 'drums808');

/**
 * TR-808 sample mapping
 * Maps short codes to sample names
 */
const SAMPLE_MAP = {
  // Kicks
  'BD': { name: 'kick', file: 'bd.mp3', category: 'kicks', aliases: ['kick', 'bass_drum', 'bd'], bundled: true },
  // Snares
  'SD': { name: 'snare', file: 'sd.mp3', category: 'snares', aliases: ['snare', 'sd'], bundled: true },
  // Clap
  'CP': { name: 'clap', file: 'cp.mp3', category: 'percussion', aliases: ['clap', 'cp', 'handclap'], bundled: true },
  // Hi-hats
  'CH': { name: 'hihat-closed', file: 'hc.mp3', category: 'hihats', aliases: ['hihat', 'hh', 'closed_hihat', 'ch'], bundled: true },
  'OH': { name: 'hihat-open', file: 'ho.mp3', category: 'hihats', aliases: ['open_hihat', 'oh'], bundled: true },
  // Cowbell
  'CB': { name: 'cowbell', file: 'cb.mp3', category: 'percussion', aliases: ['cowbell', 'cb'], bundled: true },
  // Rimshot
  'RS': { name: 'rimshot', file: 'rs.mp3', category: 'percussion', aliases: ['rimshot', 'rs', 'rim'], bundled: true }
};

/**
 * Preset patterns for common genres
 */
const PRESET_PATTERNS = {
  'basic_rock': {
    name: 'Basic Rock',
    description: 'Simple rock beat with kick on 1 and 3, snare on 2 and 4',
    bpm: 120,
    pattern: `BD x---x---|x---x---
SD ----|x---|----|x---
CH x-x-|x-x-|x-x-|x-x-`
  },
  'four_on_floor': {
    name: 'Four on the Floor',
    description: 'Classic house/disco beat with kick on every quarter note',
    bpm: 128,
    pattern: `BD x---|x---|x---|x---
CH x-x-|x-x-|x-x-|x-x-
OH ----|---x|----|---x`
  },
  'boom_bap': {
    name: 'Boom Bap',
    description: 'Classic hip-hop beat with syncopated kick',
    bpm: 90,
    pattern: `BD x--x|----|x--x|----
SD ----|x---|----|x---
CH x-x-|x-x-|x-x-|x-x-`
  },
  'trap': {
    name: 'Trap',
    description: 'Modern trap beat with fast hi-hats and 808',
    bpm: 140,
    pattern: `BD x---|----|----|--x-
SD ----|x---|----|x---
CH xxxx|xxxx|xxxx|xxxx`
  },
  'dnb': {
    name: 'Drum and Bass',
    description: 'Fast breakbeat style pattern',
    bpm: 174,
    pattern: `BD x---|----|x--x|----
SD ----|x---|----|x---
CH x-x-|x-x-|x-x-|x-x-`
  },
  'reggae': {
    name: 'Reggae',
    description: 'Reggae one-drop rhythm',
    bpm: 80,
    pattern: `BD ----|x---|----|x---
SD ----|x---|----|x---
CH -x-x|-x-x|-x-x|-x-x
RS x---|----|----|----`
  },
  'funk': {
    name: 'Funk',
    description: 'Syncopated funk groove',
    bpm: 100,
    pattern: `BD x--x|----|x--x|--x-
SD ----|x--x|----|x---
CH x-x-|x-x-|x-x-|x-x-`
  },
  'disco': {
    name: 'Disco',
    description: 'Classic disco beat',
    bpm: 120,
    pattern: `BD x---|x---|x---|x---
SD ----|x---|----|x---
CH x-x-|x-x-|x-x-|x-x-
OH ----|---x|----|---x`
  },
  'techno': {
    name: 'Techno',
    description: 'Driving techno beat',
    bpm: 135,
    pattern: `BD x---|x---|x---|x---
CH -x-x|-x-x|-x-x|-x-x
OH ----|----|---x|----
CP ----|x---|----|x---`
  },
  'bossa_nova': {
    name: 'Bossa Nova',
    description: 'Brazilian bossa nova rhythm',
    bpm: 130,
    pattern: `BD x--x|--x-|x--x|--x-
RS x---|--x-|x---|--x-
CH x-x-|x-x-|x-x-|x-x-`
  }
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  tempDir: join(tmpdir(), 'create-drum-tool'),
  sampleCacheDir: null, // Set per-platform in constructor
  sampleSource: 'https://raw.githubusercontent.com/emanuelefavero/drum-machine-808/master/sounds/',
  defaultBpm: 120,
  defaultStepsPerBeat: 4, // 16th notes
  ppqn: 480, // Pulses per quarter note
  sampleRate: 44100
};

/**
 * Get platform-specific cache directory
 */
function getCacheDir() {
  const plat = platform();
  if (plat === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'create-drum-tool');
  } else if (plat === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'create-drum-tool');
  } else {
    return join(homedir(), '.cache', 'create-drum-tool');
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
 * Download a file
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = createWriteStream(destPath);

    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Follow redirect
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      unlink(destPath).catch(() => {});
      reject(err);
    });
  });
}

/**
 * Run ffmpeg command
 */
function runFfmpeg(args, timeout = 300000) {
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
 * Get audio duration via ffprobe
 */
function getAudioDuration(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath
    ]);

    let stdout = '';
    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        try {
          const info = JSON.parse(stdout);
          resolve(parseFloat(info.format?.duration || 0));
        } catch {
          resolve(0);
        }
      } else {
        resolve(0);
      }
    });

    proc.on('error', () => resolve(0));
  });
}

/**
 * Create Drum Tool Class
 */
export class CreateDrumTool {
  /**
   * @param {Object} sessionManager - Session manager instance
   * @param {Object} options - Configuration options
   */
  constructor(sessionManager, options = {}) {
    this.sessionManager = sessionManager;
    this.config = {
      ...DEFAULT_CONFIG,
      sampleCacheDir: join(getCacheDir(), 'samples'),
      ...options
    };

    this.hasFfmpeg = checkFfmpeg();
    this.sampleDurations = {}; // Cache for sample durations
  }

  /**
   * Ensure directories exist
   */
  async _ensureDirs() {
    if (!existsSync(this.config.tempDir)) {
      await mkdir(this.config.tempDir, { recursive: true });
    }
    if (!existsSync(this.config.sampleCacheDir)) {
      await mkdir(this.config.sampleCacheDir, { recursive: true });
    }
  }

  /**
   * Resolve sample code to sample info
   */
  _resolveSample(code) {
    const upperCode = code.toUpperCase();

    // Direct match
    if (SAMPLE_MAP[upperCode]) {
      return SAMPLE_MAP[upperCode];
    }

    // Search aliases
    for (const [key, sample] of Object.entries(SAMPLE_MAP)) {
      if (sample.aliases.some(a => a.toLowerCase() === code.toLowerCase())) {
        return sample;
      }
    }

    return null;
  }

  /**
   * Get path to sample file (bundled assets)
   */
  async _getSamplePath(sampleInfo) {
    // Use bundled samples
    if (sampleInfo.bundled) {
      const bundledPath = join(BUNDLED_SAMPLES_DIR, sampleInfo.file);
      if (existsSync(bundledPath)) {
        return bundledPath;
      }
      throw new Error(`Bundled sample not found: ${sampleInfo.file}`);
    }

    // Fallback to cache dir for any future non-bundled samples
    await this._ensureDirs();
    const samplePath = join(this.config.sampleCacheDir, sampleInfo.file);

    if (!existsSync(samplePath)) {
      const url = `${this.config.sampleSource}${sampleInfo.file}`;
      await downloadFile(url, samplePath);
    }

    return samplePath;
  }

  /**
   * Parse pattern notation
   * Format: "INSTRUMENT pattern" where pattern is x/-/X/o characters
   * x = hit (velocity 80), X = accent (velocity 127), o = soft (velocity 50), - = rest
   */
  _parsePattern(patternString) {
    const lines = patternString.trim().split('\n');
    const tracks = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Split into instrument and pattern
      const match = trimmed.match(/^(\w+)\s+(.+)$/);
      if (!match) continue;

      const [, instrument, patternPart] = match;
      const sample = this._resolveSample(instrument);

      if (!sample) {
        throw new Error(`Unknown instrument: ${instrument}. Valid: ${Object.keys(SAMPLE_MAP).join(', ')}`);
      }

      // Parse pattern characters
      const steps = [];
      let stepIndex = 0;

      for (const char of patternPart) {
        if (char === '|') continue; // Bar separator
        if (char === ' ') continue;

        if (char === 'x') {
          steps.push({ step: stepIndex, velocity: 80 });
        } else if (char === 'X') {
          steps.push({ step: stepIndex, velocity: 127 });
        } else if (char === 'o') {
          steps.push({ step: stepIndex, velocity: 50 });
        }
        // '-' is a rest, no step added

        stepIndex++;
      }

      if (steps.length > 0 || stepIndex > 0) {
        tracks.push({
          sample,
          steps,
          totalSteps: stepIndex
        });
      }
    }

    return tracks;
  }

  /**
   * Calculate timing for pattern
   */
  _calculateTiming(tracks, bpm, stepsPerBeat = 4) {
    // Calculate step duration in milliseconds
    const stepDurationMs = (60 * 1000) / bpm / stepsPerBeat;

    // Find total steps (max across all tracks)
    const totalSteps = Math.max(...tracks.map(t => t.totalSteps));
    const totalDurationMs = totalSteps * stepDurationMs;

    // Calculate timestamps for each hit
    const events = [];

    for (const track of tracks) {
      for (const step of track.steps) {
        events.push({
          sample: track.sample,
          timestampMs: step.step * stepDurationMs,
          velocity: step.velocity
        });
      }
    }

    // Sort by timestamp
    events.sort((a, b) => a.timestampMs - b.timestampMs);

    return {
      events,
      totalSteps,
      totalDurationMs,
      stepDurationMs
    };
  }

  /**
   * Render pattern to audio file using ffmpeg
   */
  async _renderPattern(timing, outputPath, loops = 1) {
    await this._ensureDirs();

    const { events, totalDurationMs } = timing;

    if (events.length === 0) {
      throw new Error('Pattern has no hits to render');
    }

    // Get unique samples and their paths
    const samplePaths = {};
    for (const event of events) {
      const key = event.sample.name;
      if (!samplePaths[key]) {
        samplePaths[key] = await this._getSamplePath(event.sample);

        // Cache sample duration
        if (!this.sampleDurations[key]) {
          this.sampleDurations[key] = await getAudioDuration(samplePaths[key]);
        }
      }
    }

    // Build ffmpeg filter complex
    // Each sample hit: delay by timestamp, apply volume
    const inputs = [];
    const filterParts = [];
    let inputIndex = 0;

    for (const event of events) {
      const samplePath = samplePaths[event.sample.name];
      inputs.push('-i', samplePath);

      const delayMs = Math.round(event.timestampMs);
      const volume = event.velocity / 127;

      // Apply delay and volume
      filterParts.push(`[${inputIndex}:a]adelay=${delayMs}|${delayMs},volume=${volume}[s${inputIndex}]`);
      inputIndex++;
    }

    // Mix all streams
    const mixInputs = events.map((_, i) => `[s${i}]`).join('');
    filterParts.push(`${mixInputs}amix=inputs=${events.length}:duration=longest:normalize=0[mixed]`);

    // If loops > 1, we'll render one iteration then loop it
    const oneIterationPath = loops > 1
      ? join(this.config.tempDir, `pattern_single_${Date.now()}.wav`)
      : outputPath;

    const filterComplex = filterParts.join(';');

    await runFfmpeg([
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', '[mixed]',
      '-ar', String(this.config.sampleRate),
      oneIterationPath
    ]);

    // Handle loops
    if (loops > 1) {
      // Create file list for concat
      const listFile = join(this.config.tempDir, `loop_list_${Date.now()}.txt`);
      const listContent = Array(loops).fill(`file '${oneIterationPath}'`).join('\n');
      await writeFile(listFile, listContent);

      try {
        await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outputPath]);
      } finally {
        await unlink(listFile).catch(() => {});
        await unlink(oneIterationPath).catch(() => {});
      }
    }

    return {
      outputPath,
      totalDurationMs: totalDurationMs * loops
    };
  }

  /**
   * Apply swing to timing
   */
  _applySwing(timing, swingPercent) {
    if (swingPercent === 0) return timing;

    const swingAmount = (swingPercent / 100) * timing.stepDurationMs;

    // Swing affects even-numbered steps (0-indexed)
    for (const event of timing.events) {
      const stepInBeat = Math.floor(event.timestampMs / timing.stepDurationMs) % 4;
      if (stepInBeat % 2 === 1) { // Odd steps (2nd, 4th, etc. in 16ths)
        event.timestampMs += swingAmount;
      }
    }

    // Re-sort
    timing.events.sort((a, b) => a.timestampMs - b.timestampMs);

    return timing;
  }

  /**
   * Apply humanization to timing and velocity
   */
  _applyHumanize(timing, timingVariance = 10, velocityVariance = 0.1, seed = null) {
    // Simple pseudo-random for reproducibility
    let rand = seed !== null ? seed : Math.random() * 10000;
    const random = () => {
      rand = (rand * 1103515245 + 12345) % 2147483648;
      return rand / 2147483648;
    };

    for (const event of timing.events) {
      // Timing jitter (normal-ish distribution using Box-Muller approximation)
      const u1 = random();
      const u2 = random();
      const timingJitter = Math.sqrt(-2 * Math.log(u1 + 0.001)) * Math.cos(2 * Math.PI * u2);
      event.timestampMs += timingJitter * timingVariance;
      event.timestampMs = Math.max(0, event.timestampMs);

      // Velocity variation
      const velVariation = 1 + (random() - 0.5) * 2 * velocityVariance;
      event.velocity = Math.round(Math.min(127, Math.max(1, event.velocity * velVariation)));
    }

    return timing;
  }

  /**
   * Handle render action
   */
  async _handleRender(args, session) {
    const {
      pattern,
      bpm = this.config.defaultBpm,
      loops = 1,
      swing = 0,
      humanize = false,
      timing_variance = 10,
      velocity_variance = 0.1,
      humanize_seed = null,
      output_format = 'wav',
      output_path
    } = args;

    if (!pattern) throw new Error('pattern is required');

    // Parse pattern
    const tracks = this._parsePattern(pattern);
    if (tracks.length === 0) {
      throw new Error('Pattern has no valid tracks');
    }

    // Calculate timing
    let timing = this._calculateTiming(tracks, bpm, this.config.defaultStepsPerBeat);

    // Apply swing
    if (swing > 0) {
      timing = this._applySwing(timing, swing);
    }

    // Apply humanization
    if (humanize) {
      timing = this._applyHumanize(timing, timing_variance, velocity_variance, humanize_seed);
    }

    // Determine output path
    await this._ensureDirs();
    const ext = output_format.startsWith('.') ? output_format : `.${output_format}`;
    const outPath = output_path
      ? (session?.sandboxPath && !output_path.startsWith('/')
          ? resolve(join(session.sandboxPath, output_path))
          : resolve(output_path))
      : join(this.config.tempDir, `pattern_${Date.now()}${ext}`);

    // Ensure parent directory exists
    const parentDir = dirname(outPath);
    if (!existsSync(parentDir)) {
      await mkdir(parentDir, { recursive: true });
    }

    // Render
    const result = await this._renderPattern(timing, outPath, loops);

    return {
      success: true,
      output_path: result.outputPath,
      duration_ms: Math.round(result.totalDurationMs),
      bpm,
      bars: Math.ceil(timing.totalSteps / 16),
      loops,
      swing,
      humanize,
      tracks_count: tracks.length,
      hits_count: timing.events.length
    };
  }

  /**
   * Handle build_song action - chain patterns into arrangement
   */
  async _handleBuildSong(args, session) {
    const { patterns, sequence, crossfade_ms = 0, output_path } = args;

    if (!patterns || typeof patterns !== 'object') {
      throw new Error('patterns object is required');
    }
    if (!sequence || !Array.isArray(sequence) || sequence.length === 0) {
      throw new Error('sequence array is required');
    }

    await this._ensureDirs();

    // Render each unique pattern
    const renderedPatterns = {};
    for (const [name, config] of Object.entries(patterns)) {
      const patternPath = join(this.config.tempDir, `song_pattern_${name}_${Date.now()}.wav`);
      const tracks = this._parsePattern(config.pattern);
      const timing = this._calculateTiming(tracks, config.bpm || this.config.defaultBpm);

      if (config.swing) {
        this._applySwing(timing, config.swing);
      }

      await this._renderPattern(timing, patternPath, 1);
      renderedPatterns[name] = patternPath;
    }

    // Build sequence file list
    const patternFiles = sequence.map(name => {
      if (!renderedPatterns[name]) {
        throw new Error(`Pattern "${name}" not found in patterns object`);
      }
      return renderedPatterns[name];
    });

    // Determine output
    const ext = '.wav';
    const outPath = output_path
      ? (session?.sandboxPath && !output_path.startsWith('/')
          ? resolve(join(session.sandboxPath, output_path))
          : resolve(output_path))
      : join(this.config.tempDir, `song_${Date.now()}${ext}`);

    // Ensure parent directory exists
    const outParentDir = dirname(outPath);
    if (!existsSync(outParentDir)) {
      await mkdir(outParentDir, { recursive: true });
    }

    // Concatenate
    if (crossfade_ms > 0 && patternFiles.length > 1) {
      // Use acrossfade filter
      const crossfadeSec = crossfade_ms / 1000;
      let filterComplex = '';
      let currentInput = '[0:a]';

      for (let i = 1; i < patternFiles.length; i++) {
        const nextInput = `[${i}:a]`;
        const outputLabel = i === patternFiles.length - 1 ? '' : `[a${i}]`;
        filterComplex += `${currentInput}${nextInput}acrossfade=d=${crossfadeSec}:c1=tri:c2=tri${outputLabel};`;
        currentInput = `[a${i}]`;
      }
      filterComplex = filterComplex.slice(0, -1);

      const ffmpegArgs = patternFiles.flatMap(f => ['-i', f]);
      ffmpegArgs.push('-filter_complex', filterComplex, outPath);

      await runFfmpeg(ffmpegArgs);
    } else {
      // Simple concat
      const listFile = join(this.config.tempDir, `song_list_${Date.now()}.txt`);
      const listContent = patternFiles.map(f => `file '${f}'`).join('\n');
      await writeFile(listFile, listContent);

      try {
        await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outPath]);
      } finally {
        await unlink(listFile).catch(() => {});
      }
    }

    // Cleanup pattern files
    for (const path of Object.values(renderedPatterns)) {
      await unlink(path).catch(() => {});
    }

    const duration = await getAudioDuration(outPath);

    return {
      success: true,
      output_path: outPath,
      duration_ms: Math.round(duration * 1000),
      patterns_count: Object.keys(patterns).length,
      sequence_length: sequence.length,
      crossfade_ms
    };
  }

  /**
   * Handle list_samples action
   */
  async _handleListSamples() {
    const samples = Object.entries(SAMPLE_MAP).map(([code, sample]) => ({
      code,
      name: sample.name,
      category: sample.category,
      aliases: sample.aliases
    }));

    const categories = [...new Set(samples.map(s => s.category))];

    return {
      success: true,
      samples,
      categories,
      total_count: samples.length
    };
  }

  /**
   * Handle list_presets action
   */
  async _handleListPresets() {
    const presets = Object.entries(PRESET_PATTERNS).map(([key, preset]) => ({
      key,
      name: preset.name,
      description: preset.description,
      bpm: preset.bpm
    }));

    return {
      success: true,
      presets,
      total_count: presets.length
    };
  }

  /**
   * Handle get_preset action
   */
  async _handleGetPreset(args) {
    const { preset_name } = args;
    if (!preset_name) throw new Error('preset_name is required');

    const preset = PRESET_PATTERNS[preset_name.toLowerCase()];
    if (!preset) {
      throw new Error(`Preset not found: ${preset_name}. Use list_presets to see available presets.`);
    }

    return {
      success: true,
      preset: {
        key: preset_name.toLowerCase(),
        name: preset.name,
        description: preset.description,
        bpm: preset.bpm,
        pattern: preset.pattern
      }
    };
  }

  /**
   * Handle render_preset action - convenience method
   */
  async _handleRenderPreset(args, session) {
    const { preset_name, bpm, loops, swing, humanize, output_path } = args;

    const presetResult = await this._handleGetPreset({ preset_name });
    const preset = presetResult.preset;

    return this._handleRender({
      pattern: preset.pattern,
      bpm: bpm || preset.bpm,
      loops,
      swing,
      humanize,
      output_path
    }, session);
  }

  /**
   * Handle check_backends action
   */
  async _handleCheckBackends() {
    // Check bundled sample availability
    let samplesReady = false;
    try {
      const samplePath = join(BUNDLED_SAMPLES_DIR, 'bd.mp3');
      samplesReady = existsSync(samplePath);
    } catch {}

    return {
      success: true,
      ffmpeg_available: this.hasFfmpeg,
      samples_bundled: samplesReady,
      bundled_samples_dir: BUNDLED_SAMPLES_DIR,
      ready: this.hasFfmpeg && samplesReady,
      presets_available: Object.keys(PRESET_PATTERNS).length,
      samples_available: Object.keys(SAMPLE_MAP).length
    };
  }

  /**
   * Handle verify_samples action (samples are now bundled)
   */
  async _handleDownloadSamples() {
    const available = [];
    const missing = [];

    for (const [code, sample] of Object.entries(SAMPLE_MAP)) {
      try {
        await this._getSamplePath(sample);
        available.push(code);
      } catch (err) {
        missing.push({ code, error: err.message });
      }
    }

    return {
      success: missing.length === 0,
      available_count: available.length,
      missing_count: missing.length,
      available,
      missing,
      bundled_dir: BUNDLED_SAMPLES_DIR
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
      case 'render': return this._handleRender(args, session);
      case 'build_song': return this._handleBuildSong(args, session);
      case 'list_samples': return this._handleListSamples();
      case 'list_presets': return this._handleListPresets();
      case 'get_preset': return this._handleGetPreset(args);
      case 'render_preset': return this._handleRenderPreset(args, session);
      case 'download_samples': return this._handleDownloadSamples();
      case 'check_backends': return this._handleCheckBackends();
      default:
        throw new Error(`Unknown action: ${action}. Valid actions: render, build_song, list_samples, list_presets, get_preset, render_preset, download_samples, check_backends`);
    }
  }

  /**
   * Register tools with the router
   * @param {ToolRouter} router - Tool router instance
   */
  registerTools(router) {
    router.registerTool('create_drum', this.handle.bind(this), {
      name: 'create_drum',
      description: 'Create TR-808 style drum patterns and render to audio using ffmpeg',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['render', 'build_song', 'list_samples', 'list_presets', 'get_preset', 'render_preset', 'download_samples', 'check_backends'],
            description: 'Action to perform'
          },
          pattern: {
            type: 'string',
            description: 'Pattern notation: "BD x---x---|x---x---\\nSD ----|x---|----|x---" where x=hit, X=accent, o=soft, -=rest, |=bar separator'
          },
          bpm: {
            type: 'number',
            description: 'Tempo in BPM (default: 120)'
          },
          loops: {
            type: 'number',
            description: 'Number of times to repeat the pattern (default: 1)'
          },
          swing: {
            type: 'number',
            description: 'Swing percentage 0-100 (default: 0)'
          },
          humanize: {
            type: 'boolean',
            description: 'Add timing and velocity variation for natural feel (default: false)'
          },
          timing_variance: {
            type: 'number',
            description: 'Timing jitter in ms for humanize (default: 10)'
          },
          velocity_variance: {
            type: 'number',
            description: 'Velocity variation 0-1 for humanize (default: 0.1)'
          },
          output_format: {
            type: 'string',
            description: 'Output format: wav, mp3 (default: wav)'
          },
          output_path: {
            type: 'string',
            description: 'Path for output file (auto-generated if not provided)'
          },
          preset_name: {
            type: 'string',
            description: 'Name of preset pattern (for get_preset/render_preset actions)'
          },
          patterns: {
            type: 'object',
            description: 'Object of named patterns for build_song action'
          },
          sequence: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of pattern names for build_song arrangement'
          },
          crossfade_ms: {
            type: 'number',
            description: 'Crossfade duration between patterns in ms (for build_song)'
          }
        },
        required: ['action']
      }
    });

    // Convenience alias
    router.registerTool('drum_machine', this.handle.bind(this), {
      name: 'drum_machine',
      description: 'Alias for create_drum - TR-808 style drum pattern generator',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'Action to perform' },
          pattern: { type: 'string', description: 'Drum pattern notation' },
          bpm: { type: 'number', description: 'Tempo in BPM' }
        },
        required: ['action']
      }
    });

    // Quick beat generator
    router.registerTool('make_beat', async (args, session) => {
      if (args.preset) {
        return this.handle({
          action: 'render_preset',
          preset_name: args.preset,
          bpm: args.bpm,
          loops: args.loops,
          output_path: args.output_path
        }, session);
      } else {
        return this.handle({
          action: 'render',
          pattern: args.pattern,
          bpm: args.bpm,
          loops: args.loops,
          output_path: args.output_path
        }, session);
      }
    }, {
      name: 'make_beat',
      description: 'Quick drum beat generator - provide pattern or preset name',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Drum pattern notation' },
          preset: { type: 'string', description: 'Preset name (e.g., boom_bap, trap, four_on_floor)' },
          bpm: { type: 'number', description: 'Tempo in BPM' },
          loops: { type: 'number', description: 'Number of repetitions' },
          output_path: { type: 'string', description: 'Output file path' }
        }
      }
    });
  }
}

export default CreateDrumTool;
