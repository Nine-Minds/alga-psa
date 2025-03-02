import * as ts from 'typescript';
import { WorkflowAnalysis, WorkflowComponent, ControlFlow } from '../types/astTypes';
import { findStateTransitions } from './nodeVisitors/stateTransitionVisitor';
import { findActionCalls } from './nodeVisitors/actionVisitor';
import { findEventOperations } from './nodeVisitors/eventVisitor';
import { findConditionals } from './nodeVisitors/conditionalVisitor';
import { findLoops } from './nodeVisitors/loopVisitor';
import { findParallelExecutions } from './nodeVisitors/parallelVisitor';

/**
 * Analyze a workflow function to extract its components and control flow
 * 
 * @param node The workflow function node
 * @returns Complete workflow analysis
 */
export function analyzeWorkflowFunction(node: ts.FunctionLike): WorkflowAnalysis {
  // Initialize the analysis result
  const analysis: WorkflowAnalysis = {
    states: [],
    actions: [],
    events: [],
    conditionals: [],
    loops: [],
    parallelExecutions: [],
    controlFlow: []
  };
  
  // Track parent-child relationships for control flow
  const nodeParents = new Map<ts.Node, ts.Node>();
  
  // Function to analyze a node and its children
  function analyzeNode(node: ts.Node): WorkflowComponent[] {
    const components: WorkflowComponent[] = [];
    
    // Find state transitions
    const states = findStateTransitions(node);
    analysis.states.push(...states);
    components.push(...states);
    
    // Find action calls
    const actions = findActionCalls(node);
    analysis.actions.push(...actions);
    components.push(...actions);
    
    // Find event operations
    const events = findEventOperations(node);
    analysis.events.push(...events);
    components.push(...events);
    
    // Find conditionals (recursive)
    const conditionals = findConditionals(node, analyzeNode);
    analysis.conditionals.push(...conditionals);
    components.push(...conditionals);
    
    // Find loops (recursive)
    const loops = findLoops(node, analyzeNode);
    analysis.loops.push(...loops);
    components.push(...loops);
    
    // Find parallel executions (recursive)
    const parallels = findParallelExecutions(node, analyzeNode);
    analysis.parallelExecutions.push(...parallels);
    components.push(...parallels);
    
    return components;
  }
  // Start analyzing from the function body
  if ('body' in node && node.body) {
    analyzeNode(node.body);
  }
  
  // Build control flow relationships
  buildControlFlow(analysis);
  
  return analysis;
}

/**
 * Build control flow relationships between workflow components
 * 
 * @param analysis The workflow analysis to update with control flow
 */
function buildControlFlow(analysis: WorkflowAnalysis): void {
  const controlFlow: ControlFlow[] = [];
  
  // Helper function to add a sequential flow
  function addSequentialFlow(from: WorkflowComponent, to: WorkflowComponent) {
    controlFlow.push({
      from,
      to,
      type: 'sequential'
    });
  }
  
  // Connect state transitions in sequence
  const states = analysis.states;
  for (let i = 0; i < states.length - 1; i++) {
    addSequentialFlow(states[i], states[i + 1]);
  }
  
  // Connect actions to their following components
  const actions = analysis.actions;
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    
    // Find the next component after this action
    const nextComponent = findNextComponent(analysis, action);
    if (nextComponent) {
      addSequentialFlow(action, nextComponent);
    }
  }
  
  // Connect events to their following components
  const events = analysis.events;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    
    // Find the next component after this event
    const nextComponent = findNextComponent(analysis, event);
    if (nextComponent) {
      addSequentialFlow(event, nextComponent);
    }
  }
  
  // Connect conditionals to their branches
  analysis.conditionals.forEach(conditional => {
    // Connect condition to then branch
    if (conditional.thenBranch.length > 0) {
      controlFlow.push({
        from: conditional,
        to: conditional.thenBranch[0],
        type: 'conditional',
        condition: 'true'
      });
    }
    
    // Connect condition to else branch
    if (conditional.elseBranch && conditional.elseBranch.length > 0) {
      controlFlow.push({
        from: conditional,
        to: conditional.elseBranch[0],
        type: 'conditional',
        condition: 'false'
      });
    }
    
    // Find the next component after this conditional
    const nextComponent = findNextComponent(analysis, conditional);
    if (nextComponent) {
      addSequentialFlow(conditional, nextComponent);
    }
  });
  
  // Connect loops to their body and next component
  analysis.loops.forEach(loop => {
    // Connect loop to its body
    if (loop.body.length > 0) {
      controlFlow.push({
        from: loop,
        to: loop.body[0],
        type: 'loop',
        condition: loop.condition
      });
    }
    
    // Find the next component after this loop
    const nextComponent = findNextComponent(analysis, loop);
    if (nextComponent) {
      addSequentialFlow(loop, nextComponent);
    }
  });
  
  // Connect parallel executions to their branches
  analysis.parallelExecutions.forEach(parallel => {
    // Connect parallel to each branch
    parallel.branches.forEach(branch => {
      if (branch.length > 0) {
        controlFlow.push({
          from: parallel,
          to: branch[0],
          type: 'parallel'
        });
      }
    });
    
    // Find the next component after this parallel execution
    const nextComponent = findNextComponent(analysis, parallel);
    if (nextComponent) {
      addSequentialFlow(parallel, nextComponent);
    }
  });
  
  // Update the analysis with the control flow
  analysis.controlFlow = controlFlow;
}

/**
 * Find the next component after a given component based on source location
 * 
 * @param analysis The workflow analysis
 * @param component The component to find the next component for
 * @returns The next component or undefined if not found
 */
function findNextComponent(
  analysis: WorkflowAnalysis,
  component: WorkflowComponent
): WorkflowComponent | undefined {
  // Get all components
  const allComponents = [
    ...analysis.states,
    ...analysis.actions,
    ...analysis.events,
    ...analysis.conditionals,
    ...analysis.loops,
    ...analysis.parallelExecutions
  ];
  
  // Sort by source location
  allComponents.sort((a, b) => {
    if (a.sourceLocation.line !== b.sourceLocation.line) {
      return a.sourceLocation.line - b.sourceLocation.line;
    }
    return a.sourceLocation.character - b.sourceLocation.character;
  });
  
  // Find the index of the current component
  const index = allComponents.findIndex(c => c === component);
  if (index === -1 || index === allComponents.length - 1) {
    return undefined;
  }
  
  // Return the next component
  return allComponents[index + 1];
}