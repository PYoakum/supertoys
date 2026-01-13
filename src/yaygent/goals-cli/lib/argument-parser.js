/**
 * @fileoverview Command-line argument parser for Goals CLI
 * @module argument-parser
 */

/**
 * @typedef {Object} ParsedArguments
 * @property {string|null} goals - Path to goals JSON file
 * @property {string|null} context - Path to context directory
 * @property {string} config - Path to configuration file
 * @property {string} output - Output destination ('stdout' or file path)
 * @property {string} format - Output format ('json', 'markdown', 'text')
 * @property {boolean} verbose - Enable verbose logging
 * @property {boolean} dryRun - Validate without executing
 * @property {boolean} help - Display help
 * @property {boolean} version - Display version
 * @property {string[]} errors - Parsing errors
 */

/**
 * Default argument values
 * @type {ParsedArguments}
 */
const DEFAULTS = {
  goals: null,
  context: null,
  config: './configuration.js',
  output: 'stdout',
  format: 'json',
  verbose: false,
  dryRun: false,
  help: false,
  version: false,
  errors: []
};

/**
 * Argument definitions with aliases and types
 */
const ARG_DEFINITIONS = {
  '--goals': { alias: '-g', type: 'string', key: 'goals' },
  '--context': { alias: '-c', type: 'string', key: 'context' },
  '--config': { alias: '-C', type: 'string', key: 'config' },
  '--output': { alias: '-o', type: 'string', key: 'output' },
  '--format': { alias: '-f', type: 'string', key: 'format' },
  '--verbose': { alias: '-v', type: 'boolean', key: 'verbose' },
  '--dry-run': { alias: '-d', type: 'boolean', key: 'dryRun' },
  '--help': { alias: '-h', type: 'boolean', key: 'help' },
  '--version': { alias: '-V', type: 'boolean', key: 'version' }
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
  const result = { ...DEFAULTS, errors: [] };
  
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    const def = ALIAS_MAP.get(arg);
    
    if (!def) {
      // Unknown argument
      if (arg.startsWith('-')) {
        result.errors.push(`Unknown argument: ${arg}`);
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
    }
  }
  
  // Validate format option
  const validFormats = ['json', 'markdown', 'text'];
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
  bun goals-cli.js --goals <path> --context <path> [options]

Required Arguments:
  --goals, -g <path>      Path to the goals JSON file
  --context, -c <path>    Path to the context directory

Optional Arguments:
  --config, -C <path>     Path to configuration file (default: ./configuration.js)
  --output, -o <path>     Output destination: file path or 'stdout' (default: stdout)
  --format, -f <format>   Output format: json, markdown, text (default: json)
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
  # Basic execution
  bun goals-cli.js --goals ./goals.json --context ./context/

  # With custom config and output
  bun goals-cli.js -g ./goals.json -c ./context/ -C ./my-config.js -o output.json

  # Dry run with verbose output
  bun goals-cli.js -g ./goals.json -c ./context/ --dry-run --verbose

  # Output as markdown
  bun goals-cli.js -g ./goals.json -c ./context/ -f markdown -o report.md
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
