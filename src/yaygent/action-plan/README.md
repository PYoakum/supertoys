# Output Evaluation Service

Post-completion analysis service that evaluates session outputs, assigns quality scores, and surfaces actionable learnings.

## Overview

The Output Evaluation service:
1. **Loads** completed session bundles
2. **Analyzes** execution quality via LLM
3. **Scores** using a standardized rubric (0-100)
4. **Identifies** tool router enhancement opportunities
5. **Surfaces** unclear or ambiguous requirements
6. **Generates** actionable learnings and recommendations

## Quick Start

```bash
# Set API key
export LLM_API_KEY=your-api-key

# Evaluate a session bundle
node output-eval.js --bundle ./output/bundle-550e8400-...
```

## Command Line Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--bundle` | `-b` | Path to session bundle (required) |
| `--config` | `-c` | Configuration file path |
| `--output` | `-o` | Output directory (default: ./evaluation-output) |
| `--format` | `-f` | Output format: markdown, json, all (default: all) |
| `--verbose` | `-v` | Enable verbose logging |
| `--no-learnings` | | Skip learnings document |
| `--no-recommendations` | | Skip recommendation documents |
| `--help` | `-h` | Show help |
| `--version` | `-V` | Show version |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_API_KEY` | - | LLM API key (required) |
| `LLM_MODEL` | `claude-sonnet-4-20250514` | LLM model name |
| `LLM_ENDPOINT` | Anthropic API | LLM API endpoint |
| `OUTPUT_DIR` | `./evaluation-output` | Output directory |

## Scoring Rubric

| Dimension | Weight | Description |
|-----------|--------|-------------|
| Task Completion | 30% | Did tasks achieve their stated objectives? |
| Output Quality | 25% | Are outputs well-formed and useful? |
| Tool Utilization | 20% | Were tools used effectively and correctly? |
| Goal Alignment | 15% | Do results satisfy original goal criteria? |
| Process Efficiency | 10% | Was execution efficient and well-organized? |

## Grade Mapping

| Score Range | Grade | Description |
|-------------|-------|-------------|
| 90-100 | A | Excellent |
| 80-89 | B | Good |
| 70-79 | C | Satisfactory |
| 60-69 | D | Needs Improvement |
| 0-59 | F | Unsatisfactory |

## Output Structure

```
evaluation-output/
└── {sessionId}/
    ├── evaluation-report.md      # Human-readable report
    ├── evaluation-report.json    # Machine-readable data
    ├── learnings.md              # Learnings summary
    ├── recommendations/
    │   ├── tool-router.md        # Tool router recommendations
    │   ├── requirements.md       # Requirements analysis
    │   └── language.md           # Language recommendations
    └── metadata.json             # Evaluation metadata
```

## Analysis Categories

### Tool Router Recommendations
- Feature requests for existing tools
- Enhancements to improve tools
- Suggestions for new tools

### Requirements Analysis
- Unclear or ambiguous requirements
- Missing requirements
- Conflicting requirements

### Language Recommendations
- Prompt improvements
- Instruction clarifications
- Encoding recommendations

### Learnings Summary
- Key insights
- Success patterns to replicate
- Failure patterns to avoid
- Prioritized action items

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Configuration error |
| 4 | Bundle not found or invalid |
| 5 | Bundle integrity check failed |
| 6 | LLM evaluation failed |
| 7 | Report generation failed |

## License

MIT
