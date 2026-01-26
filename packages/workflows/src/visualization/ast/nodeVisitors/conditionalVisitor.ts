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
 * Check if a node is a conditional statement
 * Detects if/else, switch, and ternary expressions
 *
 * @param node The TypeScript node to check
 * @returns True if the node is a conditional statement
 */
export function isConditional(node: ts.Node): boolean {
  // Check for if statements
  if (ts.isIfStatement(node)) {
    return true;
  }
  
  // Check for switch statements
  if (ts.isSwitchStatement(node)) {
    return true;
  }
  
  // Check for ternary expressions
  if (ts.isConditionalExpression(node)) {
    return true;
  }
  
  return false;
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
  if (!isConditional(node)) {
    throw new Error('Node is not a conditional statement');
  }
  
  let condition = '[Condition]';
  let thenBranch: WorkflowComponent[] = [];
  let elseBranch: WorkflowComponent[] | undefined;
  
  // Handle different types of conditionals
  if (ts.isIfStatement(node)) {
    // Handle if statements
    if (node.expression) {
      condition = safeGetText(node.expression);
    }
    
    // Analyze the then branch
    thenBranch = analyzeNode(node.thenStatement);
    
    // Analyze the else branch if it exists
    if (node.elseStatement) {
      // Special handling for else-if chains
      if (ts.isIfStatement(node.elseStatement)) {
        // Create a separate conditional for the else-if
        const elseIfConditional = extractConditionalInfo(node.elseStatement, analyzeNode);
        elseBranch = [elseIfConditional];
      } else {
        elseBranch = analyzeNode(node.elseStatement);
      }
    }
  } else if (ts.isSwitchStatement(node)) {
    // Handle switch statements
    if (node.expression) {
      condition = `switch (${safeGetText(node.expression)})`;
    }
    
    // Process each case clause
    const cases: WorkflowComponent[] = [];
    let defaultCase: WorkflowComponent[] | undefined;
    
    for (const caseClause of node.caseBlock.clauses) {
      if (ts.isCaseClause(caseClause)) {
        // Regular case clause
        const caseCondition = safeGetText(caseClause.expression);
        const caseComponents = analyzeNode(caseClause);
        
        // Create a conditional for this case
        const caseConditional: Conditional = {
          type: 'conditional',
          condition: `case ${caseCondition}`,
          thenBranch: caseComponents,
          sourceLocation: getSourceLocation(caseClause)
        };
        
        cases.push(caseConditional);
      } else if (ts.isDefaultClause(caseClause)) {
        // Default case
        defaultCase = analyzeNode(caseClause);
      }
    }
    
    // Add all cases to the then branch
    thenBranch = cases;
    
    // Add default case to else branch if it exists
    if (defaultCase && defaultCase.length > 0) {
      elseBranch = defaultCase;
    }
  } else if (ts.isConditionalExpression(node)) {
    // Handle ternary expressions
    if (node.condition) {
      condition = safeGetText(node.condition);
    }
    
    // Analyze the then branch
    thenBranch = analyzeNode(node.whenTrue);
    
    // Analyze the else branch
    elseBranch = analyzeNode(node.whenFalse);
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
 * Handles nested conditionals properly
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
  const processedNodes = new Set<ts.Node>();
  
  function visit(node: ts.Node) {
    // Skip nodes we've already processed to avoid duplicates
    if (processedNodes.has(node)) {
      return;
    }
    
    if (isConditional(node)) {
      try {
        // Mark this node as processed
        processedNodes.add(node);
        
        // Extract conditional info
        const conditional = extractConditionalInfo(node, analyzeNode);
        conditionals.push(conditional);
        
        // Don't visit children of this conditional since they're already analyzed
        // by the extractConditionalInfo function
      } catch (error) {
        console.error('Error extracting conditional info:', error);
        // Continue visiting children if there was an error
        ts.forEachChild(node, visit);
      }
    } else {
      // For non-conditional nodes, visit children
      ts.forEachChild(node, visit);
    }
  }
  
  visit(node);
  return conditionals;
}

/**
 * Simplify complex conditions for better readability
 *
 * @param condition The condition expression as a string
 * @returns A simplified version of the condition
 */
export function simplifyCondition(condition: string): string {
  // If the condition is too long, try to extract the main parts
  if (condition.length > 50) {
    // Extract state checks
    const stateCheckMatch = condition.match(/context\.state\s*===?\s*['"]([^'"]+)['"]/);
    if (stateCheckMatch) {
      return `state is '${stateCheckMatch[1]}'`;
    }
    
    // Extract variable checks
    const varCheckMatch = condition.match(/(\w+)\s*===?\s*['"]([^'"]+)['"]/);
    if (varCheckMatch) {
      return `${varCheckMatch[1]} is '${varCheckMatch[2]}'`;
    }
    
    // Extract function calls
    const funcCallMatch = condition.match(/(\w+)\(([^)]*)\)/);
    if (funcCallMatch) {
      return `${funcCallMatch[1]}() result`;
    }
    
    // If all else fails, truncate
    return condition.substring(0, 47) + '...';
  }
  
  return condition;
}