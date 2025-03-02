import * as ts from 'typescript';
import { ParallelExecution, WorkflowComponent } from '../../types/astTypes';
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
 * Check if a node is a parallel execution (Promise.all)
 *
 * @param node The TypeScript node to check
 * @returns True if the node is a parallel execution
 */
export function isParallelExecution(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  
  const expression = node.expression;
  
  // Check if it's a call to Promise.all
  if (ts.isPropertyAccessExpression(expression)) {
    const obj = expression.expression;
    const method = expression.name;
    
    if (ts.isIdentifier(obj) && obj.text === 'Promise' &&
        ts.isIdentifier(method) && method.text === 'all') {
      return true;
    }
  }
  
  return false;
}

/**
 * Extract parallel execution information from a node
 *
 * @param node The TypeScript node (must be a parallel execution)
 * @param analyzeNode Function to analyze child nodes
 * @returns Parallel execution information
 */
export function extractParallelInfo(
  node: ts.Node,
  analyzeNode: (node: ts.Node) => WorkflowComponent[]
): ParallelExecution {
  if (!ts.isCallExpression(node) || !isParallelExecution(node)) {
    throw new Error('Node is not a parallel execution');
  }
  
  const branches: WorkflowComponent[][] = [];
  
  try {
    // Get the array argument to Promise.all
    if (node.arguments.length > 0) {
      const arrayArg = node.arguments[0];
      
      if (ts.isArrayLiteralExpression(arrayArg)) {
        // For each element in the array, analyze it as a branch
        arrayArg.elements.forEach(element => {
          try {
            if (ts.isArrowFunction(element) || ts.isFunctionExpression(element)) {
              // If it's a function, analyze its body
              if (element.body) {
                const branch = analyzeNode(element.body);
                branches.push(branch);
              }
            } else {
              // For other expressions (like direct action calls), treat as a single-item branch
              const branch = analyzeNode(element);
              branches.push(branch);
            }
          } catch (error) {
            console.error('Error analyzing parallel branch:', error);
          }
        });
      }
    }
  } catch (error) {
    console.error('Error extracting parallel execution info:', error);
  }
  
  return {
    type: 'parallelExecution',
    branches,
    sourceLocation: getSourceLocation(node)
  };
}

/**
 * Find all parallel executions in a function body
 *
 * @param node The function body node
 * @param analyzeNode Function to analyze child nodes
 * @returns Array of parallel executions
 */
export function findParallelExecutions(
  node: ts.Node,
  analyzeNode: (node: ts.Node) => WorkflowComponent[]
): ParallelExecution[] {
  const parallels: ParallelExecution[] = [];
  
  function visit(node: ts.Node) {
    if (isParallelExecution(node)) {
      try {
        parallels.push(extractParallelInfo(node, analyzeNode));
      } catch (error) {
        console.error('Error extracting parallel execution info:', error);
      }
    } else {
      ts.forEachChild(node, visit);
    }
  }
  
  visit(node);
  return parallels;
}