import * as ts from 'typescript';
import { ActionCall } from '../../types/astTypes';
import { getSourceLocation, extractArgumentValues } from '../astParser';

/**
 * Check if a node is an action call (actions.someAction)
 * 
 * @param node The TypeScript node to check
 * @returns True if the node is an action call
 */
export function isActionCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  
  const expression = node.expression;
  if (!ts.isPropertyAccessExpression(expression)) return false;
  
  const obj = expression.expression;
  
  // Check if it's accessing a property of the 'actions' object
  return ts.isIdentifier(obj) && obj.text === 'actions';
}

/**
 * Extract action call information from a node
 * 
 * @param node The TypeScript node (must be an action call)
 * @returns Action call information
 */
export function extractActionInfo(node: ts.Node): ActionCall {
  if (!ts.isCallExpression(node) || !isActionCall(node)) {
    throw new Error('Node is not an action call');
  }
  
  const expression = node.expression as ts.PropertyAccessExpression;
  const method = expression.name;
  
  // Get the action name
  const actionName = ts.isIdentifier(method) ? method.text : 'unknown';
  
  // Extract arguments
  const args = extractArgumentValues(node);
  
  return {
    type: 'actionCall',
    actionName,
    arguments: args,
    sourceLocation: getSourceLocation(node)
  };
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
      actions.push(extractActionInfo(node));
    }
    
    ts.forEachChild(node, visit);
  }
  
  visit(node);
  return actions;
}