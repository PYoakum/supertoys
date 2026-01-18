#!/usr/bin/env node
/**
 * Test that Voice Clone tool produces audible audio (not silent)
 */

import { VoiceCloneTool } from '../lib/voice-clone-tool.js';
import { execSync } from 'child_process';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Check prerequisites
function checkPrerequisites() {
  try {
    execSync('which tts', { stdio: 'ignore' });
  } catch {
    console.log('SKIP: Coqui TTS not installed');
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

  console.log('Testing Voice Clone audio output level...\n');
  console.log('NOTE: This test uses XTTS v2 which may take a while to download on first run.\n');

  const tool = new VoiceCloneTool(null, {
    tempDir: join(tmpdir(), 'voice-clone-test')
  });

  const outputPath = join(tmpdir(), `voice-clone-test-${Date.now()}.wav`);

  try {
    // Test synthesize with a preset speaker (doesn't require reference audio)
    console.log('Synthesizing test audio with preset speaker...');
    const result = await tool.handle({
      action: 'synthesize',
      text: 'Hello, this is a test of the voice cloning system.',
      preset_speaker: 'Craig Gutsy',
      language: 'en',
      output_path: outputPath
    }, null);

    console.log('\nResult:');
    console.log(`  Output path: ${result.output_path}`);
    console.log(`  Duration: ${result.duration_ms}ms`);
    console.log(`  Max volume: ${result.max_volume_db}dB`);
    console.log(`  Is silent: ${result.is_silent}`);
    console.log(`  Speaker: ${result.speaker}`);

    if (result.warning) {
      console.log(`  Warning: ${result.warning}`);
    }

    // Verify audio is not silent (above -80dB)
    if (result.is_silent) {
      console.log('\n❌ FAIL: Audio output is silent!');
      process.exit(1);
    }

    // Verify audio has reasonable volume (above -60dB for speech)
    if (result.max_volume_db < -60) {
      console.log(`\n⚠️  WARNING: Audio volume is very low (${result.max_volume_db}dB)`);
    }

    // Verify file exists and has content
    if (!existsSync(result.output_path)) {
      console.log('\n❌ FAIL: Output file does not exist!');
      process.exit(1);
    }

    console.log('\n✓ PASS: Voice Clone produced audible audio');
    process.exit(0);

  } catch (err) {
    console.error('\n❌ FAIL:', err.message);
    process.exit(1);
  } finally {
    // Cleanup
    if (existsSync(outputPath)) {
      unlinkSync(outputPath);
    }
  }
}

runTest();
