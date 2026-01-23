import * as ts from 'typescript';
import { StateTransition } from '../../types/astTypes';
import { getSourceLocation, isMethodCall } from '../astParser';

/**
 * Interface for state transition context
 */
interface StateTransitionContext {
  fromState?: string;
  event?: string;
  condition?: string;
}

/**
 * Check if a node is a state transition
 * Detects various patterns for state transitions
 *
 * @param node The TypeScript node to check
 * @returns True if the node is a state transition
 */
export function isStateTransition(node: ts.Node): boolean {
  // Check for direct context.setState call
  if (isMethodCall(node, 'context', 'setState')) {
    return true;
  }
  
  // Check for context.state = 'newState' assignment
  if (ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isPropertyAccessExpression(node.left.expression) &&
      ts.isIdentifier(node.left.expression.name) &&
      node.left.expression.name.text === 'context' &&
      ts.isIdentifier(node.left.name) &&
      node.left.name.text === 'state') {
    return true;
  }
  
  // Check for this.state = 'newState' assignment in class methods
  if (ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isPropertyAccessExpression(node.left.expression) &&
      ts.isIdentifier(node.left.expression.name) &&
      node.left.expression.name.text === 'this' &&
      ts.isIdentifier(node.left.name) &&
      node.left.name.text === 'state') {
    return true;
  }
  
  // Check for workflow.transitionTo('newState') pattern
  if (isMethodCall(node, 'workflow', 'transitionTo') ||
      isMethodCall(node, 'this', 'transitionTo') ||
      isMethodCall(node, 'this.workflow', 'transitionTo')) {
    return true;
  }
  
  return false;
}

/**
 * Extract state transition information from a node
 *
 * @param node The TypeScript node (must be a state transition)
 * @param context Optional context information about the transition
 * @returns State transition information
 */
export function extractStateInfo(node: ts.Node, context: StateTransitionContext = {}): StateTransition {
  if (!isStateTransition(node)) {
    throw new Error('Node is not a state transition');
  }
  
  let stateName = 'unknown';
  let stateArg: ts.Node | undefined;
  
  // Extract state name based on the type of state transition
  if (ts.isCallExpression(node)) {
    if (isMethodCall(node, 'context', 'setState') ||
        isMethodCall(node, 'workflow', 'transitionTo') ||
        isMethodCall(node, 'this', 'transitionTo') ||
        isMethodCall(node, 'this.workflow', 'transitionTo')) {
      stateArg = node.arguments[0];
    }
  } else if (ts.isBinaryExpression(node) &&
             node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    stateArg = node.right;
  }
  
  // Extract the state name from the argument
  if (stateArg) {
    if (ts.isStringLiteral(stateArg)) {
      stateName = stateArg.text;
    } else if (ts.isIdentifier(stateArg)) {
      // Try to resolve the identifier value if it's a constant
      const value = resolveIdentifierValue(stateArg);
      stateName = value || `[${stateArg.text}]`;
    } else if (ts.isPropertyAccessExpression(stateArg)) {
      // Handle enum values like States.APPROVED
      const enumValue = resolveEnumValue(stateArg);
      stateName = enumValue || `[${stateArg.getText()}]`;
    } else {
      // For other expressions, use the text representation
      stateName = `[${stateArg.getText()}]`;
    }
  }
  
  return {
    type: 'stateTransition',
    stateName,
    fromState: context.fromState,
    event: context.event,
    condition: context.condition,
    sourceLocation: getSourceLocation(node)
  };
}

/**
 * Try to resolve the value of an identifier by looking for its declaration
 *
 * @param identifier The identifier node
 * @returns The resolved value or undefined if not found
 */
function resolveIdentifierValue(identifier: ts.Identifier): string | undefined {
  // Find the declaration of the identifier
  const declaration = findDeclaration(identifier);
  
  if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
    if (ts.isStringLiteral(declaration.initializer)) {
      return declaration.initializer.text;
    }
  }
  
  return undefined;
}

/**
 * Try to resolve an enum value
 *
 * @param propertyAccess The property access expression (e.g., States.APPROVED)
 * @returns The resolved enum value or undefined if not found
 */
function resolveEnumValue(propertyAccess: ts.PropertyAccessExpression): string | undefined {
  // This is a simplified implementation
  // In a real implementation, you would need to find the enum declaration
  // and extract the value of the enum member
  
  // For now, just return the property name as a fallback
  return propertyAccess.name.text;
}

/**
 * Find the declaration of an identifier
 *
 * @param identifier The identifier node
 * @returns The declaration node or undefined if not found
 */
function findDeclaration(identifier: ts.Identifier): ts.Node | undefined {
  // This is a simplified implementation
  // In a real implementation, you would use the TypeScript compiler API
  // to find the declaration of the identifier
  
  // For now, try to find a variable declaration in the parent nodes
  let node: ts.Node | undefined = identifier;
  
  while (node && node.parent) {
    node = node.parent;
    
    if (ts.isSourceFile(node)) {
      // Search for variable declarations in the source file
      for (const statement of node.statements) {
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name) && declaration.name.text === identifier.text) {
              return declaration;
            }
          }
        }
      }
    }
  }
  
  return undefined;
}

/**
 * Find all state transitions in a function body with enhanced context detection
 *
 * @param node The function body node
 * @returns Array of state transitions
 */
export function findStateTransitions(node: ts.Node): StateTransition[] {
  const transitions: StateTransition[] = [];
  const stateConstants = findStateConstants(node);
  
  // Track the current context for transitions
  let currentContext: StateTransitionContext = {};
  
  function visit(node: ts.Node) {
    // Update context based on surrounding code
    updateTransitionContext(node, currentContext);
    
    if (isStateTransition(node)) {
      transitions.push(extractStateInfo(node, { ...currentContext }));
    }
    
    // Visit children with the current context
    ts.forEachChild(node, visit);
  }
  
  visit(node);
  
  // If we found state constants but no transitions, create synthetic transitions
  if (transitions.length === 0 && stateConstants.size > 0) {
    const states = Array.from(stateConstants.values());
    
    // Create transitions between consecutive states
    for (let i = 0; i < states.length - 1; i++) {
      transitions.push({
        type: 'stateTransition',
        stateName: states[i + 1],
        fromState: states[i],
        sourceLocation: { line: 0, character: 0, text: '' }
      });
    }
  }
  
  return transitions;
}

/**
 * Update the transition context based on surrounding code
 *
 * @param node The current node
 * @param context The context to update
 */
function updateTransitionContext(node: ts.Node, context: StateTransitionContext): void {
  // Check if we're in an if statement that checks the current state
  if (ts.isIfStatement(node)) {
    const condition = node.expression.getText();
    
    // Look for patterns like context.state === 'someState' or this.state === 'someState'
    const stateCheckRegex = /(context|this)\.state\s*===?\s*['"]([^'"]+)['"]/;
    const match = condition.match(stateCheckRegex);
    
    if (match) {
      context.fromState = match[2];
      context.condition = condition;
    }
  }
  
  // Check if we're in an event handler function
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    const functionText = node.getText();
    
    // Look for patterns like handleEvent, onEvent, processEvent
    const eventHandlerRegex = /handle([A-Z]\w+)|on([A-Z]\w+)|process([A-Z]\w+)/;
    const match = functionText.match(eventHandlerRegex);
    
    if (match) {
      context.event = match[1] || match[2] || match[3] || undefined;
    }
  }
  
  // Check if we're in a waitForEvent call
  if (ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === 'context' &&
      node.expression.name.text === 'waitForEvent') {
    
    const eventArg = node.arguments[0];
    if (ts.isStringLiteral(eventArg)) {
      context.event = eventArg.text;
    }
  }
}

/**
 * Find state constants in the code
 *
 * @param node The node to search
 * @returns A map of state constant names to values
 */
function findStateConstants(node: ts.Node): Map<string, string> {
  const stateConstants = new Map<string, string>();
  
  function visit(node: ts.Node) {
    // Look for state-like constant declarations
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) &&
            declaration.initializer &&
            ts.isStringLiteral(declaration.initializer)) {
          
          const name = declaration.name.text;
          const value = declaration.initializer.text;
          
          // Check if this looks like a state constant
          if (name.toUpperCase() === name ||
              name.includes('STATE') ||
              name.includes('Status')) {
            stateConstants.set(name, value);
          }
        }
      }
    }
    
    // Look for enum declarations that might represent states
    if (ts.isEnumDeclaration(node) &&
        (node.name.text.includes('State') ||
         node.name.text.includes('Status'))) {
      
      for (const member of node.members) {
        if (ts.isIdentifier(member.name)) {
          const name = member.name.text;
          
          // If the enum member has an initializer that's a string literal, use that
          if (member.initializer && ts.isStringLiteral(member.initializer)) {
            stateConstants.set(name, member.initializer.text);
          } else {
            // Otherwise use the member name as the value
            stateConstants.set(name, name);
          }
        }
      }
    }
    
    ts.forEachChild(node, visit);
  }
  
  visit(node);
  return stateConstants;
}