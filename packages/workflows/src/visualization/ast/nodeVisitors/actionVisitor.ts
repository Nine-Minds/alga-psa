import * as ts from 'typescript';
import { ActionCall } from '../../types/astTypes';
import { getSourceLocation, extractArgumentValues } from '../astParser';

/**
 * Check if a node is an action call
 * Detects various patterns for action calls
 *
 * @param node The TypeScript node to check
 * @returns True if the node is an action call
 */
export function isActionCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  
  const expression = node.expression;
  
  // Check for direct function calls like runA() and runB()
  // This is needed for the scenario:
  // if (!condition) {
  //   runA();
  // }
  // runB();
  if (ts.isIdentifier(expression)) {
    // Consider any direct function call as an action
    // This will include functions like runA() and runB()
    return true;
  }
  
  // Check for direct actions.someAction() call
  if (ts.isPropertyAccessExpression(expression)) {
    const obj = expression.expression;
    
    // Check if it's accessing a property of the 'actions' object
    if (ts.isIdentifier(obj) && obj.text === 'actions') {
      return true;
    }
    
    // Check for context.actions.someAction() pattern
    if (ts.isPropertyAccessExpression(obj) &&
        ts.isIdentifier(obj.expression) &&
        obj.expression.text === 'context' &&
        ts.isIdentifier(obj.name) &&
        obj.name.text === 'actions') {
      return true;
    }
    
    // Check for this.actions.someAction() pattern in class methods
    if (ts.isPropertyAccessExpression(obj) &&
        ts.isIdentifier(obj.expression) &&
        obj.expression.text === 'this' &&
        ts.isIdentifier(obj.name) &&
        obj.name.text === 'actions') {
      return true;
    }
  }
  
  // Check for action registry patterns like registry.getAction('name')() or executeAction('name')
  if (ts.isCallExpression(expression)) {
    const innerExpression = expression.expression;
    
    // Check for registry.getAction('name') pattern
    if (ts.isPropertyAccessExpression(innerExpression) &&
        ts.isIdentifier(innerExpression.name) &&
        (innerExpression.name.text === 'getAction' ||
         innerExpression.name.text === 'executeAction')) {
      return true;
    }
    
    // Check for global executeAction function
    if (ts.isIdentifier(innerExpression) &&
        innerExpression.text === 'executeAction') {
      return true;
    }
  }
  
  return false;
}

/**
 * Extract action call information from a node
 *
 * @param node The TypeScript node (must be an action call)
 * @returns Action call information
 */
export function extractActionInfo(node: ts.Node): ActionCall {
  if (!ts.isCallExpression(node)) {
    throw new Error('Node is not a call expression');
  }
  
  const expression = node.expression;
  let actionName = 'unknown';
  let args: any[] = [];
  
  // Extract action name and arguments based on the pattern
  if (ts.isIdentifier(expression)) {
    // Handle direct function calls: runA(), runB()
    actionName = expression.text;
    args = extractArgumentValues(node);
  } else if (ts.isPropertyAccessExpression(expression)) {
    // Handle direct action calls: actions.someAction()
    const method = expression.name;
    actionName = ts.isIdentifier(method) ? method.text : 'unknown';
    args = extractArgumentValues(node);
  } else if (ts.isCallExpression(expression)) {
    // Handle registry patterns: registry.getAction('name')() or executeAction('name')
    const innerExpression = expression.expression;
    
    if (ts.isPropertyAccessExpression(innerExpression) &&
        (innerExpression.name.text === 'getAction' ||
         innerExpression.name.text === 'executeAction')) {
      // Extract the action name from the first argument of getAction/executeAction
      const innerArgs = expression.arguments;
      if (innerArgs.length > 0 && ts.isStringLiteral(innerArgs[0])) {
        actionName = innerArgs[0].text;
      }
    } else if (ts.isIdentifier(innerExpression) &&
               innerExpression.text === 'executeAction') {
      // Extract the action name from the first argument of executeAction
      const innerArgs = expression.arguments;
      if (innerArgs.length > 0 && ts.isStringLiteral(innerArgs[0])) {
        actionName = innerArgs[0].text;
      }
    }
    
    // Extract arguments from the outer call
    args = extractArgumentValues(node);
  }
  
  // Process complex arguments
  const processedArgs = processComplexArguments(args);
  
  return {
    type: 'actionCall',
    actionName,
    arguments: processedArgs,
    sourceLocation: getSourceLocation(node)
  };
}

/**
 * Process complex arguments to extract more meaningful information
 *
 * @param args The raw arguments array
 * @returns Processed arguments with more meaningful information
 */
function processComplexArguments(args: any[]): any[] {
  return args.map(arg => {
    // If the argument is already a primitive value, return it as is
    if (typeof arg !== 'object' || arg === null) {
      return arg;
    }
    
    // If the argument is an array, process each element
    if (Array.isArray(arg)) {
      return arg.map(item => {
        if (typeof item === 'string' && item.startsWith('[') && item.endsWith(']')) {
          // Try to extract meaningful information from expressions
          return extractExpressionInfo(item);
        }
        return item;
      });
    }
    
    // If the argument is an object, process each property
    const processedObj: Record<string, any> = {};
    for (const [key, value] of Object.entries(arg)) {
      if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
        // Try to extract meaningful information from expressions
        processedObj[key] = extractExpressionInfo(value);
      } else {
        processedObj[key] = value;
      }
    }
    
    return processedObj;
  });
}

/**
 * Extract meaningful information from expression strings
 *
 * @param expr The expression string (e.g., "[context.data.userId]")
 * @returns A more meaningful representation of the expression
 */
function extractExpressionInfo(expr: string): string {
  // Remove the square brackets
  const content = expr.slice(1, -1);
  
  // Extract variable references
  const varRefMatch = content.match(/([a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*)/);
  if (varRefMatch) {
    return `{${varRefMatch[1]}}`;
  }
  
  // Extract template literals
  if (content.includes('${')) {
    return '{template literal}';
  }
  
  // Extract function calls
  const funcCallMatch = content.match(/([a-zA-Z_][a-zA-Z0-9_]*)\(/);
  if (funcCallMatch) {
    return `{${funcCallMatch[1]}() result}`;
  }
  
  return expr;
}

/**
 * Find all action calls in a function body
 *
 * @param node The function body node
 * @returns Array of action calls
 */
export function findActionCalls(node: ts.Node): ActionCall[] {
  const actions: ActionCall[] = [];
  
  function visit(node: ts.Node) {
    if (isActionCall(node)) {
      try {
        const actionInfo = extractActionInfo(node);
        actions.push(actionInfo);
      } catch (error) {
        console.warn('Error extracting action info:', error);
      }
    }
    
    ts.forEachChild(node, visit);
  }
  
  visit(node);
  return actions;
}