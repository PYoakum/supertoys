import { spawn } from "bun";
import type { Subprocess } from "bun";

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  command: string;
}

export interface ExecutionOptions {
  timeout?: number;
  includeStderr?: boolean;
}

export async function executeCommand(
  command: string,
  args: string[],
  options: ExecutionOptions = {}
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const { timeout, includeStderr = false } = options;

  try {
    // Check if command is a script file that needs to be made executable
    const isFile = await Bun.file(command).exists();
    
    let proc: Subprocess;
    
    if (isFile) {
      // For script files, execute with appropriate interpreter or make executable
      proc = spawn([command, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "inherit",
      });
    } else {
      // For regular commands, execute in a shell
      const fullCommand = [command, ...args].join(" ");
      proc = spawn(["sh", "-c", fullCommand], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "inherit",
      });
    }

    let timeoutId: Timer | null = null;
    let timedOut = false;

    // Set up timeout if specified
    if (timeout) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeout);
    }

    // Wait for process to complete
    const exitCode = await proc.exited;

    // Clear timeout if it was set
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (timedOut) {
      throw new Error(`Command timed out after ${timeout}ms`);
    }

    // Read output
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    const executionTime = Date.now() - startTime;

    // Log stderr if present (but don't fail)
    if (stderr && !includeStderr) {
      console.warn("\nStderr output:");
      console.warn(stderr);
    }

    return {
      stdout,
      stderr,
      exitCode,
      executionTime,
      command: `${command} ${args.join(" ")}`,
    };
  } catch (error) {
    const executionTime = Date.now() - startTime;
    throw new Error(
      `Failed to execute command: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}