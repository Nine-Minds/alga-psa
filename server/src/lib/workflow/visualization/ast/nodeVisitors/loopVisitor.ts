import * as ts from 'typescript';
import { Loop, WorkflowComponent } from '../../types/astTypes';
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
 * Check if a node is a loop statement (for, while, do-while)
 *
 * @param node The TypeScript node to check
 * @returns True if the node is a loop statement
 */
export function isLoop(node: ts.Node): boolean {
  return ts.isForStatement(node) ||
         ts.isForInStatement(node) ||
         ts.isForOfStatement(node) ||
         ts.isWhileStatement(node) ||
         ts.isDoStatement(node);
}

/**
 * Extract loop information from a node
 *
 * @param node The TypeScript node (must be a loop statement)
 * @param analyzeNode Function to analyze child nodes
 * @returns Loop information
 */
export function extractLoopInfo(
  node: ts.Node,
  analyzeNode: (node: ts.Node) => WorkflowComponent[]
): Loop {
  if (!isLoop(node)) {
    throw new Error('Node is not a loop statement');
  }
  
  // Default values
  let loopType: 'for' | 'while' | 'doWhile' = 'for';
  let condition: string = '[Loop condition]';
  
  try {
    if (ts.isForStatement(node)) {
      loopType = 'for';
      condition = node.condition ? safeGetText(node.condition) : 'true';
    } else if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      loopType = 'for';
      condition = node.expression ? safeGetText(node.expression) : '[Expression]';
    } else if (ts.isWhileStatement(node)) {
      loopType = 'while';
      condition = node.expression ? safeGetText(node.expression) : '[Expression]';
    } else if (ts.isDoStatement(node)) {
      loopType = 'doWhile';
      condition = node.expression ? safeGetText(node.expression) : '[Expression]';
    } else {
      throw new Error('Unsupported loop type');
    }
  } catch (error) {
    // If there's an error getting the condition, use a default value
    console.error('Error extracting loop condition:', error);
  }
  
  // Analyze the loop body
  let body: WorkflowComponent[] = [];
  try {
    const statement = ts.isForStatement(node) || ts.isForInStatement(node) ||
                      ts.isForOfStatement(node) || ts.isWhileStatement(node)
                      ? node.statement
                      : (node as ts.DoStatement).statement;
    
    if (statement) {
      body = analyzeNode(statement);
    }
  } catch (error) {
    console.error('Error analyzing loop body:', error);
  }
  
  return {
    type: 'loop',
    loopType,
    condition,
    body,
    sourceLocation: getSourceLocation(node)
  };
}

/**
 * Find all loops in a function body
 *
 * @param node The function body node
 * @param analyzeNode Function to analyze child nodes
 * @returns Array of loops
 */
export function findLoops(
  node: ts.Node,
  analyzeNode: (node: ts.Node) => WorkflowComponent[]
): Loop[] {
  const loops: Loop[] = [];
  
  function visit(node: ts.Node) {
    if (isLoop(node)) {
      try {
        loops.push(extractLoopInfo(node, analyzeNode));
      } catch (error) {
        console.error('Error extracting loop info:', error);
      }
    } else {
      ts.forEachChild(node, visit);
    }
  }
  
  visit(node);
  return loops;
}