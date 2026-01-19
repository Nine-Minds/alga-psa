import * as ts from 'typescript';
import { EventWaiting, EventEmission } from '../../types/astTypes';
import { getSourceLocation, isMethodCall, extractArgumentValues } from '../astParser';

/**
 * Check if a node is an event waiting call (events.waitFor)
 * 
 * @param node The TypeScript node to check
 * @returns True if the node is an event waiting call
 */
export function isEventWaiting(node: ts.Node): boolean {
  return isMethodCall(node, 'events', 'waitFor');
}

/**
 * Check if a node is an event emission call (events.emit)
 * 
 * @param node The TypeScript node to check
 * @returns True if the node is an event emission call
 */
export function isEventEmission(node: ts.Node): boolean {
  return isMethodCall(node, 'events', 'emit');
}

/**
 * Extract event waiting information from a node
 * 
 * @param node The TypeScript node (must be an event waiting call)
 * @returns Event waiting information
 */
export function extractEventWaitingInfo(node: ts.Node): EventWaiting {
  if (!ts.isCallExpression(node) || !isEventWaiting(node)) {
    throw new Error('Node is not an event waiting call');
  }
  
  // Get the event name(s)
  const eventArg = node.arguments[0];
  let eventNames: string[] = [];
  
  if (ts.isStringLiteral(eventArg)) {
    // Single event name as string
    eventNames = [eventArg.text];
  } else if (ts.isArrayLiteralExpression(eventArg)) {
    // Array of event names
    eventNames = eventArg.elements
      .filter(ts.isStringLiteral)
      .map(element => (element as ts.StringLiteral).text);
  } else if (ts.isIdentifier(eventArg)) {
    // Variable reference
    eventNames = [`[${eventArg.text}]`];
  } else if (eventArg) {
    // For other expressions, use the text representation
    eventNames = [`[${eventArg.getText()}]`];
  }
  
  return {
    type: 'eventWaiting',
    eventNames,
    sourceLocation: getSourceLocation(node)
  };
}

/**
 * Extract event emission information from a node
 * 
 * @param node The TypeScript node (must be an event emission call)
 * @returns Event emission information
 */
export function extractEventEmissionInfo(node: ts.Node): EventEmission {
  if (!ts.isCallExpression(node) || !isEventEmission(node)) {
    throw new Error('Node is not an event emission call');
  }
  
  // Get the event name
  const eventNameArg = node.arguments[0];
  let eventName = 'unknown';
  
  if (ts.isStringLiteral(eventNameArg)) {
    eventName = eventNameArg.text;
  } else if (ts.isIdentifier(eventNameArg)) {
    eventName = `[${eventNameArg.text}]`; // Variable reference
  } else if (eventNameArg) {
    // For other expressions, use the text representation
    eventName = `[${eventNameArg.getText()}]`;
  }
  
  // Get the payload if available
  let payload: any = undefined;
  if (node.arguments.length > 1) {
    const payloadArg = node.arguments[1];
    const args = extractArgumentValues(node);
    payload = args[1]; // Second argument is the payload
  }
  
  return {
    type: 'eventEmission',
    eventName,
    payload,
    sourceLocation: getSourceLocation(node)
  };
}

/**
 * Find all event operations in a function body
 * 
 * @param node The function body node
 * @returns Array of event waiting and emission operations
 */
export function findEventOperations(node: ts.Node): (EventWaiting | EventEmission)[] {
  const events: (EventWaiting | EventEmission)[] = [];
  
  function visit(node: ts.Node) {
    if (isEventWaiting(node)) {
      events.push(extractEventWaitingInfo(node));
    } else if (isEventEmission(node)) {
      events.push(extractEventEmissionInfo(node));
    }
    
    ts.forEachChild(node, visit);
  }
  
  visit(node);
  return events;
}