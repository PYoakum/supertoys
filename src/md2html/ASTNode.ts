/**
 * AST Node interface for building the abstract syntax tree
 */

export interface ASTNode {
  type: string;
  content?: string;
  children?: ASTNode[];
  attributes?: Record<string, string>;
  metadata?: Record<string, any>;
}
