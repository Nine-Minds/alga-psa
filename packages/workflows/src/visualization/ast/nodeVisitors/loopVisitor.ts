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
 * Also detects array iteration patterns like forEach, map, etc.
 *
 * @param node The TypeScript node to check
 * @returns True if the node is a loop statement
 */
export function isLoop(node: ts.Node): boolean {
  // Check for standard loop statements
  if (ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node)) {
    return true;
  }
  
  // Check for array iteration methods (forEach, map, filter, etc.)
  if (ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)) {
    const methodName = node.expression.name.text;
    
    // Common array iteration methods
    const iterationMethods = [
      'forEach', 'map', 'filter', 'reduce', 'reduceRight',
      'some', 'every', 'find', 'findIndex'
    ];
    
    if (iterationMethods.includes(methodName)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Determine if a call expression is an array iteration method
 *
 * @param node The call expression node
 * @returns The iteration method name or null if not an iteration method
 */
function getArrayIterationMethod(node: ts.CallExpression): string | null {
  if (ts.isPropertyAccessExpression(node.expression)) {
    const methodName = node.expression.name.text;
    
    // Common array iteration methods
    const iterationMethods = [
      'forEach', 'map', 'filter', 'reduce', 'reduceRight',
      'some', 'every', 'find', 'findIndex'
    ];
    
    if (iterationMethods.includes(methodName)) {
      return methodName;
    }
  }
  
  return null;
}

/**
 * Extract loop information from a node
 * Handles standard loops and array iteration patterns
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
  let body: WorkflowComponent[] = [];
  
  try {
    // Handle standard loop statements
    if (ts.isForStatement(node)) {
      loopType = 'for';
      
      // Extract initializer, condition, and incrementor for better description
      const initializer = node.initializer ? safeGetText(node.initializer) : '';
      const cond = node.condition ? safeGetText(node.condition) : 'true';
      const incrementor = node.incrementor ? safeGetText(node.incrementor) : '';
      
      // Create a more descriptive condition
      condition = `for (${initializer}; ${cond}; ${incrementor})`;
      
      // Analyze the loop body
      if (node.statement) {
        body = analyzeNode(node.statement);
      }
    } else if (ts.isForInStatement(node)) {
      loopType = 'for';
      
      // Extract the variable and expression
      const variable = node.initializer ? safeGetText(node.initializer) : 'var';
      const expr = node.expression ? safeGetText(node.expression) : 'object';
      
      condition = `for (${variable} in ${expr})`;
      
      // Analyze the loop body
      if (node.statement) {
        body = analyzeNode(node.statement);
      }
    } else if (ts.isForOfStatement(node)) {
      loopType = 'for';
      
      // Extract the variable and expression
      const variable = node.initializer ? safeGetText(node.initializer) : 'var';
      const expr = node.expression ? safeGetText(node.expression) : 'iterable';
      
      condition = `for (${variable} of ${expr})`;
      
      // Analyze the loop body
      if (node.statement) {
        body = analyzeNode(node.statement);
      }
    } else if (ts.isWhileStatement(node)) {
      loopType = 'while';
      condition = node.expression ? `while (${safeGetText(node.expression)})` : 'while (...)';
      
      // Analyze the loop body
      if (node.statement) {
        body = analyzeNode(node.statement);
      }
    } else if (ts.isDoStatement(node)) {
      loopType = 'doWhile';
      condition = node.expression ? `do {...} while (${safeGetText(node.expression)})` : 'do {...} while (...)';
      
      // Analyze the loop body
      if (node.statement) {
        body = analyzeNode(node.statement);
      }
    } else if (ts.isCallExpression(node)) {
      // Handle array iteration methods
      const iterationMethod = getArrayIterationMethod(node as ts.CallExpression);
      
      if (iterationMethod) {
        loopType = 'for'; // Treat as a for loop
        
        // Extract the array and callback
        const array = ts.isPropertyAccessExpression(node.expression) ?
                      safeGetText(node.expression.expression) : 'array';
        
        // Get the callback function
        let callbackText = '[callback]';
        if (node.arguments.length > 0) {
          callbackText = safeGetText(node.arguments[0]);
        }
        
        condition = `${array}.${iterationMethod}(${callbackText})`;
        
        // Analyze the callback function body if it's an arrow function or function expression
        const callback = node.arguments[0];
        if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && callback.body) {
          body = analyzeNode(callback.body);
        }
      } else {
        throw new Error('Not a recognized loop pattern');
      }
    } else {
      throw new Error('Unsupported loop type');
    }
  } catch (error) {
    // If there's an error getting the condition, use a default value
    console.error('Error extracting loop info:', error);
    condition = '[Loop condition]';
  }
  
  // Simplify the condition if it's too complex
  condition = simplifyLoopCondition(condition);
  
  return {
    type: 'loop',
    loopType,
    condition,
    body,
    sourceLocation: getSourceLocation(node)
  };
}

/**
 * Simplify complex loop conditions for better readability
 *
 * @param condition The loop condition as a string
 * @returns A simplified version of the condition
 */
function simplifyLoopCondition(condition: string): string {
  // If the condition is too long, try to extract the main parts
  if (condition.length > 60) {
    // For standard for loops, extract just the middle condition
    const forLoopMatch = condition.match(/for\s*\([^;]*;\s*([^;]*);/);
    if (forLoopMatch && forLoopMatch[1]) {
      return `for (... ${forLoopMatch[1]} ...)`;
    }
    
    // For array methods, simplify the callback
    const arrayMethodMatch = condition.match(/(\w+)\.(\w+)\(([^)]{0,30})/);
    if (arrayMethodMatch) {
      const array = arrayMethodMatch[1];
      const method = arrayMethodMatch[2];
      return `${array}.${method}(...)`;
    }
    
    // If all else fails, truncate
    return condition.substring(0, 57) + '...';
  }
  
  return condition;
}

/**
 * Find all loops in a function body
 * Handles nested loops and array iteration patterns
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
  const processedNodes = new Set<ts.Node>();
  
  function visit(node: ts.Node) {
    // Skip nodes we've already processed to avoid duplicates
    if (processedNodes.has(node)) {
      return;
    }
    
    if (isLoop(node)) {
      try {
        // Mark this node as processed
        processedNodes.add(node);
        
        // Extract loop info
        const loop = extractLoopInfo(node, analyzeNode);
        loops.push(loop);
        
        // Don't visit children of this loop since they're already analyzed
        // by the extractLoopInfo function
      } catch (error) {
        console.error('Error extracting loop info:', error);
        // Continue visiting children if there was an error
        ts.forEachChild(node, visit);
      }
    } else {
      // For non-loop nodes, visit children
      ts.forEachChild(node, visit);
    }
  }
  
  visit(node);
  
  // Look for workflow-specific loop patterns if we didn't find any standard loops
  if (loops.length === 0) {
    findWorkflowLoopPatterns(node, analyzeNode, loops);
  }
  
  return loops;
}

/**
 * Find workflow-specific loop patterns
 * Looks for patterns like polling, retries, and event waiting loops
 *
 * @param node The function body node
 * @param analyzeNode Function to analyze child nodes
 * @param loops Array to add found loops to
 */
function findWorkflowLoopPatterns(
  node: ts.Node,
  analyzeNode: (node: ts.Node) => WorkflowComponent[],
  loops: Loop[]
): void {
  // Look for common workflow loop patterns
  
  function visit(node: ts.Node) {
    // Check for polling patterns
    if (ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'setTimeout') {
      // This might be a polling pattern with setTimeout
      const loop: Loop = {
        type: 'loop',
        loopType: 'while',
        condition: 'Polling with setTimeout',
        body: [],
        sourceLocation: getSourceLocation(node)
      };
      
      // Try to analyze the callback function
      if (node.arguments.length > 0 &&
          (ts.isArrowFunction(node.arguments[0]) || ts.isFunctionExpression(node.arguments[0]))) {
        loop.body = analyzeNode(node.arguments[0].body);
      }
      
      loops.push(loop);
    }
    
    // Check for retry patterns
    if (ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === 'retry' ||
         node.expression.text.includes('retry') ||
         node.expression.text.includes('Retry'))) {
      // This might be a retry pattern
      const loop: Loop = {
        type: 'loop',
        loopType: 'while',
        condition: 'Retry logic',
        body: [],
        sourceLocation: getSourceLocation(node)
      };
      
      // Try to analyze the callback function
      if (node.arguments.length > 0 &&
          (ts.isArrowFunction(node.arguments[0]) || ts.isFunctionExpression(node.arguments[0]))) {
        loop.body = analyzeNode(node.arguments[0].body);
      }
      
      loops.push(loop);
    }
    
    // Check for event waiting patterns
    if (ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isPropertyAccessExpression(node.expression.expression) &&
        node.expression.expression.name.text === 'events' &&
        node.expression.name.text === 'waitFor') {
      // This is an event waiting pattern
      const loop: Loop = {
        type: 'loop',
        loopType: 'while',
        condition: 'Waiting for events',
        body: [],
        sourceLocation: getSourceLocation(node)
      };
      
      loops.push(loop);
    }
    
    ts.forEachChild(node, visit);
  }
  
  visit(node);
}