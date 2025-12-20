import type { TokenType } from "./types";

/**
 * Token interface representing a parsed Markdown element
 */

export interface Token {
  type: TokenType;
  value: string;
  depth?: number;
  metadata?: Record<string, any>;
}
