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
 * Check if a node is a parallel execution
 * Detects Promise.all, Promise.allSettled, Promise.race, and custom parallel patterns
 *
 * @param node The TypeScript node to check
 * @returns True if the node is a parallel execution
 */
export function isParallelExecution(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  
  const expression = node.expression;
  
  // Check for Promise static methods
  if (ts.isPropertyAccessExpression(expression)) {
    const obj = expression.expression;
    const method = expression.name;
    
    // Check for Promise.all, Promise.allSettled, Promise.race
    if (ts.isIdentifier(obj) && obj.text === 'Promise' &&
        ts.isIdentifier(method) &&
        (method.text === 'all' ||
         method.text === 'allSettled' ||
         method.text === 'race')) {
      return true;
    }
  }
  
  // Check for custom parallel execution patterns
  if (ts.isIdentifier(expression)) {
    const functionName = expression.text;
    
    // Common names for parallel execution functions
    const parallelFunctionNames = [
      'runParallel', 'executeParallel', 'parallelExecution',
      'runConcurrently', 'executeConcurrently', 'concurrentExecution'
    ];
    
    if (parallelFunctionNames.some(name => functionName.includes(name))) {
      return true;
    }
  }
  
  // Check for workflow-specific parallel patterns
  if (ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.name)) {
    const methodName = expression.name.text;
    
    // Common method names for parallel execution
    const parallelMethodNames = [
      'runParallel', 'executeParallel', 'parallelExecution',
      'runConcurrently', 'executeConcurrently', 'concurrentExecution'
    ];
    
    if (parallelMethodNames.some(name => methodName.includes(name))) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get the type of parallel execution
 *
 * @param node The call expression node
 * @returns The type of parallel execution
 */
function getParallelExecutionType(node: ts.CallExpression): string {
  const expression = node.expression;
  
  if (ts.isPropertyAccessExpression(expression)) {
    const obj = expression.expression;
    const method = expression.name;
    
    if (ts.isIdentifier(obj) && obj.text === 'Promise' &&
        ts.isIdentifier(method)) {
      return `Promise.${method.text}`;
    }
    
    if (ts.isIdentifier(method)) {
      return method.text;
    }
  }
  
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  
  return 'Parallel Execution';
}

/**
 * Extract parallel execution information from a node
 * Handles various parallel execution patterns
 *
 * @param node The TypeScript node (must be a parallel execution)
 * @param analyzeNode Function to analyze child nodes
 * @returns Parallel execution information
 */
export function extractParallelInfo(
  node: ts.Node,
  analyzeNode: (node: ts.Node) => WorkflowComponent[]
): ParallelExecution {
  if (!ts.isCallExpression(node)) {
    throw new Error('Node is not a call expression');
  }
  
  const branches: WorkflowComponent[][] = [];
  const executionType = getParallelExecutionType(node);
  
  try {
    // Get the array argument to the parallel execution function
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
            } else if (ts.isCallExpression(element)) {
              // For call expressions (like direct action calls), treat as a single-item branch
              const branch = analyzeNode(element);
              branches.push(branch);
            } else {
              // For other expressions, try to analyze them
              const branch = analyzeNode(element);
              branches.push(branch);
            }
          } catch (error) {
            console.error('Error analyzing parallel branch:', error);
          }
        });
      } else if (ts.isCallExpression(arrayArg) ||
                 ts.isArrowFunction(arrayArg) ||
                 ts.isFunctionExpression(arrayArg)) {
        // Handle cases where the argument is a function or call that returns an array
        try {
          const branch = analyzeNode(arrayArg);
          branches.push(branch);
        } catch (error) {
          console.error('Error analyzing parallel branch:', error);
        }
      }
    }
    
    // Handle multiple arguments as separate branches
    if (node.arguments.length > 1) {
      // Skip the first argument if it's already been processed as an array
      const startIndex = ts.isArrayLiteralExpression(node.arguments[0]) ? 1 : 0;
      
      for (let i = startIndex; i < node.arguments.length; i++) {
        try {
          const arg = node.arguments[i];
          if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
            // If it's a function, analyze its body
            if (arg.body) {
              const branch = analyzeNode(arg.body);
              branches.push(branch);
            }
          } else {
            // For other expressions, try to analyze them
            const branch = analyzeNode(arg);
            branches.push(branch);
          }
        } catch (error) {
          console.error('Error analyzing parallel branch:', error);
        }
      }
    }
  } catch (error) {
    console.error('Error extracting parallel execution info:', error);
  }
  
  // If we couldn't extract any branches, create a placeholder branch
  if (branches.length === 0) {
    branches.push([]);
    branches.push([]);
  }
  
  return {
    type: 'parallelExecution',
    branches,
    executionType, // Add the execution type as metadata
    sourceLocation: getSourceLocation(node)
  };
}

/**
 * Find all parallel executions in a function body
 * Handles various parallel execution patterns
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
  const processedNodes = new Set<ts.Node>();
  
  function visit(node: ts.Node) {
    // Skip nodes we've already processed to avoid duplicates
    if (processedNodes.has(node)) {
      return;
    }
    
    if (isParallelExecution(node)) {
      try {
        // Mark this node as processed
        processedNodes.add(node);
        
        // Extract parallel execution info
        const parallel = extractParallelInfo(node, analyzeNode);
        parallels.push(parallel);
        
        // Don't visit children of this parallel execution since they're already analyzed
        // by the extractParallelInfo function
      } catch (error) {
        console.error('Error extracting parallel execution info:', error);
        // Continue visiting children if there was an error
        ts.forEachChild(node, visit);
      }
    } else {
      // For non-parallel nodes, visit children
      ts.forEachChild(node, visit);
    }
  }
  
  visit(node);
  
  // Look for workflow-specific parallel patterns if we didn't find any standard patterns
  if (parallels.length === 0) {
    findWorkflowParallelPatterns(node, analyzeNode, parallels);
  }
  
  return parallels;
}

/**
 * Find workflow-specific parallel execution patterns
 * Looks for patterns like multiple async operations without explicit Promise.all
 *
 * @param node The function body node
 * @param analyzeNode Function to analyze child nodes
 * @param parallels Array to add found parallel executions to
 */
function findWorkflowParallelPatterns(
  node: ts.Node,
  analyzeNode: (node: ts.Node) => WorkflowComponent[],
  parallels: ParallelExecution[]
): void {
  // Look for blocks with multiple await expressions that could be executed in parallel
  if (ts.isBlock(node)) {
    const awaitExpressions: ts.AwaitExpression[] = [];
    
    // Find all await expressions in the block
    function collectAwaitExpressions(node: ts.Node) {
      if (ts.isAwaitExpression(node)) {
        awaitExpressions.push(node);
      } else {
        ts.forEachChild(node, collectAwaitExpressions);
      }
    }
    
    collectAwaitExpressions(node);
    
    // If we found multiple await expressions in the same block,
    // they could potentially be executed in parallel
    if (awaitExpressions.length > 1) {
      const branches: WorkflowComponent[][] = [];
      
      // Create a branch for each await expression
      awaitExpressions.forEach(awaitExpr => {
        try {
          const branch = analyzeNode(awaitExpr.expression);
          branches.push(branch);
        } catch (error) {
          console.error('Error analyzing potential parallel branch:', error);
        }
      });
      
      if (branches.length > 1) {
        parallels.push({
          type: 'parallelExecution',
          branches,
          executionType: 'Potential Parallel Execution',
          sourceLocation: getSourceLocation(node)
        });
      }
    }
  }
  
  // Look for variable declarations with multiple promises
  if (ts.isVariableStatement(node)) {
    const declarations = node.declarationList.declarations;
    
    if (declarations.length > 1) {
      const promiseDeclarations: ts.VariableDeclaration[] = [];
      
      // Find declarations that initialize with promises
      declarations.forEach(decl => {
        if (decl.initializer &&
            (isPromiseExpression(decl.initializer) ||
             isAsyncFunctionCall(decl.initializer))) {
          promiseDeclarations.push(decl);
        }
      });
      
      // If we found multiple promise declarations, they could be executed in parallel
      if (promiseDeclarations.length > 1) {
        const branches: WorkflowComponent[][] = [];
        
        // Create a branch for each promise declaration
        promiseDeclarations.forEach(decl => {
          if (decl.initializer) {
            try {
              const branch = analyzeNode(decl.initializer);
              branches.push(branch);
            } catch (error) {
              console.error('Error analyzing potential parallel branch:', error);
            }
          }
        });
        
        if (branches.length > 1) {
          parallels.push({
            type: 'parallelExecution',
            branches,
            executionType: 'Potential Parallel Execution',
            sourceLocation: getSourceLocation(node)
          });
        }
      }
    }
  }
}

/**
 * Check if an expression is a Promise
 *
 * @param node The expression node
 * @returns True if the expression is likely a Promise
 */
function isPromiseExpression(node: ts.Expression): boolean {
  // Check for new Promise()
  if (ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Promise') {
    return true;
  }
  
  // Check for Promise.resolve(), Promise.reject()
  if (ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'Promise' &&
      ts.isIdentifier(node.expression.name) &&
      (node.expression.name.text === 'resolve' ||
       node.expression.name.text === 'reject')) {
    return true;
  }
  
  return false;
}

/**
 * Check if an expression is an async function call
 *
 * @param node The expression node
 * @returns True if the expression is likely an async function call
 */
function isAsyncFunctionCall(node: ts.Expression): boolean {
  if (!ts.isCallExpression(node)) return false;
  
  // Check for calls to functions with 'async' in the name
  if (ts.isIdentifier(node.expression) &&
      node.expression.text.includes('async')) {
    return true;
  }
  
  // Check for calls to methods with 'async' in the name
  if (ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.name) &&
      node.expression.name.text.includes('async')) {
    return true;
  }
  
  return false;
}