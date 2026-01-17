/**
 * @fileoverview Bundle Generator for creating session output bundles
 * @module bundle-generator
 */

import { mkdir, writeFile, readFile, readdir, copyFile, stat } from 'fs/promises';
import { join, basename } from 'path';
import { existsSync } from 'fs';
import { createHash } from 'crypto';
import { BundleError } from './errors.js';

/**
 * Bundle Generator class
 */
export class BundleGenerator {
  /**
   * @param {string} outputDir - Base output directory
   */
  constructor(outputDir) {
    this.outputDir = outputDir;
  }

  /**
   * Generate a session bundle
   * @param {Object} params
   * @param {string} params.sessionId
   * @param {Object} params.session - Full session data
   * @param {Object} params.queueState - Final queue state
   * @param {string} params.executionOutputDir - Path to execution outputs
   * @param {string} [params.sandboxDir] - Path to sandbox directory for this session
   * @returns {Promise<Object>}
   */
  async generateBundle({ sessionId, session, queueState, executionOutputDir, sandboxDir }) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const bundleId = `bundle-${sessionId.slice(0, 8)}-${timestamp}`;
    const bundleDir = join(this.outputDir, bundleId);

    try {
      // Create directory structure
      await mkdir(join(bundleDir, 'session', 'context'), { recursive: true });
      await mkdir(join(bundleDir, 'execution', 'tasks'), { recursive: true });
      await mkdir(join(bundleDir, 'execution', 'evaluations'), { recursive: true });
      await mkdir(join(bundleDir, 'artifacts'), { recursive: true });

      // Copy session data
      const sessionFiles = await this.copySessionData(bundleDir, session);

      // Copy execution outputs
      const executionFiles = await this.copyExecutionOutputs(bundleDir, executionOutputDir);

      // Copy artifacts from execution output
      const artifactFiles = await this.copyArtifacts(bundleDir, executionOutputDir);

      // Copy sandbox contents (generated project files, etc.)
      const sandboxFiles = await this.copySandbox(bundleDir, sandboxDir);

      // Generate manifest
      const manifest = await this.generateManifest({
        bundleId,
        sessionId,
        bundleDir,
        sessionFiles,
        executionFiles,
        artifactFiles,
        sandboxFiles,
        queueState
      });

      await writeFile(
        join(bundleDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf-8'
      );

      // Generate README
      await this.generateReadme(bundleDir, manifest, queueState);

      return {
        bundleId,
        path: bundleDir,
        manifest
      };

    } catch (err) {
      throw new BundleError(`Failed to generate bundle: ${err.message}`, {
        sessionId,
        bundleDir
      });
    }
  }

  /**
   * Copy session data to bundle
   * @private
   */
  async copySessionData(bundleDir, session) {
    const files = [];

    // Session data
    const sessionPath = join(bundleDir, 'session', 'session.json');
    await writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf-8');
    files.push({ path: 'session/session.json', type: 'session' });

    // Goals
    const goalsPath = join(bundleDir, 'session', 'goals.json');
    await writeFile(goalsPath, JSON.stringify(session.goals, null, 2), 'utf-8');
    files.push({ path: 'session/goals.json', type: 'goals' });

    // Task list
    if (session.taskList) {
      const tasksPath = join(bundleDir, 'session', 'tasks.json');
      await writeFile(tasksPath, JSON.stringify(session.taskList, null, 2), 'utf-8');
      files.push({ path: 'session/tasks.json', type: 'tasks' });
    }

    // Context files
    if (session.context?.files) {
      for (const file of session.context.files) {
        const contextPath = join(bundleDir, 'session', 'context', basename(file.path));
        await writeFile(contextPath, file.content, 'utf-8');
        files.push({ path: `session/context/${basename(file.path)}`, type: 'context' });
      }
    }

    return files;
  }

  /**
   * Copy execution outputs to bundle
   * @private
   */
  async copyExecutionOutputs(bundleDir, executionOutputDir) {
    const files = [];

    // Copy task outputs
    const tasksDir = join(executionOutputDir, 'tasks');
    if (existsSync(tasksDir)) {
      const taskFiles = await readdir(tasksDir);
      for (const file of taskFiles) {
        const srcPath = join(tasksDir, file);
        const destPath = join(bundleDir, 'execution', 'tasks', file);
        await copyFile(srcPath, destPath);
        files.push({ path: `execution/tasks/${file}`, type: 'task_output' });
      }
    }

    // Copy evaluations
    const evalsDir = join(executionOutputDir, 'evaluations');
    if (existsSync(evalsDir)) {
      const evalFiles = await readdir(evalsDir);
      for (const file of evalFiles) {
        const srcPath = join(evalsDir, file);
        const destPath = join(bundleDir, 'execution', 'evaluations', file);
        await copyFile(srcPath, destPath);
        files.push({ path: `execution/evaluations/${file}`, type: 'evaluation' });
      }
    }

    // Copy execution log
    const logPath = join(executionOutputDir, 'execution-log.json');
    if (existsSync(logPath)) {
      const destPath = join(bundleDir, 'execution', 'execution-log.json');
      await copyFile(logPath, destPath);
      files.push({ path: 'execution/execution-log.json', type: 'log' });
    }

    // Copy summary
    const summaryPath = join(executionOutputDir, 'summary.md');
    if (existsSync(summaryPath)) {
      const destPath = join(bundleDir, 'execution', 'summary.md');
      await copyFile(summaryPath, destPath);
      files.push({ path: 'execution/summary.md', type: 'summary' });
    }

    return files;
  }

  /**
   * Copy artifacts to bundle
   * @private
   */
  async copyArtifacts(bundleDir, executionOutputDir) {
    const files = [];
    const artifactsDir = join(executionOutputDir, 'artifacts');

    if (existsSync(artifactsDir)) {
      const artifactFiles = await readdir(artifactsDir);
      for (const file of artifactFiles) {
        const srcPath = join(artifactsDir, file);
        const destPath = join(bundleDir, 'artifacts', file);
        await copyFile(srcPath, destPath);
        
        const stats = await stat(srcPath);
        files.push({
          path: `artifacts/${file}`,
          type: 'artifact',
          size: stats.size
        });
      }
    }

    return files;
  }

  /**
   * Copy sandbox contents to bundle (recursively)
   * @private
   */
  async copySandbox(bundleDir, sandboxDir) {
    const files = [];

    if (!sandboxDir || !existsSync(sandboxDir)) {
      return files;
    }

    const sandboxDestDir = join(bundleDir, 'sandbox');
    await mkdir(sandboxDestDir, { recursive: true });

    // Recursively copy all files from sandbox
    const copyRecursive = async (srcDir, destDir, relativePath = '') => {
      const entries = await readdir(srcDir, { withFileTypes: true });

      for (const entry of entries) {
        const srcPath = join(srcDir, entry.name);
        const destPath = join(destDir, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          // Skip node_modules to save space
          if (entry.name === 'node_modules' || entry.name === '.git') {
            continue;
          }
          await mkdir(destPath, { recursive: true });
          await copyRecursive(srcPath, destPath, relPath);
        } else {
          await copyFile(srcPath, destPath);
          const stats = await stat(srcPath);
          files.push({
            path: `sandbox/${relPath}`,
            type: 'sandbox',
            size: stats.size
          });
        }
      }
    };

    await copyRecursive(sandboxDir, sandboxDestDir);
    return files;
  }

  /**
   * Generate bundle manifest
   * @private
   */
  async generateManifest({ bundleId, sessionId, bundleDir, sessionFiles, executionFiles, artifactFiles, sandboxFiles = [], queueState }) {
    const allFiles = [...sessionFiles, ...executionFiles, ...artifactFiles, ...sandboxFiles];
    let totalSize = 0;

    // Calculate sizes and checksums
    for (const file of allFiles) {
      const filepath = join(bundleDir, file.path);
      if (existsSync(filepath)) {
        const stats = await stat(filepath);
        file.size = stats.size;
        totalSize += stats.size;

        const content = await readFile(filepath);
        file.checksum = createHash('sha256').update(content).digest('hex');
      }
    }

    // Calculate bundle checksum
    const bundleContent = allFiles.map(f => f.checksum).join('');
    const bundleChecksum = createHash('sha256').update(bundleContent).digest('hex');

    return {
      bundleId,
      sessionId,
      createdAt: new Date().toISOString(),
      version: '1.0.0',
      contents: {
        sessionFiles: sessionFiles,
        executionFiles: executionFiles,
        artifactFiles: artifactFiles,
        sandboxFiles: sandboxFiles,
        totalFiles: allFiles.length,
        totalSize
      },
      metrics: queueState.metrics,
      checksum: bundleChecksum
    };
  }

  /**
   * Generate bundle README
   * @private
   */
  async generateReadme(bundleDir, manifest, queueState) {
    const content = `# Session Bundle

## Overview

- **Bundle ID:** ${manifest.bundleId}
- **Session ID:** ${manifest.sessionId}
- **Created:** ${manifest.createdAt}
- **Version:** ${manifest.version}

## Contents

This bundle contains the complete execution results for a goals session.

### Directory Structure

\`\`\`
${manifest.bundleId}/
├── README.md                 # This file
├── manifest.json             # Bundle metadata
│
├── session/                  # Original session data
│   ├── session.json          # Complete session
│   ├── goals.json            # Goals checklist
│   ├── tasks.json            # Generated tasks
│   └── context/              # Context files
│
├── execution/                # Execution outputs
│   ├── tasks/                # Task output files
│   ├── evaluations/          # Evaluation results
│   ├── execution-log.json    # Complete log
│   └── summary.md            # Execution summary
│
├── artifacts/                # Generated files
│
└── sandbox/                  # Project files (code, configs, etc.)
\`\`\`

## Execution Summary

| Metric | Value |
|--------|-------|
| Total Tasks | ${queueState.metrics.totalTasks} |
| Completed | ${queueState.metrics.completedCount} |
| Failed | ${queueState.metrics.failedCount} |
| Total Time | ${queueState.metrics.totalExecutionTimeMs}ms |
| Total Tokens | ${queueState.metrics.totalTokenUsage.totalTokens} |

## Files

Total: ${manifest.contents.totalFiles} files (${formatBytes(manifest.contents.totalSize)})

## Verification

Bundle checksum (SHA-256): \`${manifest.checksum}\`

---

*Generated by Action Plan Service v1.0.0*
`;

    await writeFile(join(bundleDir, 'README.md'), content, 'utf-8');
  }
}

/**
 * Format bytes to human readable
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default BundleGenerator;
