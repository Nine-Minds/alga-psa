import * as ts from 'typescript';
import { StateTransition } from '../../types/astTypes';
import { getSourceLocation, isMethodCall } from '../astParser';

/**
 * Check if a node is a state transition (context.setState call)
 * 
 * @param node The TypeScript node to check
 * @returns True if the node is a state transition
 */
export function isStateTransition(node: ts.Node): boolean {
  return isMethodCall(node, 'context', 'setState');
}

/**
 * Extract state transition information from a node
 * 
 * @param node The TypeScript node (must be a state transition)
 * @returns State transition information
 */
export function extractStateInfo(node: ts.Node): StateTransition {
  if (!ts.isCallExpression(node) || !isStateTransition(node)) {
    throw new Error('Node is not a state transition');
  }
  
  // Get the state argument
  const stateArg = node.arguments[0];
  let stateName = 'unknown';
  
  if (ts.isStringLiteral(stateArg)) {
    stateName = stateArg.text;
  } else if (ts.isIdentifier(stateArg)) {
    stateName = `[${stateArg.text}]`; // Variable reference
  } else if (ts.isPropertyAccessExpression(stateArg)) {
    // Handle object property access like someObject.someProperty
    stateName = `[${stateArg.getText()}]`;
  } else if (stateArg) {
    // For other expressions, use the text representation
    stateName = `[${stateArg.getText()}]`;
  }
  
  return {
    type: 'stateTransition',
    stateName,
    sourceLocation: getSourceLocation(node)
  };
}

/**
 * Find all state transitions in a function body
 * 
 * @param node The function body node
 * @returns Array of state transitions
 */
export function findStateTransitions(node: ts.Node): StateTransition[] {
  const transitions: StateTransition[] = [];
  
  function visit(node: ts.Node) {
    if (isStateTransition(node)) {
      transitions.push(extractStateInfo(node));
    }
    
    ts.forEachChild(node, visit);
  }
  
  visit(node);
  return transitions;
}