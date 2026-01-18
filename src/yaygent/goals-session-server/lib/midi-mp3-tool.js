/**
 * @fileoverview MIDI MP3 Tool
 * @module midi-mp3-tool
 *
 * Tool registry integration for generating MIDI from text notation
 * and synthesizing to audio using FluidSynth with SoundFonts.
 */

import { spawn, execSync } from 'child_process';
import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync, createWriteStream } from 'fs';
import { join, resolve, basename, extname, dirname } from 'path';
import { tmpdir, homedir, platform } from 'os';
import https from 'https';
import http from 'http';

/**
 * Note name to MIDI number mapping (C4 = middle C = 60)
 */
const NOTE_MAP = {
  'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11
};

/**
 * Duration mapping (in ticks at 480 PPQN)
 */
const DURATION_MAP = {
  'w': 1920,   // whole note
  'h': 960,    // half note
  'q': 480,    // quarter note
  'e': 240,    // eighth note
  's': 120,    // sixteenth note
  't': 60      // thirty-second note
};

/**
 * General MIDI instrument names (0-127)
 */
const GM_INSTRUMENTS = [
  'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano',
  'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone',
  'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ',
  'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
  'Acoustic Guitar (nylon)', 'Acoustic Guitar (steel)', 'Electric Guitar (jazz)', 'Electric Guitar (clean)',
  'Electric Guitar (muted)', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
  'Acoustic Bass', 'Electric Bass (finger)', 'Electric Bass (pick)', 'Fretless Bass',
  'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
  'Violin', 'Viola', 'Cello', 'Contrabass',
  'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
  'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2',
  'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit',
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet',
  'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax',
  'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute',
  'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)', 'Lead 4 (chiff)',
  'Lead 5 (charang)', 'Lead 6 (voice)', 'Lead 7 (fifths)', 'Lead 8 (bass + lead)',
  'Pad 1 (new age)', 'Pad 2 (warm)', 'Pad 3 (polysynth)', 'Pad 4 (choir)',
  'Pad 5 (bowed)', 'Pad 6 (metallic)', 'Pad 7 (halo)', 'Pad 8 (sweep)',
  'FX 1 (rain)', 'FX 2 (soundtrack)', 'FX 3 (crystal)', 'FX 4 (atmosphere)',
  'FX 5 (brightness)', 'FX 6 (goblins)', 'FX 7 (echoes)', 'FX 8 (sci-fi)',
  'Sitar', 'Banjo', 'Shamisen', 'Koto',
  'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock',
  'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet',
  'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot'
];

/**
 * Common instrument aliases
 */
const INSTRUMENT_ALIASES = {
  'piano': 0, 'grand': 0, 'acoustic_piano': 0,
  'epiano': 4, 'electric_piano': 4, 'rhodes': 4,
  'organ': 19, 'church_organ': 19,
  'guitar': 25, 'acoustic_guitar': 24, 'nylon_guitar': 24, 'steel_guitar': 25,
  'electric_guitar': 27, 'distortion': 30, 'overdrive': 29,
  'bass': 33, 'electric_bass': 33, 'acoustic_bass': 32, 'fretless': 35,
  'violin': 40, 'viola': 41, 'cello': 42, 'contrabass': 43,
  'strings': 48, 'orchestra': 48,
  'choir': 52, 'voice': 54,
  'trumpet': 56, 'trombone': 57, 'tuba': 58, 'french_horn': 60,
  'brass': 61,
  'sax': 65, 'alto_sax': 65, 'tenor_sax': 66, 'soprano_sax': 64,
  'oboe': 68, 'clarinet': 71, 'flute': 73, 'piccolo': 72,
  'synth': 80, 'lead': 80, 'pad': 88
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  tempDir: join(tmpdir(), 'midi-mp3-tool'),
  soundfontDir: null, // Set per-platform
  defaultSoundfont: 'MuseScore_General.sf2',
  soundfontUrl: 'https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf2',
  defaultBpm: 120,
  ppqn: 480,
  sampleRate: 44100,
  defaultInstrument: 0,
  defaultVelocity: 80,
  mp3Bitrate: '192k'
};

/**
 * Get platform-specific soundfont directory
 */
function getSoundfontDir() {
  const plat = platform();
  if (plat === 'darwin') {
    return join(homedir(), 'Library', 'Sounds', 'Banks');
  } else if (plat === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'midi-mp3', 'soundfonts');
  } else {
    // Check common Linux locations
    const locations = [
      '/usr/share/sounds/sf2',
      '/usr/share/soundfonts',
      join(homedir(), '.local', 'share', 'soundfonts')
    ];
    for (const loc of locations) {
      if (existsSync(loc)) return loc;
    }
    return join(homedir(), '.local', 'share', 'soundfonts');
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
 * Download a file with progress
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = createWriteStream(destPath);

    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
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
 * Run a command
 */
function runCommand(cmd, args, timeout = 300000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);

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
 * Parse note name to MIDI number
 * Format: C4, C#4, Db4, etc.
 */
function parseNote(noteStr) {
  const match = noteStr.match(/^([A-Ga-g])([#b]?)(\d)$/);
  if (!match) return null;

  const [, noteName, accidental, octave] = match;
  let midiNum = NOTE_MAP[noteName.toUpperCase()];

  if (accidental === '#') midiNum += 1;
  else if (accidental === 'b') midiNum -= 1;

  // MIDI octave: C4 = 60
  midiNum += (parseInt(octave) + 1) * 12;

  return Math.max(0, Math.min(127, midiNum));
}

/**
 * Parse duration string
 */
function parseDuration(durStr, ppqn = 480) {
  const str = durStr.toLowerCase();

  // Check for dotted note (e.g., "q." = 1.5 * quarter)
  const dotted = str.endsWith('.');
  const base = dotted ? str.slice(0, -1) : str;

  let ticks = DURATION_MAP[base];
  if (!ticks) {
    // Try parsing as number of beats
    const num = parseFloat(base);
    if (!isNaN(num)) {
      ticks = Math.round(num * ppqn);
    } else {
      ticks = ppqn; // Default to quarter note
    }
  }

  if (dotted) {
    ticks = Math.round(ticks * 1.5);
  }

  return ticks;
}

/**
 * MIDI MP3 Tool Class
 */
export class MidiMp3Tool {
  /**
   * @param {Object} sessionManager - Session manager instance
   * @param {Object} options - Configuration options
   * @param {Object} options.llmClient - LLM client for pre-processing input
   */
  constructor(sessionManager, options = {}) {
    this.sessionManager = sessionManager;
    this.llmClient = options.llmClient || null;
    this.config = {
      ...DEFAULT_CONFIG,
      soundfontDir: getSoundfontDir(),
      ...options
    };

    this.hasFluidsynth = commandExists('fluidsynth');
    this.hasFfmpeg = commandExists('ffmpeg');
    this.hasLame = commandExists('lame');
  }

  /**
   * Set the LLM client for pre-processing
   * @param {Object} llmClient - LLM client instance
   */
  setLLMClient(llmClient) {
    this.llmClient = llmClient;
  }

  /**
   * Extract MIDI notes from input using LLM
   * This pre-processes the input to ensure only valid note notation is passed to the parser.
   * @param {string} input - Raw input that may contain prose, explanations, or mixed content
   * @param {string} [sessionId] - Session ID for logging
   * @returns {Promise<string>} - Clean note notation string
   */
  async _extractNotesWithLLM(input, sessionId) {
    if (!this.llmClient) {
      // No LLM client available, return input as-is
      return input;
    }

    // Check if input already looks like clean note notation
    const trimmed = input.trim();

    // If it's JSON format, don't preprocess
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return input;
    }

    // Quick check: if input matches expected note pattern without prose, skip LLM
    // Pattern: only contains note-like tokens (C4:q, tempo:120, R:q, |, etc.) and whitespace
    const noteTokenPattern = /^(tempo:\d+\s*)?(\[?[A-Ga-gRr][#b]?\d?(\s+[A-Ga-g][#b]?\d)?\]?:[whqest]\.?(\:\d+)?\s*|\|\s*)+$/;
    if (noteTokenPattern.test(trimmed)) {
      return input;
    }

    const systemPrompt = `task:
  role: MIDI Note Generator
  objective: Convert input to MIDI note notation string
  output_constraint: OUTPUT ONLY THE NOTE STRING - NO OTHER TEXT

output_format:
  type: raw_string
  content: MIDI notes only
  forbidden:
    - explanations
    - markdown
    - code blocks
    - prose
    - comments
    - prefixes like "Output:" or "Notes:"

note_syntax:
  pattern: "NOTE:DURATION"
  note_format:
    letter: A-G (uppercase)
    accidental: "#" (sharp) or "b" (flat), optional
    octave: 0-8 (middle C = C4)
  duration_codes:
    w: whole note
    h: half note
    q: quarter note
    e: eighth note
    s: sixteenth note
    ".": dotted (append to duration)
  special:
    rest: "R:duration" (e.g., R:q)
    chord: "[C4 E4 G4]:duration"
    tempo: "tempo:BPM" at start
    bar: "|" as separator

examples:
  - input: "Happy Birthday melody"
    output: "C4:q C4:e D4:q C4:q F4:q E4:h | C4:q C4:e D4:q C4:q G4:q F4:h"
  - input: "C major scale"
    output: "C4:q D4:q E4:q F4:q G4:q A4:q B4:q C5:q"
  - input: "C major chord"
    output: "[C4 E4 G4]:h"
  - input: "tempo:90 C4:q E4:q G4:q"
    output: "tempo:90 C4:q E4:q G4:q"

fallback:
  condition: cannot determine notes
  output: "[C4 E4 G4]:h"

CRITICAL: Your entire response must be ONLY the note string. Do not write anything else.`;

    const userPrompt = `Convert to MIDI notes:\n${input}\n\nOUTPUT ONLY NOTES:`;

    try {
      const response = await this.llmClient.send({
        systemPrompt,
        userPrompt,
        sessionId,
        operation: 'midi_note_extraction',
        parameters: {
          temperature: 0.3,  // Lower temperature for more consistent output
          maxTokens: 1024    // Notes shouldn't need more than this
        }
      });

      const extracted = response.content.trim();

      // Remove any markdown code blocks if LLM accidentally added them
      const cleaned = extracted
        .replace(/^```[\w]*\n?/gm, '')
        .replace(/\n?```$/gm, '')
        .trim();

      return cleaned || input;
    } catch (err) {
      // If LLM fails, fall back to original input
      console.error('MIDI note extraction failed, using raw input:', err.message);
      return input;
    }
  }

  /**
   * Ensure directories exist
   */
  async _ensureDirs() {
    if (!existsSync(this.config.tempDir)) {
      await mkdir(this.config.tempDir, { recursive: true });
    }
    if (!existsSync(this.config.soundfontDir)) {
      await mkdir(this.config.soundfontDir, { recursive: true });
    }
  }

  /**
   * Get soundfont path, downloading if needed
   */
  async _getSoundfontPath(name = null) {
    await this._ensureDirs();

    const sfName = name || this.config.defaultSoundfont;

    // Check common locations
    const locations = [
      join(this.config.soundfontDir, sfName),
      `/usr/share/sounds/sf2/${sfName}`,
      `/usr/share/soundfonts/${sfName}`
    ];

    for (const loc of locations) {
      if (existsSync(loc)) return loc;
    }

    // Download default soundfont
    if (!name || name === this.config.defaultSoundfont) {
      const destPath = join(this.config.soundfontDir, this.config.defaultSoundfont);
      await downloadFile(this.config.soundfontUrl, destPath);
      return destPath;
    }

    throw new Error(`Soundfont not found: ${sfName}`);
  }

  /**
   * Resolve instrument name/number to MIDI program number
   */
  _resolveInstrument(instrument) {
    if (typeof instrument === 'number') {
      return Math.max(0, Math.min(127, instrument));
    }

    const name = instrument.toLowerCase().replace(/\s+/g, '_');

    // Check aliases
    if (INSTRUMENT_ALIASES[name] !== undefined) {
      return INSTRUMENT_ALIASES[name];
    }

    // Search GM names
    const index = GM_INSTRUMENTS.findIndex(
      n => n.toLowerCase().replace(/\s+/g, '_').includes(name)
    );
    if (index >= 0) return index;

    return this.config.defaultInstrument;
  }

  /**
   * Parse note sequence DSL
   * Format: "tempo:120 C4:q D4:q E4:h | F4:q G4:q A4:h"
   */
  _parseNoteDsl(input) {
    const lines = input.trim().split('\n');
    const notes = [];
    let tempo = this.config.defaultBpm;
    let currentTick = 0;

    for (const line of lines) {
      // Tokenize carefully: don't split inside brackets [...]
      // Match either bracketed chords like [C4 E4 G4]:h or regular tokens
      const tokens = line.trim().match(/\[[^\]]+\]:\w+\.?|\S+/g) || [];

      for (const token of tokens) {
        if (!token || token === '|') continue;

        // Tempo directive
        if (token.startsWith('tempo:')) {
          tempo = parseInt(token.split(':')[1]) || this.config.defaultBpm;
          continue;
        }

        // Rest
        if (token.startsWith('R:') || token.startsWith('r:')) {
          const duration = parseDuration(token.split(':')[1], this.config.ppqn);
          currentTick += duration;
          continue;
        }

        // Chord: [C4 E4 G4]:q
        if (token.startsWith('[')) {
          const match = token.match(/\[([^\]]+)\]:(\w+\.?)/);
          if (match) {
            const chordNotes = match[1].split(/\s+/);
            const duration = parseDuration(match[2], this.config.ppqn);

            for (const noteStr of chordNotes) {
              const pitch = parseNote(noteStr);
              if (pitch !== null) {
                notes.push({
                  pitch,
                  startTick: currentTick,
                  duration,
                  velocity: this.config.defaultVelocity
                });
              }
            }
            currentTick += duration;
          }
          continue;
        }

        // Single note: C4:q or C4:q:80 (with velocity)
        const parts = token.split(':');
        if (parts.length >= 2) {
          const pitch = parseNote(parts[0]);
          if (pitch !== null) {
            const duration = parseDuration(parts[1], this.config.ppqn);
            const velocity = parts[2] ? parseInt(parts[2]) : this.config.defaultVelocity;

            notes.push({
              pitch,
              startTick: currentTick,
              duration,
              velocity: Math.max(1, Math.min(127, velocity))
            });

            currentTick += duration;
          }
        }
      }
    }

    return { notes, tempo, totalTicks: currentTick };
  }

  /**
   * Parse JSON note format
   * Format: { tempo: 120, notes: [{pitch: "C4", duration: "q", velocity: 80}] }
   */
  _parseJsonFormat(input) {
    const data = typeof input === 'string' ? JSON.parse(input) : input;
    const tempo = data.tempo || this.config.defaultBpm;
    const notes = [];
    let currentTick = 0;

    for (const note of (data.notes || [])) {
      const pitch = typeof note.pitch === 'number' ? note.pitch : parseNote(note.pitch);
      const duration = parseDuration(note.duration || 'q', this.config.ppqn);
      const velocity = note.velocity || this.config.defaultVelocity;

      if (pitch !== null) {
        const startTick = note.start_tick !== undefined ? note.start_tick : currentTick;

        notes.push({
          pitch,
          startTick,
          duration,
          velocity: Math.max(1, Math.min(127, velocity))
        });

        if (note.start_tick === undefined) {
          currentTick += duration;
        }
      }
    }

    const totalTicks = Math.max(currentTick, ...notes.map(n => n.startTick + n.duration));
    return { notes, tempo, totalTicks };
  }

  /**
   * Auto-detect and parse input format
   */
  _parseInput(input) {
    const trimmed = input.trim();

    // JSON format - but be careful to distinguish from chord notation like [C4 E4 G4]:h
    // JSON arrays start with [ and contain quotes or numbers, not note names with colons
    if (trimmed.startsWith('{')) {
      return this._parseJsonFormat(trimmed);
    }

    // Check if it looks like a JSON array vs chord notation
    // Chord notation: [C4 E4 G4]:h - has ]: pattern after the bracket content
    // JSON array: [{"pitch": "C4"...}] or ["C4", "D4"] - proper JSON structure
    if (trimmed.startsWith('[')) {
      // If it contains ']:' right after notes, it's chord notation, not JSON
      if (/^\[[A-Ga-g][#b]?\d/.test(trimmed)) {
        // Starts with [<note> - this is chord DSL notation
        return this._parseNoteDsl(trimmed);
      }
      // Try JSON parse, fall back to DSL if it fails
      try {
        return this._parseJsonFormat(trimmed);
      } catch {
        return this._parseNoteDsl(trimmed);
      }
    }

    // ABC notation (basic detection)
    if (trimmed.includes('X:') || trimmed.includes('K:')) {
      // For now, we don't fully support ABC - return error
      throw new Error('ABC notation not yet supported. Use note DSL format: "C4:q D4:q E4:h"');
    }

    // Note sequence DSL
    return this._parseNoteDsl(trimmed);
  }

  /**
   * Generate Standard MIDI File bytes
   */
  _generateMidi(parsed, instrument = 0) {
    const { notes, tempo, totalTicks } = parsed;
    const ppqn = this.config.ppqn;

    // MIDI file structure
    const chunks = [];

    // Header chunk: MThd
    const headerChunk = Buffer.alloc(14);
    headerChunk.write('MThd', 0);
    headerChunk.writeUInt32BE(6, 4);        // Header length
    headerChunk.writeUInt16BE(0, 8);        // Format 0
    headerChunk.writeUInt16BE(1, 10);       // 1 track
    headerChunk.writeUInt16BE(ppqn, 12);    // Ticks per quarter note
    chunks.push(headerChunk);

    // Track chunk
    const trackEvents = [];

    // Tempo meta event (FF 51 03 tt tt tt)
    const microsecondsPerBeat = Math.round(60000000 / tempo);
    trackEvents.push({
      deltaTicks: 0,
      bytes: Buffer.from([
        0xFF, 0x51, 0x03,
        (microsecondsPerBeat >> 16) & 0xFF,
        (microsecondsPerBeat >> 8) & 0xFF,
        microsecondsPerBeat & 0xFF
      ])
    });

    // Program change
    trackEvents.push({
      deltaTicks: 0,
      bytes: Buffer.from([0xC0, instrument & 0x7F])
    });

    // Sort notes by start time
    const sortedNotes = [...notes].sort((a, b) => a.startTick - b.startTick);

    // Create note on/off events
    const noteEvents = [];
    for (const note of sortedNotes) {
      noteEvents.push({
        tick: note.startTick,
        type: 'on',
        pitch: note.pitch,
        velocity: note.velocity
      });
      noteEvents.push({
        tick: note.startTick + note.duration,
        type: 'off',
        pitch: note.pitch,
        velocity: 0
      });
    }

    // Sort all note events by tick
    noteEvents.sort((a, b) => a.tick - b.tick || (a.type === 'off' ? -1 : 1));

    let lastTick = 0;
    for (const event of noteEvents) {
      const deltaTicks = event.tick - lastTick;
      lastTick = event.tick;

      const status = event.type === 'on' ? 0x90 : 0x80;
      trackEvents.push({
        deltaTicks,
        bytes: Buffer.from([status, event.pitch & 0x7F, event.velocity & 0x7F])
      });
    }

    // End of track
    trackEvents.push({
      deltaTicks: 0,
      bytes: Buffer.from([0xFF, 0x2F, 0x00])
    });

    // Encode variable-length quantity
    function encodeVlq(value) {
      const bytes = [];
      bytes.push(value & 0x7F);
      value >>= 7;
      while (value > 0) {
        bytes.unshift((value & 0x7F) | 0x80);
        value >>= 7;
      }
      return Buffer.from(bytes);
    }

    // Build track data
    const trackData = [];
    for (const event of trackEvents) {
      trackData.push(encodeVlq(event.deltaTicks));
      trackData.push(event.bytes);
    }
    const trackBuffer = Buffer.concat(trackData);

    // Track chunk header: MTrk
    const trackHeader = Buffer.alloc(8);
    trackHeader.write('MTrk', 0);
    trackHeader.writeUInt32BE(trackBuffer.length, 4);
    chunks.push(trackHeader);
    chunks.push(trackBuffer);

    return Buffer.concat(chunks);
  }

  /**
   * Synthesize MIDI to WAV using FluidSynth
   */
  async _synthesize(midiPath, wavPath, soundfontPath) {
    // fluidsynth -ni -F output.wav -r 44100 soundfont.sf2 input.mid
    await runCommand('fluidsynth', [
      '-ni',
      '-F', wavPath,
      '-r', String(this.config.sampleRate),
      soundfontPath,
      midiPath
    ]);
  }

  /**
   * Encode WAV to MP3
   */
  async _encodeToMp3(wavPath, mp3Path) {
    if (this.hasLame) {
      await runCommand('lame', ['-b', this.config.mp3Bitrate.replace('k', ''), wavPath, mp3Path]);
    } else if (this.hasFfmpeg) {
      await runCommand('ffmpeg', ['-y', '-i', wavPath, '-b:a', this.config.mp3Bitrate, mp3Path]);
    } else {
      throw new Error('No MP3 encoder available. Install lame or ffmpeg.');
    }
  }

  /**
   * Handle synthesize action
   */
  async _handleSynthesize(args, session) {
    const {
      input_text,
      tempo,
      instrument = 0,
      soundfont,
      output_format = 'mp3',
      output_path,
      keep_midi = false,
      llm_preprocess = true  // Enable LLM preprocessing by default
    } = args;

    if (!input_text) throw new Error('input_text is required');

    if (!this.hasFluidsynth) {
      throw new Error('FluidSynth is not installed. Install with: brew install fluid-synth (macOS) or apt-get install fluidsynth (Linux)');
    }

    // Pre-process input with LLM to extract clean note notation
    const sessionId = session?.id || session?.sessionId;
    let cleanedInput = input_text;
    let wasPreprocessed = false;

    if (llm_preprocess && this.llmClient) {
      cleanedInput = await this._extractNotesWithLLM(input_text, sessionId);
      wasPreprocessed = cleanedInput !== input_text;
    }

    // Parse input
    const parsed = this._parseInput(cleanedInput);
    if (tempo) parsed.tempo = tempo;

    if (parsed.notes.length === 0) {
      throw new Error('No valid notes found in input');
    }

    // Resolve instrument
    const instrumentNum = this._resolveInstrument(instrument);

    // Generate MIDI
    const midiBuffer = this._generateMidi(parsed, instrumentNum);

    await this._ensureDirs();

    // Write MIDI file
    const midiPath = join(this.config.tempDir, `synth_${Date.now()}.mid`);
    await writeFile(midiPath, midiBuffer);

    // Get soundfont
    const sfPath = await this._getSoundfontPath(soundfont);

    // Synthesize to WAV
    const wavPath = join(this.config.tempDir, `synth_${Date.now()}.wav`);
    await this._synthesize(midiPath, wavPath, sfPath);

    // Determine final output
    const ext = output_format.toLowerCase() === 'wav' ? '.wav'
              : output_format.toLowerCase() === 'midi' || output_format.toLowerCase() === 'mid' ? '.mid'
              : '.mp3';

    let finalPath;
    if (output_path) {
      finalPath = session?.sandboxPath && !output_path.startsWith('/')
        ? resolve(join(session.sandboxPath, output_path))
        : resolve(output_path);
    } else {
      finalPath = join(this.config.tempDir, `output_${Date.now()}${ext}`);
    }

    // Ensure parent directory exists
    const parentDir = dirname(finalPath);
    if (!existsSync(parentDir)) {
      await mkdir(parentDir, { recursive: true });
    }

    // Convert/copy to final format
    if (ext === '.mid') {
      // Just copy MIDI
      await writeFile(finalPath, midiBuffer);
    } else if (ext === '.mp3') {
      await this._encodeToMp3(wavPath, finalPath);
    } else {
      // WAV - rename
      await writeFile(finalPath, await readFile(wavPath));
    }

    // Calculate duration
    const durationMs = Math.round((parsed.totalTicks / this.config.ppqn) * (60000 / parsed.tempo));

    // Cleanup
    await unlink(wavPath).catch(() => {});
    if (!keep_midi) {
      await unlink(midiPath).catch(() => {});
    }

    return {
      success: true,
      output_path: finalPath,
      midi_path: keep_midi ? midiPath : undefined,
      duration_ms: durationMs,
      notes_count: parsed.notes.length,
      tempo: parsed.tempo,
      instrument: GM_INSTRUMENTS[instrumentNum] || `Program ${instrumentNum}`,
      format: ext.slice(1),
      preprocessed: wasPreprocessed,
      notes_used: cleanedInput  // The actual note string that was synthesized
    };
  }

  /**
   * Handle validate_input action
   */
  async _handleValidateInput(args) {
    const { input_text } = args;
    if (!input_text) throw new Error('input_text is required');

    try {
      const parsed = this._parseInput(input_text);
      return {
        success: true,
        valid: true,
        notes_count: parsed.notes.length,
        tempo: parsed.tempo,
        total_ticks: parsed.totalTicks,
        duration_ms: Math.round((parsed.totalTicks / this.config.ppqn) * (60000 / parsed.tempo))
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
   * Handle list_instruments action
   */
  async _handleListInstruments() {
    const instruments = GM_INSTRUMENTS.map((name, index) => ({
      number: index,
      name,
      family: this._getInstrumentFamily(index)
    }));

    const families = [
      { range: '0-7', name: 'Piano' },
      { range: '8-15', name: 'Chromatic Percussion' },
      { range: '16-23', name: 'Organ' },
      { range: '24-31', name: 'Guitar' },
      { range: '32-39', name: 'Bass' },
      { range: '40-47', name: 'Strings' },
      { range: '48-55', name: 'Ensemble' },
      { range: '56-63', name: 'Brass' },
      { range: '64-71', name: 'Reed' },
      { range: '72-79', name: 'Pipe' },
      { range: '80-87', name: 'Synth Lead' },
      { range: '88-95', name: 'Synth Pad' },
      { range: '96-103', name: 'Synth Effects' },
      { range: '104-111', name: 'Ethnic' },
      { range: '112-119', name: 'Percussive' },
      { range: '120-127', name: 'Sound Effects' }
    ];

    return {
      success: true,
      instruments,
      families,
      total_count: 128
    };
  }

  /**
   * Get instrument family name
   */
  _getInstrumentFamily(num) {
    if (num < 8) return 'Piano';
    if (num < 16) return 'Chromatic Percussion';
    if (num < 24) return 'Organ';
    if (num < 32) return 'Guitar';
    if (num < 40) return 'Bass';
    if (num < 48) return 'Strings';
    if (num < 56) return 'Ensemble';
    if (num < 64) return 'Brass';
    if (num < 72) return 'Reed';
    if (num < 80) return 'Pipe';
    if (num < 88) return 'Synth Lead';
    if (num < 96) return 'Synth Pad';
    if (num < 104) return 'Synth Effects';
    if (num < 112) return 'Ethnic';
    if (num < 120) return 'Percussive';
    return 'Sound Effects';
  }

  /**
   * Handle list_soundfonts action
   */
  async _handleListSoundfonts() {
    await this._ensureDirs();

    const soundfonts = [];

    // Check user directory
    if (existsSync(this.config.soundfontDir)) {
      const files = await readFile(this.config.soundfontDir).catch(() => []);
      // This needs to be readdirSync or similar
    }

    // Check default location
    const defaultPath = join(this.config.soundfontDir, this.config.defaultSoundfont);
    if (existsSync(defaultPath)) {
      soundfonts.push({
        name: this.config.defaultSoundfont,
        path: defaultPath,
        is_default: true
      });
    }

    // Check system locations
    const systemPaths = ['/usr/share/sounds/sf2', '/usr/share/soundfonts'];
    for (const dir of systemPaths) {
      if (existsSync(dir)) {
        try {
          const { readdirSync } = await import('fs');
          const files = readdirSync(dir);
          for (const file of files) {
            if (file.endsWith('.sf2')) {
              soundfonts.push({
                name: file,
                path: join(dir, file),
                is_default: false
              });
            }
          }
        } catch {}
      }
    }

    return {
      success: true,
      soundfonts,
      default_soundfont: this.config.defaultSoundfont,
      soundfont_dir: this.config.soundfontDir
    };
  }

  /**
   * Handle download_soundfont action
   */
  async _handleDownloadSoundfont(args) {
    const { url, name } = args;

    await this._ensureDirs();

    const sfUrl = url || this.config.soundfontUrl;
    const sfName = name || this.config.defaultSoundfont;
    const destPath = join(this.config.soundfontDir, sfName);

    if (existsSync(destPath)) {
      return {
        success: true,
        message: 'Soundfont already exists',
        path: destPath
      };
    }

    await downloadFile(sfUrl, destPath);

    return {
      success: true,
      message: 'Soundfont downloaded successfully',
      path: destPath,
      name: sfName
    };
  }

  /**
   * Handle check_backends action
   */
  async _handleCheckBackends() {
    return {
      success: true,
      fluidsynth_available: this.hasFluidsynth,
      ffmpeg_available: this.hasFfmpeg,
      lame_available: this.hasLame,
      mp3_encoder: this.hasLame ? 'lame' : (this.hasFfmpeg ? 'ffmpeg' : null),
      ready: this.hasFluidsynth,
      soundfont_dir: this.config.soundfontDir,
      temp_dir: this.config.tempDir
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
      case 'validate_input': return this._handleValidateInput(args);
      case 'list_instruments': return this._handleListInstruments();
      case 'list_soundfonts': return this._handleListSoundfonts();
      case 'download_soundfont': return this._handleDownloadSoundfont(args);
      case 'check_backends': return this._handleCheckBackends();
      default:
        throw new Error(`Unknown action: ${action}. Valid actions: synthesize, validate_input, list_instruments, list_soundfonts, download_soundfont, check_backends`);
    }
  }

  /**
   * Register tools with the router
   * @param {ToolRouter} router - Tool router instance
   */
  registerTools(router) {
    const noteFormatDescription = `MIDI note notation string. IMPORTANT: Provide ONLY notes in this exact format, no prose or explanations.

FORMAT: Each note is "NOTE:DURATION" separated by spaces.
- NOTE: Letter (A-G) + optional accidental (# or b) + octave number (0-8). Middle C = C4.
- DURATION: w=whole, h=half, q=quarter, e=eighth, s=sixteenth. Add "." for dotted notes.
- RESTS: Use "R:duration" (e.g., R:q for quarter rest)
- CHORDS: Use brackets "[C4 E4 G4]:q" for simultaneous notes
- TEMPO: Optionally start with "tempo:120" to set BPM
- BARS: Use "|" as optional visual separator

EXAMPLES:
- Simple melody: "C4:q D4:q E4:q F4:q G4:h"
- With tempo: "tempo:90 C4:q E4:q G4:q C5:h"
- With rests: "C4:q R:q D4:q R:q E4:h"
- Chords: "[C4 E4 G4]:h [F4 A4 C5]:h [G4 B4 D5]:w"
- Dotted notes: "C4:q. D4:e E4:h."

OUTPUT ONLY THE NOTE STRING. Do not include any other text, explanation, or markdown.`;

    router.registerTool('midi_mp3', this.handle.bind(this), {
      name: 'midi_mp3',
      description: 'CREATE AUDIO FILES from note notation. This tool synthesizes notes into actual MP3/WAV audio files using FluidSynth. Use action="synthesize" to generate audio. Returns the path to the created audio file.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['synthesize', 'validate_input', 'list_instruments', 'list_soundfonts', 'download_soundfont', 'check_backends'],
            description: 'Action to perform'
          },
          input_text: {
            type: 'string',
            description: noteFormatDescription
          },
          tempo: {
            type: 'number',
            description: 'Tempo in BPM (default: 120). Can also be set in input_text with "tempo:120"'
          },
          instrument: {
            type: ['number', 'string'],
            description: 'GM instrument: number 0-127 or name like "piano", "violin", "guitar", "flute", "trumpet", "strings", "organ"'
          },
          soundfont: {
            type: 'string',
            description: 'SoundFont file name (default: MuseScore_General.sf2)'
          },
          output_format: {
            type: 'string',
            enum: ['mp3', 'wav', 'midi'],
            description: 'Output format (default: mp3)'
          },
          output_path: {
            type: 'string',
            description: 'Path for output file'
          },
          keep_midi: {
            type: 'boolean',
            description: 'Keep intermediate MIDI file (default: false)'
          },
          llm_preprocess: {
            type: 'boolean',
            description: 'Use LLM to extract clean note notation from input (default: true). Disable for raw note strings.'
          }
        },
        required: ['action']
      }
    });

    // Quick synthesize tool with strict format requirements
    router.registerTool('make_music', async (args, session) => {
      return this.handle({
        action: 'synthesize',
        input_text: args.notes,
        tempo: args.tempo,
        instrument: args.instrument,
        output_format: args.format,
        output_path: args.output_path,
        llm_preprocess: args.llm_preprocess
      }, session);
    }, {
      name: 'make_music',
      description: `CREATE AN AUDIO FILE (MP3/WAV) directly from a song description or note notation. CALL THIS TOOL DIRECTLY - do NOT write notes to a file first, do NOT use notepad. This tool handles everything: describe the music you want (e.g., "Happy Birthday melody") or provide notes, and it creates the audio file. Returns output_path to the playable audio file.`,
      inputSchema: {
        type: 'object',
        properties: {
          notes: {
            type: 'string',
            description: 'Music to create. Can be: (1) A description like "Happy Birthday melody" or "upbeat jazz riff", OR (2) Note notation like "C4:q D4:q E4:h". The tool will convert descriptions to notes automatically.'
          },
          tempo: { type: 'number', description: 'Tempo in BPM (default: 120)' },
          instrument: { type: ['number', 'string'], description: 'Instrument: "piano", "violin", "guitar", "flute", "trumpet", "strings", or number 0-127' },
          format: { type: 'string', enum: ['mp3', 'wav', 'midi'], description: 'Output format (default: mp3)' },
          output_path: { type: 'string', description: 'Output file path' },
          llm_preprocess: { type: 'boolean', description: 'Convert descriptions to notes (default: true)' }
        },
        required: ['notes']
      }
    });
  }
}

export default MidiMp3Tool;
