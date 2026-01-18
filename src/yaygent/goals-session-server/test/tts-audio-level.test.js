#!/usr/bin/env node
/**
 * Test that TTS tool produces audible audio (not silent)
 */

import { TtsTool } from '../lib/tts-tool.js';
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

  console.log('Testing TTS audio output level...\n');

  const tool = new TtsTool(null, {
    tempDir: join(tmpdir(), 'tts-test')
  });

  const outputPath = join(tmpdir(), `tts-test-${Date.now()}.wav`);

  try {
    console.log('Synthesizing test audio...');
    const result = await tool.handle({
      action: 'synthesize',
      text: 'Hello, this is a test of the text to speech system.',
      model: 'fast_en_vits',
      output_path: outputPath
    }, null);

    console.log('\nResult:');
    console.log(`  Output path: ${result.output_path}`);
    console.log(`  Duration: ${result.duration_ms}ms`);
    console.log(`  Max volume: ${result.max_volume_db}dB`);
    console.log(`  Is silent: ${result.is_silent}`);
    console.log(`  Model used: ${result.model_used}`);

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

    console.log('\n✓ PASS: TTS produced audible audio');
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
