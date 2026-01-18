#!/usr/bin/env node
/**
 * Test that MIDI MP3 tool produces audible audio (not silent)
 */

import { MidiMp3Tool } from '../lib/midi-mp3-tool.js';
import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';

// Check prerequisites
function checkPrerequisites() {
  try {
    execSync('which fluidsynth', { stdio: 'ignore' });
  } catch {
    console.log('SKIP: FluidSynth not installed');
    process.exit(0);
  }

  try {
    execSync('which ffmpeg', { stdio: 'ignore' });
  } catch {
    console.log('SKIP: ffmpeg not installed');
    process.exit(0);
  }
}

async function runTest() {
  checkPrerequisites();

  // Test notes - a simple C major scale
  const testNotes = 'tempo:120 C4:q D4:q E4:q F4:q G4:q A4:q B4:q C5:h';

  console.log('Testing MIDI MP3 Tool audio output...\n');
  console.log('Input notes:', testNotes);
  console.log('');

  const tool = new MidiMp3Tool(null, {});

  // Check backends first
  const backends = await tool.handle({ action: 'check_backends' }, null);
  console.log('Backends:');
  console.log('  FluidSynth:', backends.fluidsynth_available ? 'yes' : 'no');
  console.log('  FFmpeg:', backends.ffmpeg_available ? 'yes' : 'no');
  console.log('  LAME:', backends.lame_available ? 'yes' : 'no');

  if (!backends.ready) {
    console.log('\n❌ FAIL: FluidSynth not available');
    process.exit(1);
  }

  // Synthesize
  console.log('\nSynthesizing...');
  const result = await tool.handle({
    action: 'synthesize',
    input_text: testNotes,
    instrument: 'piano',
    output_format: 'wav'
  }, null);

  console.log('\nResult:');
  console.log('  Output path:', result.output_path);
  console.log('  Duration:', result.duration_ms, 'ms');
  console.log('  Notes count:', result.notes_count);
  console.log('  Tempo:', result.tempo);
  console.log('  Instrument:', result.instrument);

  // Check audio level with ffmpeg
  if (!existsSync(result.output_path)) {
    console.log('\n❌ FAIL: Output file not created');
    process.exit(1);
  }

  try {
    const ffmpegResult = execSync(
      `ffmpeg -i "${result.output_path}" -af volumedetect -f null - 2>&1`,
      { encoding: 'utf-8' }
    );

    const maxMatch = ffmpegResult.match(/max_volume:\s*([-\d.]+)\s*dB/);
    const meanMatch = ffmpegResult.match(/mean_volume:\s*([-\d.]+)\s*dB/);

    const maxVolume = maxMatch ? parseFloat(maxMatch[1]) : null;
    const meanVolume = meanMatch ? parseFloat(meanMatch[1]) : null;

    console.log('\nAudio analysis:');
    console.log('  Max volume:', maxVolume, 'dB');
    console.log('  Mean volume:', meanVolume, 'dB');

    const isSilent = maxVolume === null || maxVolume < -60;

    if (isSilent) {
      console.log('\n❌ FAIL: Audio is silent or too quiet');
      process.exit(1);
    }

    console.log('\n✓ PASS: MIDI tool produced audible audio');

  } catch (err) {
    console.error('\n❌ FAIL: Could not analyze audio:', err.message);
    process.exit(1);
  } finally {
    // Cleanup
    if (existsSync(result.output_path)) {
      unlinkSync(result.output_path);
    }
  }
}

runTest();
