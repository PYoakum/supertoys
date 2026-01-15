/**
 * @fileoverview Command-line argument parser for Goals CLI
 * @module argument-parser
 */

/**
 * @typedef {Object} ParsedArguments
 * @property {string|null} command - Subcommand (null for legacy mode)
 * @property {string|null} goals - Path to goals JSON file
 * @property {string|null} context - Path to context directory
 * @property {string} config - Path to configuration file
 * @property {string} output - Output destination ('stdout' or file path)
 * @property {string} format - Output format ('toon', 'json', 'markdown', 'text')
 * @property {boolean} verbose - Enable verbose logging
 * @property {boolean} dryRun - Validate without executing
 * @property {boolean} help - Display help
 * @property {boolean} version - Display version
 * @property {string[]} positional - Positional arguments after command
 * @property {string|null} file - File path for import command
 * @property {string|null} url - URL for import command
 * @property {boolean} replace - Replace mode for import
 * @property {string[]} include - Include globs for list-paths
 * @property {string[]} exclude - Exclude globs for list-paths
 * @property {string[]} errors - Parsing errors
 */

/**
 * Valid subcommands
 */
const SUBCOMMANDS = ['import', 'get', 'set', 'delete', 'list-paths', 'ai-edit', 'browse', 'run', 'validate'];

/**
 * Default argument values
 * @type {ParsedArguments}
 */
const DEFAULTS = {
  command: null,
  goals: null,
  context: null,
  config: './configuration.js',
  output: 'stdout',
  format: 'toon',
  verbose: false,
  dryRun: false,
  help: false,
  version: false,
  positional: [],
  file: null,
  url: null,
  replace: false,
  include: [],
  exclude: [],
  // AI edit arguments
  llmUrl: null,
  llmProtocol: 'json',
  llmModel: null,
  llmBatchSize: 10,
  llmTimeoutMs: 120000,
  llmRetries: 3,
  llmBackoffMs: 500,
  llmBackoffMaxMs: 8000,
  aiEditIncludeContext: false,
  preview: false,
  tui: false,
  errors: []
};

/**
 * Argument definitions with aliases and types
 */
const ARG_DEFINITIONS = {
  // Legacy/global arguments
  '--goals': { alias: '-g', type: 'string', key: 'goals' },
  '--context': { alias: '-c', type: 'string', key: 'context' },
  '--config': { alias: '-C', type: 'string', key: 'config' },
  '--output': { alias: '-o', type: 'string', key: 'output' },
  '--format': { alias: '-f', type: 'string', key: 'format' },
  '--verbose': { alias: '-v', type: 'boolean', key: 'verbose' },
  '--dry-run': { alias: '-d', type: 'boolean', key: 'dryRun' },
  '--help': { alias: '-h', type: 'boolean', key: 'help' },
  '--version': { alias: '-V', type: 'boolean', key: 'version' },
  // Import command arguments
  '--file': { alias: null, type: 'string', key: 'file' },
  '--url': { alias: null, type: 'string', key: 'url' },
  '--replace': { alias: null, type: 'boolean', key: 'replace' },
  // List-paths / ai-edit command arguments
  '--include': { alias: null, type: 'array', key: 'include' },
  '--exclude': { alias: null, type: 'array', key: 'exclude' },
  // AI edit command arguments
  '--llm-url': { alias: null, type: 'string', key: 'llmUrl' },
  '--llm-protocol': { alias: null, type: 'string', key: 'llmProtocol' },
  '--llm-model': { alias: null, type: 'string', key: 'llmModel' },
  '--llm-batch-size': { alias: null, type: 'number', key: 'llmBatchSize' },
  '--llm-timeout-ms': { alias: null, type: 'number', key: 'llmTimeoutMs' },
  '--llm-retries': { alias: null, type: 'number', key: 'llmRetries' },
  '--llm-backoff-ms': { alias: null, type: 'number', key: 'llmBackoffMs' },
  '--llm-backoff-max-ms': { alias: null, type: 'number', key: 'llmBackoffMaxMs' },
  '--ai-edit-include-context': { alias: null, type: 'boolean', key: 'aiEditIncludeContext' },
  '--preview': { alias: null, type: 'boolean', key: 'preview' },
  // TUI mode
  '--tui': { alias: '-t', type: 'boolean', key: 'tui' }
};

/**
 * Build reverse lookup map for aliases
 * @returns {Map<string, Object>}
 */
function buildAliasMap() {
  const map = new Map();
  for (const [arg, def] of Object.entries(ARG_DEFINITIONS)) {
    map.set(arg, { ...def, original: arg });
    if (def.alias) {
      map.set(def.alias, { ...def, original: arg });
    }
  }
  return map;
}

const ALIAS_MAP = buildAliasMap();

/**
 * Parse command-line arguments
 * @param {string[]} argv - Command-line arguments (typically process.argv.slice(2))
 * @returns {ParsedArguments}
 */
export function parseArguments(argv) {
  const result = { ...DEFAULTS, errors: [], positional: [], include: [], exclude: [] };

  // Check for subcommand as first argument
  if (argv.length > 0 && !argv[0].startsWith('-')) {
    const potentialCmd = argv[0].toLowerCase();
    if (SUBCOMMANDS.includes(potentialCmd)) {
      result.command = potentialCmd;
      argv = argv.slice(1);
    }
  }

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    const def = ALIAS_MAP.get(arg);

    if (!def) {
      // Unknown argument or positional
      if (arg.startsWith('-')) {
        result.errors.push(`Unknown argument: ${arg}`);
      } else {
        // Collect positional arguments
        result.positional.push(arg);
      }
      i++;
      continue;
    }

    if (def.type === 'boolean') {
      result[def.key] = true;
      i++;
    } else if (def.type === 'string') {
      const nextArg = argv[i + 1];
      if (!nextArg || nextArg.startsWith('-')) {
        result.errors.push(`Argument ${arg} requires a value`);
        i++;
      } else {
        result[def.key] = nextArg;
        i += 2;
      }
    } else if (def.type === 'array') {
      const nextArg = argv[i + 1];
      if (!nextArg || nextArg.startsWith('-')) {
        result.errors.push(`Argument ${arg} requires a value`);
        i++;
      } else {
        result[def.key].push(nextArg);
        i += 2;
      }
    } else if (def.type === 'number') {
      const nextArg = argv[i + 1];
      if (!nextArg || nextArg.startsWith('-')) {
        result.errors.push(`Argument ${arg} requires a numeric value`);
        i++;
      } else {
        const num = Number(nextArg);
        if (isNaN(num)) {
          result.errors.push(`Argument ${arg} requires a numeric value, got: ${nextArg}`);
        } else {
          result[def.key] = num;
        }
        i += 2;
      }
    }
  }

  // Validate format option
  const validFormats = ['toon', 'json', 'markdown', 'text'];
  if (result.format && !validFormats.includes(result.format)) {
    result.errors.push(`Invalid format: ${result.format}. Must be one of: ${validFormats.join(', ')}`);
  }

  return result;
}

/**
 * Validate that required arguments are present
 * @param {ParsedArguments} args - Parsed arguments
 * @returns {string[]} Array of validation errors
 */
export function validateRequiredArgs(args) {
  const errors = [];

  // Skip validation if help or version is requested
  if (args.help || args.version) {
    return errors;
  }

  // Command-specific validation
  if (args.command) {
    switch (args.command) {
      case 'import':
        if (!args.file && !args.url) {
          errors.push('import requires --file <path> or --url <url>');
        }
        if (args.file && args.url) {
          errors.push('import: specify either --file or --url, not both');
        }
        break;

      case 'get':
        if (args.positional.length < 1) {
          errors.push('get requires a path argument: get <path>');
        }
        break;

      case 'set':
        if (args.positional.length < 2) {
          errors.push('set requires path and value: set <path> <value>');
        }
        break;

      case 'delete':
        if (args.positional.length < 1) {
          errors.push('delete requires a path argument: delete <path>');
        }
        break;

      case 'list-paths':
        // No required args for list-paths
        break;

      case 'ai-edit':
        if (!args.llmUrl) {
          errors.push('ai-edit requires --llm-url <url>');
        }
        break;

      case 'run':
      case 'validate':
        // These use the legacy validation
        if (!args.goals) {
          errors.push('Missing required argument: --goals (-g)');
        }
        if (!args.context) {
          errors.push('Missing required argument: --context (-c)');
        }
        break;
    }
    return errors;
  }

  // Legacy mode validation
  if (!args.goals) {
    errors.push('Missing required argument: --goals (-g)');
  }

  if (!args.context) {
    errors.push('Missing required argument: --context (-c)');
  }

  return errors;
}

/**
 * Get the version string
 * @returns {string}
 */
export function getVersion() {
  return '1.0.0';
}

/**
 * Get the help text
 * @returns {string}
 */
export function getHelpText() {
  return `
Goals CLI - Goal-driven AI workflow orchestration

Usage:
  bun goals-cli.js <command> [options]
  bun goals-cli.js --goals <path> --context <path> [options]  (legacy mode)

Commands:
  import    Import goals from external files (JSON, JS, Python) or URLs
  get       Get a value by path expression
  set       Set a value by path expression
  delete    Delete a value by path expression
  list-paths List all editable paths in the goals file
  ai-edit   Use LLM to enhance goal objectives, criteria, and constraints
  run       Execute goals (same as legacy mode)
  validate  Validate goals without executing

Import Command:
  bun goals-cli.js import --file <path>     Import from local file (.json, .js, .py)
  bun goals-cli.js import --url <url>       Import from remote URL
  bun goals-cli.js import --file <path> --replace  Replace existing goals

Path Commands:
  bun goals-cli.js get <path>               Get value at path (e.g., "goals[0].objective")
  bun goals-cli.js set <path> <value>       Set value at path
  bun goals-cli.js delete <path>            Delete value at path
  bun goals-cli.js list-paths               List all editable string paths
  bun goals-cli.js list-paths --include "goals[*].objective"  Filter by pattern
  bun goals-cli.js list-paths --exclude "goals[*].context.*"  Exclude patterns

AI Edit Command:
  bun goals-cli.js ai-edit --llm-url <url>  Use LLM to enhance goal text

  AI Edit Options:
    --llm-url <url>           LLM API endpoint (required)
    --llm-protocol <proto>    Response protocol: json, ndjson, sse (default: json)
    --llm-model <name>        Model name to use
    --llm-batch-size <n>      Items per batch (default: 10)
    --llm-timeout-ms <ms>     Request timeout (default: 120000)
    --llm-retries <n>         Max retry attempts (default: 3)
    --include <glob>          Only edit matching paths (can repeat)
    --exclude <glob>          Skip matching paths (can repeat)
    --ai-edit-include-context Include context fields in editing
    --preview                 Show proposed edits without applying

Legacy Arguments:
  --goals, -g <path>      Path to the goals JSON file
  --context, -c <path>    Path to the context directory
  --config, -C <path>     Path to configuration file (default: ./configuration.js)
  --output, -o <path>     Output destination: file path or 'stdout' (default: stdout)
  --format, -f <format>   Output format: toon, json, markdown, text (default: toon)
  --verbose, -v           Enable verbose logging to stderr
  --dry-run, -d           Validate inputs without executing
  --help, -h              Display this help message
  --version, -V           Display version information

Environment Variables:
  GOALS_API_KEY           API key for the prompt endpoint
  GOALS_API_URL           Override endpoint URL from config
  GOALS_CONFIG            Path to configuration file
  GOALS_DEBUG             Enable debug output (1 or true)

Examples:
  # Import goals from a JavaScript config file
  bun goals-cli.js import --file ./config/goals.js

  # Import from URL
  bun goals-cli.js import --url https://example.com/goals.json

  # Get a specific goal's objective
  bun goals-cli.js get "goals[0].objective"

  # Update a goal's objective
  bun goals-cli.js set "goals[0].objective" "Updated objective text"

  # List all editable paths
  bun goals-cli.js list-paths

  # List only objective paths
  bun goals-cli.js list-paths --include "goals[*].objective"

  # AI enhance all objectives
  bun goals-cli.js ai-edit --llm-url https://api.anthropic.com/v1/messages \\
    --include "goals[*].objective" --preview

  # Legacy: Basic execution
  bun goals-cli.js --goals ./goals.json --context ./context/

  # Legacy: Dry run with verbose output
  bun goals-cli.js -g ./goals.json -c ./context/ --dry-run --verbose
`.trim();
}

/**
 * Format validation errors for display
 * @param {string[]} errors - Array of error messages
 * @returns {string}
 */
export function formatErrors(errors) {
  if (errors.length === 0) return '';
  
  const lines = ['Error(s):'];
  for (const error of errors) {
    lines.push(`  • ${error}`);
  }
  lines.push('');
  lines.push('Use --help for usage information.');
  return lines.join('\n');
}
