import * as ts from 'typescript';
import { Conditional, WorkflowComponent } from '../../types/astTypes';
import { getSourceLocation } from '../astParser';

/**
 * Safely get text from a TypeScript node
 *
 * @param node The TypeScript node
 * @returns The text of the node or a placeholder if it can't be retrieved
 */
function safeGetText(node: ts.Node): string {
  try {
    return node.getText();
  } catch (error) {
    return '[Expression]';
  }
}

/**
 * Check if a node is a conditional statement (if/else)
 *
 * @param node The TypeScript node to check
 * @returns True if the node is a conditional statement
 */
export function isConditional(node: ts.Node): boolean {
  return ts.isIfStatement(node);
}

/**
 * Extract conditional information from a node
 *
 * @param node The TypeScript node (must be a conditional statement)
 * @param analyzeNode Function to analyze child nodes
 * @returns Conditional information
 */
export function extractConditionalInfo(
  node: ts.Node,
  analyzeNode: (node: ts.Node) => WorkflowComponent[]
): Conditional {
  if (!ts.isIfStatement(node)) {
    throw new Error('Node is not a conditional statement');
  }
  
  // Get the condition expression
  let condition = '[Condition]';
  if (node.expression) {
    condition = safeGetText(node.expression);
  }
  
  // Analyze the then branch
  const thenBranch = analyzeNode(node.thenStatement);
  
  // Analyze the else branch if it exists
  let elseBranch: WorkflowComponent[] | undefined;
  if (node.elseStatement) {
    elseBranch = analyzeNode(node.elseStatement);
  }
  
  return {
    type: 'conditional',
    condition,
    thenBranch,
    elseBranch,
    sourceLocation: getSourceLocation(node)
  };
}

/**
 * Find all conditionals in a function body
 *
 * @param node The function body node
 * @param analyzeNode Function to analyze child nodes
 * @returns Array of conditionals
 */
export function findConditionals(
  node: ts.Node,
  analyzeNode: (node: ts.Node) => WorkflowComponent[]
): Conditional[] {
  const conditionals: Conditional[] = [];
  
  function visit(node: ts.Node) {
    if (isConditional(node)) {
      try {
        conditionals.push(extractConditionalInfo(node, analyzeNode));
      } catch (error) {
        console.error('Error extracting conditional info:', error);
      }
    } else {
      ts.forEachChild(node, visit);
    }
  }
  
  visit(node);
  return conditionals;
}