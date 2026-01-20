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
/**
 * Analyze a workflow function to extract its components and control flow
 *
 * Phase 1.5 Enhancement: This function now focuses exclusively on control flow elements
 * and completely ignores state transitions, providing a more accurate representation
 * of the actual code execution flow.
 *
 * @param node The workflow function node
 * @returns Complete workflow analysis
 */
export function analyzeWorkflowFunction(node: ts.FunctionLike): WorkflowAnalysis {
  // Initialize the analysis result
  const analysis: WorkflowAnalysis = {
    states: [], // Phase 1.5: We're keeping this empty array for backward compatibility
    actions: [],
    events: [],
    conditionals: [],
    loops: [],
    parallelExecutions: [],
    controlFlow: []
  };
  
  // Function to analyze a node and its children
  /**
   * Recursive function to analyze a node and its children
   * Phase 1.5: This function now focuses exclusively on control flow elements
   *
   * @param node The AST node to analyze
   * @returns Array of workflow components found in this node
   */
  function analyzeNode(node: ts.Node): WorkflowComponent[] {
    const components: WorkflowComponent[] = [];
    
    // Phase 1.5: We're explicitly not finding state transitions as we're focusing on control flow
    
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
/**
 * Build control flow relationships between workflow components
 *
 * Phase 1.5 Enhancement: This function now builds a graph based purely on control flow elements,
 * completely ignoring state transitions. It creates relationships between actions, events,
 * conditionals, loops, and parallel executions to represent the actual code execution flow.
 *
 * @param analysis The workflow analysis to update with control flow
 */
function buildControlFlow(analysis: WorkflowAnalysis): void {
  const controlFlow: ControlFlow[] = [];
  
  // Enhanced control flow building that focuses on execution paths rather than state transitions
  // This is a key part of the Phase 1.5 enhancement
  // Create maps to track which components are in which branches
  // We'll use separate maps for different types of branches to avoid conflicts
  const thenBranchComponents = new Map<WorkflowComponent, boolean>();
  const elseBranchComponents = new Map<WorkflowComponent, boolean>();
  const loopBodyComponents = new Map<WorkflowComponent, boolean>();
  const parallelBranchComponents = new Map<WorkflowComponent, boolean>();
  
  // Connect conditionals to their branches
  analysis.conditionals.forEach(conditional => {
    // Connect condition to then branch
    if (conditional.thenBranch.length > 0) {
      const firstComponent = conditional.thenBranch[0];
      controlFlow.push({
        from: conditional,
        to: firstComponent,
        type: 'conditional',
        condition: 'true'
      });
      
      // Mark all components in the then branch
      conditional.thenBranch.forEach(comp => {
        thenBranchComponents.set(comp, true);
      });
      
      // Connect components within the then branch sequentially
      for (let i = 0; i < conditional.thenBranch.length - 1; i++) {
        controlFlow.push({
          from: conditional.thenBranch[i],
          to: conditional.thenBranch[i + 1],
          type: 'sequential'
        });
      }
      
      // If there's no else branch, connect the last component in the then branch
      // to the next component after the conditional
      if (!conditional.elseBranch || conditional.elseBranch.length === 0) {
        const lastThenComponent = conditional.thenBranch[conditional.thenBranch.length - 1];
        
        // Find all components sorted by source location
        const allComponents = [
          ...analysis.actions,
          ...analysis.events,
          ...analysis.conditionals,
          ...analysis.loops,
          ...analysis.parallelExecutions
        ].sort((a, b) => {
          if (a.sourceLocation.line !== b.sourceLocation.line) {
            return a.sourceLocation.line - b.sourceLocation.line;
          }
          return a.sourceLocation.character - b.sourceLocation.character;
        });
        
        // Find the index of the conditional
        const conditionalIndex = allComponents.findIndex(c => c === conditional);
        
        // Find the next component after the conditional that's not in the then branch
        let nextComponent: WorkflowComponent | undefined;
        for (let i = conditionalIndex + 1; i < allComponents.length; i++) {
          const comp = allComponents[i];
          // Skip components that are in the then branch
          // Use source location comparison instead of includes() which checks object references
          const isInThenBranch = conditional.thenBranch.some(thenComp =>
            thenComp.sourceLocation.line === comp.sourceLocation.line &&
            thenComp.sourceLocation.character === comp.sourceLocation.character &&
            thenComp.type === comp.type
          );
          
          if (isInThenBranch) {
            console.log(`Skipping component in then branch: ${comp.type} at line ${comp.sourceLocation.line}`);
            continue;
          }
          
          
          // Found the next component
          nextComponent = comp;
          break;
        }
        
        if (nextComponent) {
          // Create a sequential edge from the conditional to the next component
          // This is crucial for scenarios like:
          // if (!condition) {
          //   runA();
          // }
          // runB();
          // Where we need to show a sequential flow from the if statement to runB()
          controlFlow.push({
            from: conditional,
            to: nextComponent,
            type: 'sequential'
          });
          
          console.log(`Created sequential edge from conditional to ${nextComponent.type}`);
        }
      }
    }
    
    // Connect condition to else branch
    if (conditional.elseBranch && conditional.elseBranch.length > 0) {
      const firstComponent = conditional.elseBranch[0];
      controlFlow.push({
        from: conditional,
        to: firstComponent,
        type: 'conditional',
        condition: 'false'
      });
      
      // Mark all components in the else branch
      conditional.elseBranch.forEach(comp => {
        elseBranchComponents.set(comp, true);
      });
      
      // Connect components within the else branch sequentially
      for (let i = 0; i < conditional.elseBranch.length - 1; i++) {
        controlFlow.push({
          from: conditional.elseBranch[i],
          to: conditional.elseBranch[i + 1],
          type: 'sequential'
        });
      }
    }
  });
  
  // Connect loops to their body
  analysis.loops.forEach(loop => {
    // Connect loop to its body
    if (loop.body.length > 0) {
      const firstComponent = loop.body[0];
      controlFlow.push({
        from: loop,
        to: firstComponent,
        type: 'loop',
        condition: loop.condition
      });
      
      // Mark all components in the loop body
      loop.body.forEach(comp => {
        loopBodyComponents.set(comp, true);
      });
      
      // Connect components within the loop body sequentially
      for (let i = 0; i < loop.body.length - 1; i++) {
        controlFlow.push({
          from: loop.body[i],
          to: loop.body[i + 1],
          type: 'sequential'
        });
      }
      
      // Connect the last component back to the loop for visualization
      if (loop.body.length > 0) {
        controlFlow.push({
          from: loop.body[loop.body.length - 1],
          to: loop,
          type: 'loop',
          condition: 'end'
        });
      }
    }
  });
  // Get all components for sequential flow analysis
  const allComponents = [
    ...analysis.actions,
    ...analysis.events,
    ...analysis.conditionals,
    ...analysis.loops,
    ...analysis.parallelExecutions
  ];
  
  // Sort by source location for more accurate sequential flow representation
  allComponents.sort((a, b) => {
    if (a.sourceLocation.line !== b.sourceLocation.line) {
      return a.sourceLocation.line - b.sourceLocation.line;
    }
    return a.sourceLocation.character - b.sourceLocation.character;
  });

  // For Phase 1.5, we're treating parallel executions differently to better represent CFG
  // Instead of having everything flow through the parallel execution node,
  // we'll create a more sequential representation of the actual code execution
  
  // First, identify all components in parallel branches
  analysis.parallelExecutions.forEach(parallel => {
    parallel.branches.forEach(branch => {
      branch.forEach(comp => {
        parallelBranchComponents.set(comp, true);
      });
    });
  });
  
  // Now create sequential connections between components based on their source location
  // This better represents the actual code execution flow
  const allComponentsSorted = [...allComponents];
  
  // Create a map to track which components have incoming edges
  const hasIncomingEdge = new Map<WorkflowComponent, boolean>();
  
  // Mark components that already have incoming edges from conditionals, loops, etc.
  controlFlow.forEach(flow => {
    hasIncomingEdge.set(flow.to, true);
  });
  
  // Connect components sequentially based on source location
  for (let i = 0; i < allComponentsSorted.length - 1; i++) {
    const current = allComponentsSorted[i];
    const next = allComponentsSorted[i + 1];
    
    // Skip if the current component is a control structure
    // These have special handling for their next components
    if (current.type === 'conditional' || current.type === 'loop') {
      continue;
    }
    
    // Skip if the next component already has an incoming edge
    if (hasIncomingEdge.get(next)) {
      continue;
    }
    
    // Skip if the components are not in the same scope
    // if (!areInSameScope(current, next)) {
    //   continue;
    // }
    
    // Create a sequential connection
    controlFlow.push({
      from: current,
      to: next,
      type: 'sequential'
    });
    
    // Mark the next component as having an incoming edge
    hasIncomingEdge.set(next, true);
  }
  
  // Now handle parallel executions - connect them to their branches
  // but don't make them central hubs
  analysis.parallelExecutions.forEach(parallel => {
    // Find all components in each branch
    parallel.branches.forEach(branch => {
      if (branch.length > 0) {
        // Connect the first component in the branch to the previous component
        // This creates a more natural CFG flow
        const firstComponent = branch[0];
        
        // Connect components within the branch sequentially
        for (let i = 0; i < branch.length - 1; i++) {
          controlFlow.push({
            from: branch[i],
            to: branch[i + 1],
            type: 'sequential'
          });
        }
      }
    });
  });
  
  // Now connect the remaining components sequentially based on source location
  // This handles the main flow outside of branches
  
  // Connect sequential components that aren't already in branches
  // Enhanced to create more accurate sequential flow connections
  for (let i = 0; i < allComponents.length - 1; i++) {
    const current = allComponents[i];
    const next = allComponents[i + 1];
    
    // Skip if the next component is part of any branch
    if (thenBranchComponents.get(next) ||
        elseBranchComponents.get(next) ||
        loopBodyComponents.get(next) ||
        parallelBranchComponents.get(next)) {
      continue;
    }
    
    // Skip if the current component is a conditional, loop, or parallel
    // as these have special handling for their next components
    if (current.type === 'conditional' || current.type === 'loop' || current.type === 'parallelExecution') {
      continue;
    }
    
    // Check if the components are in the same block or function scope
    // This helps create more accurate sequential connections
    //if (areInSameScope(current, next)) {
      controlFlow.push({
        from: current,
        to: next,
        type: 'sequential'
      });
    //}
  }
  
  // Update the analysis with the control flow
  analysis.controlFlow = controlFlow;
}

/**
 * Check if two components are in the same scope
 * This helps create more accurate sequential flow connections by ensuring
 * we only connect components that are likely to be executed sequentially.
 *
 * @param a First component
 * @param b Second component
 * @returns True if the components are in the same scope
 */
function areInSameScope(a: WorkflowComponent, b: WorkflowComponent): boolean {
  // Simple heuristic: if the components are close to each other in the source code,
  // they're likely in the same scope and part of the same execution flow
  const maxLineDifference = 10; // Adjust as needed based on code formatting
  return Math.abs(a.sourceLocation.line - b.sourceLocation.line) <= maxLineDifference;
}

/**
 * Find the next component after a given component based on source location
 * 
 * @param analysis The workflow analysis
 * @param component The component to find the next component for
 * @returns The next component or undefined if not found
 */
/**
 * Find the next control flow component after a given component based on source location
 * This function skips state transitions
 *
 * @param analysis The workflow analysis
 * @param component The component to find the next component for
 * @returns The next component or undefined if not found
 */
/**
 * Find the next control flow component after a given component based on source location
 * This function is context-aware and avoids creating connections to components that are
 * already part of branches.
 *
 * @param analysis The workflow analysis
 * @param component The component to find the next component for
 * @param skipBranches Whether to skip components that are part of branches
 * @returns The next component or undefined if not found
 */
/**
 * Find the next control flow component after a given component
 * Enhanced to provide more accurate next component detection
 *
 * @param analysis The workflow analysis
 * @param component The component to find the next component for
 * @param skipBranches Whether to skip components that are part of branches
 * @returns The next component or undefined if not found
 */
/**
 * Find the next control flow component after a given component
 *
 * Phase 1.5 Enhancement: This function is used to determine the next component
 * in the execution flow, completely ignoring state transitions. It's used to
 * build sequential connections between components.
 *
 * @param analysis The workflow analysis
 * @param component The component to find the next component for
 * @param skipBranches Whether to skip components that are part of branches
 * @returns The next component or undefined if not found
 */
function findNextControlFlowComponent(
  analysis: WorkflowAnalysis,
  component: WorkflowComponent,
  skipBranches: boolean = true,
  branchMaps?: {
    thenBranchComponents: Map<WorkflowComponent, boolean>,
    elseBranchComponents: Map<WorkflowComponent, boolean>,
    loopBodyComponents: Map<WorkflowComponent, boolean>,
    parallelBranchComponents: Map<WorkflowComponent, boolean>
  }
): WorkflowComponent | undefined {
  // Get all components except state transitions
  // Phase 1.5: We're explicitly excluding state transitions from the control flow
  const allComponents = [
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
  
  // Enhanced handling for different component types
  switch (component.type) {
    case 'conditional': {
      const conditional = component as any;
      
      // If there are branches, the next component should be after all branches
      const thenBranch = conditional.thenBranch || [];
      const elseBranch = conditional.elseBranch || [];
      
      // Find the last component in each branch
      let lastThenComponent = thenBranch.length > 0 ? thenBranch[thenBranch.length - 1] : undefined;
      let lastElseComponent = elseBranch.length > 0 ? elseBranch[elseBranch.length - 1] : undefined;
      
      // Find the component that appears last in the source
      let lastBranchComponent: WorkflowComponent | undefined;
      
      if (lastThenComponent && lastElseComponent) {
        // Compare source locations to find the one that appears later
        const thenIndex = allComponents.findIndex(c => c === lastThenComponent);
        const elseIndex = allComponents.findIndex(c => c === lastElseComponent);
        
        lastBranchComponent = thenIndex > elseIndex ? lastThenComponent : lastElseComponent;
      } else {
        lastBranchComponent = lastThenComponent || lastElseComponent;
      }
      
      // If we found a last branch component, find the next component after it
      if (lastBranchComponent) {
        const lastIndex = allComponents.findIndex(c => c === lastBranchComponent);
        if (lastIndex !== -1 && lastIndex < allComponents.length - 1) {
          return allComponents[lastIndex + 1];
        }
      }
      break;
    }
    
    case 'loop': {
      const loop = component as any;
      
      // For loops, the next component should be after the loop body
      const body = loop.body || [];
      
      if (body.length > 0) {
        const lastBodyComponent = body[body.length - 1];
        const lastIndex = allComponents.findIndex(c => c === lastBodyComponent);
        
        if (lastIndex !== -1 && lastIndex < allComponents.length - 1) {
          return allComponents[lastIndex + 1];
        }
      }
      break;
    }
    
    case 'parallelExecution': {
      const parallel = component as any;
      
      // For parallel executions, the next component should be after all branches
      const branches = parallel.branches || [];
      let lastBranchComponent: WorkflowComponent | undefined;
      
      // Find the last component in all branches
      for (const branch of branches) {
        if (branch.length > 0) {
          const branchLastComponent = branch[branch.length - 1];
          const branchLastIndex = allComponents.findIndex(c => c === branchLastComponent);
          
          if (lastBranchComponent) {
            const lastIndex = allComponents.findIndex(c => c === lastBranchComponent);
            if (branchLastIndex > lastIndex) {
              lastBranchComponent = branchLastComponent;
            }
          } else {
            lastBranchComponent = branchLastComponent;
          }
        }
      }
      
      // If we found a last branch component, find the next component after it
      if (lastBranchComponent) {
        const lastIndex = allComponents.findIndex(c => c === lastBranchComponent);
        if (lastIndex !== -1 && lastIndex < allComponents.length - 1) {
          return allComponents[lastIndex + 1];
        }
      }
      break;
    }
  }
  
  // For other component types, find the next component that's not part of a branch
  for (let i = index + 1; i < allComponents.length; i++) {
    const nextComponent = allComponents[i];
    
    // Skip components that are part of branches if requested
    if (skipBranches) {
      // Check if this component is part of any branch using our maps
      let isInBranch = false;
      
      if (branchMaps) {
        isInBranch = branchMaps.thenBranchComponents.get(nextComponent) ||
                     branchMaps.elseBranchComponents.get(nextComponent) ||
                     branchMaps.loopBodyComponents.get(nextComponent) ||
                     branchMaps.parallelBranchComponents.get(nextComponent) ||
                     false;
      } else {
        // Fallback to checking each branch individually if maps aren't provided
        // This shouldn't happen in normal operation
        console.warn('Branch maps not provided to findNextControlFlowComponent');
        
        // Check conditionals
        for (const conditional of analysis.conditionals) {
          if ((conditional.thenBranch && conditional.thenBranch.includes(nextComponent)) ||
              (conditional.elseBranch && conditional.elseBranch.includes(nextComponent))) {
            isInBranch = true;
            break;
          }
        }
        
        // Check loops
        if (!isInBranch) {
          for (const loop of analysis.loops) {
            if (loop.body && loop.body.includes(nextComponent)) {
              isInBranch = true;
              break;
            }
          }
        }
        
        // Check parallel executions
        if (!isInBranch) {
          for (const parallel of analysis.parallelExecutions) {
            for (const branch of parallel.branches) {
              if (branch.includes(nextComponent)) {
                isInBranch = true;
                break;
              }
            }
            if (isInBranch) break;
          }
        }
      }
      
      if (isInBranch) continue;
    }
    
    return nextComponent;
  }
  
  return undefined;
}