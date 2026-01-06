/**
 * Type definitions for the task scheduler
 */

/**
 * Configuration for a single scheduled task
 */
export interface TaskConfig {
  /** Unique identifier for the task */
  name: string;
  
  /** Cron expression defining when the task should run */
  schedule: string;
  
  /** Path to the module containing the task function */
  module: string;
  
  /** Name of the exported function to execute */
  function: string;
  
  /** Optional arguments to pass to the function */
  args?: any[];
  
  /** Whether the task is enabled (default: true) */
  enabled?: boolean;
}

/**
 * Complete scheduler configuration
 */
export interface Config {
  /** Array of task configurations */
  tasks: TaskConfig[];
}

/**
 * Base interface for task functions
 */
export type TaskFunction = (...args: any[]) => void | Promise<void> | any | Promise<any>;

/**
 * Module containing task functions
 */
export interface TaskModule {
  [key: string]: TaskFunction;
}
