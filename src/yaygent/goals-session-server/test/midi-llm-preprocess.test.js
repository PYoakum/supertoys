#!/usr/bin/env node
/**
 * Test MIDI MP3 tool with LLM preprocessing
 * Tests that prose/mixed input gets converted to clean note notation
 */

import { MidiMp3Tool } from '../lib/midi-mp3-tool.js';
import { LLMClient } from '../lib/llm-client.js';
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

  // Check for API key
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.LLM_API_KEY;
  if (!apiKey) {
    console.log('SKIP: No API key configured (set ANTHROPIC_API_KEY or LLM_API_KEY)');
    process.exit(0);
  }
  
  return apiKey;
}

async function runTest() {
  const apiKey = checkPrerequisites();

  // Create LLM client
  const llmClient = new LLMClient({
    provider: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    apiKey: apiKey,
    model: 'claude-sonnet-4-20250514',
    parameters: { temperature: 0.3, maxTokens: 1024 }
  });

  // Test prompts - prose that should be converted to notes
  const testCases = [
    {
      name: 'Prose description',
      input: 'Play a simple C major chord followed by a G major chord, each held for a half note',
      expectNotes: true
    },
    {
      name: 'Mixed content with notes',
      input: 'Here are the notes for a melody: C4:q D4:q E4:q F4:q and then finish with G4:h',
      expectNotes: true
    },
    {
      name: 'Already clean notes',
      input: 'tempo:100 C4:q E4:q G4:q C5:h',
      expectNotes: true,
      shouldSkipPreprocess: true
    }
  ];

  console.log('Testing MIDI MP3 Tool with LLM preprocessing...\n');

  const tool = new MidiMp3Tool(null, { llmClient });

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    console.log(`--- Test ${i + 1}: ${tc.name} ---`);
    console.log(`Input: "${tc.input}"`);
    console.log('');

    try {
      const result = await tool.handle({
        action: 'synthesize',
        input_text: tc.input,
        instrument: 'piano',
        output_format: 'wav'
      }, null);

      console.log('Result:');
      console.log('  Preprocessed:', result.preprocessed);
      console.log('  Notes used:', result.notes_used);
      console.log('  Notes count:', result.notes_count);
      console.log('  Duration:', result.duration_ms, 'ms');
      console.log('  Output:', result.output_path);

      // Check audio level
      if (existsSync(result.output_path)) {
        const ffmpegResult = execSync(
          `ffmpeg -i "${result.output_path}" -af volumedetect -f null - 2>&1`,
          { encoding: 'utf-8' }
        );
        const maxMatch = ffmpegResult.match(/max_volume:\s*([-\d.]+)\s*dB/);
        const maxVolume = maxMatch ? parseFloat(maxMatch[1]) : null;
        
        console.log('  Max volume:', maxVolume, 'dB');
        
        if (maxVolume === null || maxVolume < -60) {
          console.log('\n❌ FAIL: Audio is silent\n');
        } else {
          console.log('\n✓ PASS: Audio is audible\n');
        }
        
        // Cleanup
        unlinkSync(result.output_path);
      }
    } catch (err) {
      console.log('❌ ERROR:', err.message, '\n');
    }
  }
  
  console.log('=== All tests complete ===');
}

runTest();
