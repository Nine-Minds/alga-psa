import { WorkflowAnalysis, WorkflowComponent } from '../types/astTypes';
import ELK from 'elkjs/lib/elk.bundled';

/**
 * Node type for React Flow
 */
export interface FlowNode {
  id: string;
  type: string;
  data: any;
  position: { x: number; y: number };
}

/**
 * Edge type for React Flow
 */
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  label?: string;
  animated?: boolean;
  style?: Record<string, any>;
  data?: Record<string, any>;
  markerEnd?: string;
  markerStart?: string;
  labelStyle?: Record<string, any>;
  labelBgStyle?: Record<string, any>; // Added for label background styling
}

/**
 * Complete flow graph for React Flow
 */
export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/**
 * Build a flow graph from a workflow analysis
 * 
 * @param analysis The workflow analysis
 * @returns A flow graph for React Flow
 */
export function buildFlowGraph(analysis: WorkflowAnalysis): FlowGraph {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const componentToNodeId = new Map<WorkflowComponent, string>();
  
  // Sort all components by source location to maintain source code order
  // Filter out parallel execution nodes as requested
  const allComponents: {component: WorkflowComponent, type: string, index: number}[] = [
    ...analysis.actions.map((comp, index) => ({component: comp, type: 'action', index})),
    ...analysis.events.map((comp, index) => ({component: comp, type: 'event', index})),
    ...analysis.conditionals.map((comp, index) => ({component: comp, type: 'conditional', index})),
    ...analysis.loops.map((comp, index) => ({component: comp, type: 'loop', index}))
    // Parallel executions are filtered out
  ].sort((a, b) => {
    // Sort by line number first
    if (a.component.sourceLocation.line !== b.component.sourceLocation.line) {
      return a.component.sourceLocation.line - b.component.sourceLocation.line;
    }
    // If line numbers are the same, sort by character position
    return a.component.sourceLocation.character - b.component.sourceLocation.character;
  });
  
  console.log('Sorted components by source location:',
    allComponents.map(c => `${c.type} at line ${c.component.sourceLocation.line}:${c.component.sourceLocation.character}`));
  
  // Track nodes by source location to prevent duplicates
  const nodesBySourceLocation = new Map<string, string>();

  // Phase 1.5 Enhancement: Focus exclusively on control flow elements and completely ignore state transitions
  // This creates a true Control Flow Graph (CFG) that represents the actual code execution flow
  // rather than a hierarchical AST-style visualization
  
  // Helper function to get a unique ID for a component based on source location
  const getUniqueComponentId = (component: WorkflowComponent, type: string, index: number): string => {
    // For actions, include the action name in the key to ensure unique IDs for different actions
    // This is crucial for scenarios like runA() and runB() which might have similar source locations
    const sourceLocationKey = type === 'action'
      ? `${type}-${(component as any).actionName}-${component.sourceLocation.line}-${component.sourceLocation.character}`
      : `${component.sourceLocation.line}-${component.sourceLocation.character}`;
    
    // If we already have a node for this source location, return its ID
    if (nodesBySourceLocation.has(sourceLocationKey)) {
      return nodesBySourceLocation.get(sourceLocationKey)!;
    }
    
    // Otherwise, create a new ID
    const id = type === 'action'
      ? `${type}-${(component as any).actionName}-${component.sourceLocation.line}-${component.sourceLocation.character}`
      : `${type}-${component.sourceLocation.line}-${component.sourceLocation.character}`;
    
    nodesBySourceLocation.set(sourceLocationKey, id);
    return id;
  };

  // First, identify components that have multiple incoming paths
  // This helps us create more accurate node IDs and better visualize merge points in the control flow
  const incomingPaths = new Map<WorkflowComponent, number>();

  analysis.controlFlow.forEach(flow => {
    // Skip any control flow relationships that involve state transitions
    // This ensures we're only visualizing actual code control flow
    if (flow.from.type === 'stateTransition' || flow.to.type === 'stateTransition') {
      return;
    }

    // Count incoming paths for each component
    const count = incomingPaths.get(flow.to) || 0;
    incomingPaths.set(flow.to, count + 1);
  });

  // Create a unique identifier for each component
  // This is important for ensuring consistent node references in the graph
  const getComponentId = (component: WorkflowComponent, type: string, index: number): string => {
    // Use our helper function to get a unique ID based on source location
    return getUniqueComponentId(component, type, index);
  };

  // Create nodes for all components in source code order
  allComponents.forEach(({component, type, index}, orderIndex) => {
    // Skip if we've already created a node for this component
    if (componentToNodeId.has(component)) {
      return;
    }

    const id = getComponentId(component, type, index);
    
    // Check if we already have a node with this ID
    if (!nodes.some(node => node.id === id)) {
      // Create node based on component type
      switch (type) {
        case 'action': {
          const action = component as any;
          nodes.push({
            id,
            type: 'action',
            data: {
              label: action.actionName,
              actionName: action.actionName,
              arguments: action.arguments,
              sourceLocation: action.sourceLocation,
              status: 'default'
            },
            // Use orderIndex primarily for y-coordinate and let ELK handle x-coordinate
            // This gives ELK more flexibility to arrange nodes in a left-to-right flow
            position: { x: 0, y: orderIndex * 80 }
          });
          break;
        }
        case 'event': {
          const event = component as any;
          const isWaiting = event.type === 'eventWaiting';
          nodes.push({
            id,
            type: 'event',
            data: {
              label: isWaiting
                ? `Wait for ${event.eventNames.join(' or ')}`
                : `Emit ${event.eventName}`,
              eventType: isWaiting ? 'waiting' : 'emission',
              eventNames: isWaiting ? event.eventNames : [event.eventName],
              sourceLocation: event.sourceLocation,
              status: 'default'
            },
            // Use orderIndex primarily for y-coordinate and let ELK handle x-coordinate
            position: { x: 0, y: orderIndex * 80 }
          });
          break;
        }
        case 'conditional': {
          const conditional = component as any;
          nodes.push({
            id,
            type: 'conditional',
            data: {
              label: `If ${conditional.condition}`,
              condition: conditional.condition,
              sourceLocation: conditional.sourceLocation,
              status: 'default',
              // Add information about branches for debugging
              thenBranch: conditional.thenBranch.map((c: any) => c.type + (c.type === 'actionCall' ? ` (${c.actionName})` : '')),
              elseBranch: conditional.elseBranch ? conditional.elseBranch.map((c: any) => c.type + (c.type === 'actionCall' ? ` (${c.actionName})` : '')) : []
            },
            // Use orderIndex primarily for y-coordinate and let ELK handle x-coordinate
            position: { x: 0, y: orderIndex * 80 }
          });
          break;
        }
        case 'loop': {
          const loop = component as any;
          nodes.push({
            id,
            type: 'loop',
            data: {
              label: `${loop.loopType} ${loop.condition}`,
              loopType: loop.loopType,
              condition: loop.condition,
              sourceLocation: loop.sourceLocation,
              status: 'default'
            },
            // Use orderIndex primarily for y-coordinate and let ELK handle x-coordinate
            position: { x: 0, y: orderIndex * 80 }
          });
          break;
        }
        // Parallel execution nodes are filtered out
      }
    }
    
    componentToNodeId.set(component, id);
  });

  // Create edges from control flow relationships
  // Track edges to avoid duplicates
  const edgeMap = new Map<string, boolean>();
  // Create a map to track connections through parallel nodes
  const parallelConnections = new Map<string, string[]>();
  
  // First pass: identify connections through parallel nodes
  analysis.controlFlow.forEach((flow, index) => {
    if (flow.from.type === 'parallelExecution' || flow.to.type === 'parallelExecution') {
      const parallelId = flow.from.type === 'parallelExecution' ?
        componentToNodeId.get(flow.from) :
        componentToNodeId.get(flow.to);
      
      if (parallelId) {
        const sourceId = componentToNodeId.get(flow.from);
        const targetId = componentToNodeId.get(flow.to);
        
        if (sourceId && targetId) {
          // If this is a connection from a node to a parallel node
          if (flow.from.type !== 'parallelExecution') {
            if (!parallelConnections.has(sourceId)) {
              parallelConnections.set(sourceId, []);
            }
            // Store the parallel node ID
            parallelConnections.get(sourceId)!.push(parallelId);
          }
          
          // If this is a connection from a parallel node to another node
          if (flow.to.type !== 'parallelExecution') {
            // For each node that connects to this parallel node
            parallelConnections.forEach((targets, source) => {
              if (targets.includes(parallelId)) {
                // Create a direct connection from the source to the target
                const directEdgeKey = `${source}-${targetId}-sequential`;
                if (!edgeMap.has(directEdgeKey)) {
                  edges.push({
                    id: `edge-direct-${source}-${targetId}`,
                    source: source,
                    target: targetId,
                    type: 'sequential',
                    animated: false,
                    style: {
                      stroke: '#000000',
                      strokeWidth: 2.5
                    },
                    markerEnd: 'arrowclosed',
                    data: {
                      flowType: 'sequential',
                      sourceType: 'unknown',
                      targetType: 'unknown'
                    }
                  });
                  edgeMap.set(directEdgeKey, true);
                }
              }
            });
          }
        }
      }
      
      // Skip this edge since it involves a parallel node
      return;
    }
    
    // Skip edges that involve state transitions
    if (flow.from.type === 'stateTransition' || flow.to.type === 'stateTransition') {
      return;
    }

    const sourceId = componentToNodeId.get(flow.from);
    let targetId = componentToNodeId.get(flow.to);
    if (flow.type === 'conditional') {
      const conditionalComponent = flow.from;
      if (flow.condition === 'true') {
        if ('thenBranch' in conditionalComponent && Array.isArray((conditionalComponent as any).thenBranch) && (conditionalComponent as any).thenBranch.length > 0) {
          const trueTargetId = componentToNodeId.get((conditionalComponent as any).thenBranch[0]);
          if (trueTargetId) {
            targetId = trueTargetId;
          }
        }
      } else if (flow.condition === 'false') {
          // For the false branch, we need to handle the case where there's no explicit else branch
          // In this case, we need to find the component that runs after the if block
          
          // First, check if there's an explicit else branch
          if ('elseBranch' in conditionalComponent && Array.isArray((conditionalComponent as any).elseBranch) && (conditionalComponent as any).elseBranch.length > 0) {
              // Use the first component in the else branch
              const falseTargetId = componentToNodeId.get((conditionalComponent as any).elseBranch[0]);
              if (falseTargetId) {
                  targetId = falseTargetId;
              }
          } else {
              // No else branch - we need to find what runs after the if block
              // This is the key fix: we need to find the component that follows the entire if statement
              
              // Look for sequential flows that come after components in the then branch
              // or directly after the conditional itself
              let nextComponentAfterIf: any | null = null;
              
              // Get all components sorted by source location
              // This is a more reliable way to find the next component after the if block
              const allComponentsSorted = [
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
              const conditionalIndex = allComponentsSorted.findIndex(c => c === conditionalComponent);
              
              // Get the then branch components
              const thenBranchComponents = 'thenBranch' in conditionalComponent &&
                  Array.isArray((conditionalComponent as any).thenBranch) ?
                  (conditionalComponent as any).thenBranch : [];
              
              if (thenBranchComponents.length > 0) {
                  // Find the last component in the then branch
                  const lastThenComponent = thenBranchComponents[thenBranchComponents.length - 1];
                  // Find the index of the last then component
                  const lastThenComponentIndex = allComponentsSorted.findIndex(c => c === lastThenComponent);
                  // Find the next component after the last then component
                  if (lastThenComponentIndex !== -1 && lastThenComponentIndex < allComponentsSorted.length - 1) {
                      // The next component after the last then component is our target
                      nextComponentAfterIf = allComponentsSorted[lastThenComponentIndex + 1];
                  }
              } else {
                  // If there's no then branch, find the next component after the conditional
                  if (conditionalIndex !== -1 && conditionalIndex < allComponentsSorted.length - 1) {
                      nextComponentAfterIf = allComponentsSorted[conditionalIndex + 1];
                  }
              }
              
              // If we still couldn't find the next component, try the original approach
              if (!nextComponentAfterIf) {
                  // First, try to find sequential flows from the last component in the then branch
                  if (thenBranchComponents.length > 0) {
                      const lastThenComponent = thenBranchComponents[thenBranchComponents.length - 1];
                      
                      // Find sequential flows from the last then component
                      const sequentialFlowsFromThen = analysis.controlFlow.filter(f =>
                          f.type === 'sequential' && f.from === lastThenComponent
                      );
                      
                      if (sequentialFlowsFromThen.length > 0) {
                          nextComponentAfterIf = sequentialFlowsFromThen[0].to;
                      }
                  }
                  
                  // If we couldn't find a sequential flow from the then branch,
                  // look for sequential flows directly from the conditional
                  if (!nextComponentAfterIf) {
                      const sequentialFlowsFromConditional = analysis.controlFlow.filter(f =>
                          f.type === 'sequential' && f.from === conditionalComponent
                      );
                      
                      if (sequentialFlowsFromConditional.length > 0) {
                          nextComponentAfterIf = sequentialFlowsFromConditional[0].to;
                      }
                  }
              }
              
              // If we found a component that follows the if block, use it as the target
              if (nextComponentAfterIf) {
                  const afterIfId = componentToNodeId.get(nextComponentAfterIf);
                  if (afterIfId) {
                      targetId = afterIfId;
                  }
              }
          }
      }
    }

    if (sourceId && targetId) {
      // Create a unique key for this edge to avoid duplicates
      // For conditional edges, include the condition in the key to allow multiple conditional edges
      // between the same nodes with different conditions (e.g., true/false)
      const edgeKey = flow.type === 'conditional'
        ? `${sourceId}-${targetId}-${flow.type}-${flow.condition}`
        : `${sourceId}-${targetId}-${flow.type}`;
      
      // Skip if we already have this edge
      if (edgeMap.has(edgeKey)) {
        return;
      }
      
      const id = `edge-${index}`;
      
      // Determine the edge type based on flow type
      const edgeType = flow.type === 'sequential' ? 'controlFlow' : flow.type;
      
      // Set up edge styling with conditional variations
      let edgeStyle: any = {};
      let markerEnd: string | undefined = undefined;
      
      if (flow.type === 'conditional') {
        const isTrue = flow.condition === 'true';
        
        edgeStyle = {
          stroke: isTrue ? '#4CAF50' : '#F44336',
          strokeWidth: isTrue ? 2 : 2.5,
          strokeDasharray: isTrue ? '5,5' : ''
        };
        
        // Add arrow marker for false edges
        if (!isTrue) {
          markerEnd = 'arrowclosed';
        }
      } else {
        // Default styling for non-conditional edges
        edgeStyle = {
          stroke: getEdgeColorForType(flow.type),
          strokeWidth: getEdgeThicknessForType(flow.type)
        };
      }
      
      // Create edge with enhanced properties and explicit handle connections
      // Determine handle connections based on edge type
      let sourceHandle: string | undefined = undefined; // Default to automatic connection
      let targetHandle: string | undefined = undefined; // Default to automatic connection
      
      // For conditional edges, we want to explicitly connect to the target's input
      // This ensures proper visualization of true/false paths
      if (flow.type === 'conditional') {
        // Use different source handles for true and false branches
        if (flow.condition === 'true') {
          // Connect from the conditional node's true output handle (top right)
          sourceHandle = 'right-true';
        } else if (flow.condition === 'false') {
          // Connect from the conditional node's false output handle (bottom right)
          sourceHandle = 'right-false';
        } else {
          // Fallback to the default right handle
          sourceHandle = 'right';
        }
        
        // Connect to the target node's input handle (left side)
        targetHandle = 'left';
        
        // Log the handle assignments for debugging
        console.log(`Conditional edge ${flow.condition}: connecting ${sourceId} (handle: ${sourceHandle}) to ${targetId} (handle: ${targetHandle})`);
      }
      
      // For sequential edges, connect from source output to target input
      if (flow.type === 'sequential') {
        sourceHandle = 'right';
        targetHandle = 'left';
        
        // Log the handle assignments for debugging
        console.log(`Sequential edge: connecting ${sourceId} (handle: ${sourceHandle}) to ${targetId} (handle: ${targetHandle})`);
      }
      
      const edge = {
        id,
        source: sourceId,
        target: targetId,
        // Specify explicit handles for better control of connection points
        sourceHandle,
        targetHandle,
        type: edgeType,
        label: flow.condition,
        // Set animated to true for conditional edges with condition "false"
        animated: flow.type === 'conditional' && flow.condition === 'false',
        style: edgeStyle,
        markerEnd,
        data: {
          flowType: flow.type,
          condition: flow.condition,
          sourceType: flow.from.type,
          targetType: flow.to.type,
          // Explicitly add condition for edge component to access
          label: flow.condition,
          // Add handle information for easier debugging
          sourceHandle,
          targetHandle
        }
      };
      
      edges.push(edge);
      
      // Mark this edge as created
      edgeMap.set(edgeKey, true);
    }
  });

  // Add entry point identification
  // This helps visualize where the workflow execution begins
  if (nodes.length > 0) {
    // Find nodes that have no incoming edges - these are entry points
    const entryNodes = nodes.filter(node =>
      !edges.some(edge => edge.target === node.id)
    );
    
    if (entryNodes.length > 0) {
      // Mark entry nodes with a special property for styling
      entryNodes.forEach(node => {
        node.data.isEntryPoint = true;
        // Could also add visual distinction here if needed
        // e.g., node.data.label = `▶ ${node.data.label}`;
      });
    }
  }

  return { nodes, edges };
}

// Helper function to get edge color based on type
// This provides visual distinction between different types of control flow
function getEdgeColorForType(type: string): string {
  switch (type) {
    case 'sequential': return '#000000'; // Black for normal flow - more prominent
    case 'conditional': return '#3498db'; // Blue for conditional branches
    case 'loop': return '#e74c3c';       // Red for loops
    case 'parallel': return '#2ecc71';   // Green for parallel execution
    default: return '#cccccc';           // Light gray fallback
  }
}

// Helper function to get edge thickness based on type
// This makes important control flow edges more prominent
function getEdgeThicknessForType(type: string): number {
  switch (type) {
    case 'sequential': return 2.5;      // Thicker for sequential flow to emphasize CFG
    case 'conditional': return 2;       // Thicker for conditional branches
    case 'loop': return 2.5;            // Even thicker for loops
    case 'parallel': return 2;          // Thicker for parallel execution
    default: return 1;                  // Default thickness
  }
}
/**
 * Apply a layout algorithm using ELK.js to the flow graph
 *
 * ELK.js is a powerful graph layout library that provides sophisticated algorithms
 * for arranging nodes in hierarchical diagrams. It's particularly well-suited for
 * workflow visualizations with complex control flow patterns.
 *
 * @param graph The flow graph to layout
 * @returns A Promise resolving to the flow graph with updated positions
 */
export async function applyElkLayout(graph: FlowGraph): Promise<FlowGraph> {
  // Create a new ELK instance
  const elk = new ELK();
  
  // Convert our graph to ELK format
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      // Use layered algorithm which is better for control flow graphs
      'elk.algorithm': 'layered',
      // Force LEFT_TO_RIGHT direction for better control flow visualization
      'elk.direction': 'RIGHT',
      // Spacing between nodes for readability
      'elk.spacing.nodeNode': '150',
      'elk.layered.spacing.nodeNodeBetweenLayers': '200',
      // Use POLYLINE routing for smoother edges
      'elk.edgeRouting': 'POLYLINE',
      // Edge spacing to avoid overlaps
      'elk.spacing.edgeEdge': '80',
      'elk.spacing.edgeNode': '80',
      // Use NETWORK_SIMPLEX strategy to enforce left-to-right flow
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      // Strongly consider the order of nodes in the model
      'elk.layered.considerModelOrder': 'true',
      // Use LAYER_SWEEP for better edge direction consistency
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      // Use NETWORK_SIMPLEX for better representation of sequential flow
      'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
      // Improve edge routing for control flow
      'elk.layered.edgeRouting': 'POLYLINE',
      // Improve node placement for control flow
      'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
      // Handle cycles (loops) properly
      'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
      'elk.layered.feedbackEdges': 'true',
      // Prioritize straightness of edges
      'elk.layered.unnecessaryBendpoints': 'true',
      // Disable wrapping to keep the graph as a single unit
      'elk.layered.wrapping.strategy': 'OFF',
      // Ensure edges point in the right direction
      'elk.edgeRouting.splines.mode': 'STRAIGHT',
      // Prioritize edge direction consistency
      'elk.layered.priority.direction': 'true',
      // Node and edge label placement
      'elk.nodeLabels.placement': 'INSIDE V_CENTER H_CENTER',
      'elk.edgeLabels.placement': 'CENTER'
    },
    children: graph.nodes.map(node => ({
      id: node.id,
      width: 250, // Increased default width
      height: 100, // Increased default height
      // Adjust size based on node type
      ...(node.type === 'conditional' && { width: 280, height: 120 }),
      ...(node.type === 'loop' && { width: 280, height: 120 }),
      ...(node.type === 'parallel' && { width: 300, height: 150 }),
      ...(node.type === 'action' && { width: 280, height: 120 }),
      ...(node.type === 'event' && { width: 300, height: 120 }),
      layoutOptions: {
        // Enhanced layout options for different node types to better represent control flow
        ...(node.type === 'conditional' && {
          'elk.partitioning.partition': '1',
          'elk.position': 'DECISION_POINT'
        }),
        ...(node.type === 'loop' && {
          'elk.partitioning.partition': '2',
          'elk.position': 'CYCLE_BREAK'
        }),
        ...(node.type === 'parallel' && {
          'elk.partitioning.partition': '3',
          'elk.position': 'FORK_JOIN'
        }),
        // Make action nodes more prominent in the flow
        ...(node.type === 'action' && {
          'elk.position': 'ACTIVITY'
        })
      }
    })),
    edges: graph.edges.map(edge => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
      layoutOptions: {
        // Enhanced edge layout options for better control flow representation
        ...(edge.type === 'conditional' && {
          'elk.edge.type': 'ASSOCIATION',
          'elk.edge.priority': '10' // Higher priority for conditional edges
        }),
        ...(edge.type === 'loop' && {
          'elk.edge.type': 'DEPENDENCY',
          'elk.edge.priority': '15' // Highest priority for loop edges
        }),
        ...(edge.type === 'parallel' && {
          'elk.edge.type': 'ASSOCIATION',
          'elk.edge.priority': '10' // Higher priority for parallel edges
        }),
        // Sequential edges should have lower priority
        ...(edge.type === 'sequential' && {
          'elk.edge.type': 'DEPENDENCY',
          'elk.edge.priority': '5'
        })
      }
    }))
  };
  
  try {
    // Calculate layout using ELK
    const elkLayoutResult = await elk.layout(elkGraph);
    
    // Apply the calculated positions to our graph
    if (elkLayoutResult.children) {
      elkLayoutResult.children.forEach(elkNode => {
        const node = graph.nodes.find(n => n.id === elkNode.id);
        if (node && elkNode.x !== undefined && elkNode.y !== undefined) {
          node.position = {
            x: elkNode.x,
            y: elkNode.y
          };
        }
      });
    }
    
    return graph;
  } catch (error) {
    console.error('ELK layout error:', error);
    // No fallback to legacy layout - just return the graph as is
    return graph;
  } finally {
    // Apply additional styling to edges to make the control flow more visually distinct
    graph.edges.forEach(edge => {
      // Add animated property and styling for loop back edges and animated edges
      if (edge.data?.condition === 'end' && edge.type === 'loop') {
        edge.animated = true;
        edge.style = {
          ...edge.style,
          stroke: '#e74c3c',
          strokeWidth: 3,
          strokeDasharray: '5,5' // Dashed line for loop back edges
        };
      } else if (edge.animated) {
        // Apply blue color to animated edges (like false conditional edges)
        edge.style = {
          ...edge.style,
          stroke: '#3498db', // Blue for animated edges
          strokeWidth: 3
        };
      }
      
      // Add styling for conditional edges
      if (edge.type === 'conditional') {
        // Make true/false branches visually distinct
        if (edge.label === 'true') {
          // True edges should not be animated
          edge.animated = false;
          edge.style = {
            ...edge.style,
            stroke: '#4CAF50', // Green for true
            strokeWidth: 2.5
          };
          // Add label styling
          edge.labelStyle = {
            fill: '#4CAF50',
            fontWeight: 'bold'
          };
          edge.labelBgStyle = {
            fill: '#E8F5E9',
            fillOpacity: 0.8,
            rx: 5,
            ry: 5
          };
        } else if (edge.label === 'false') {
          // Enhanced styling for false edges to make them more prominent
          edge.style = {
            ...edge.style,
            stroke: '#F44336', // Red for false
            strokeWidth: 2.5,
            // Use empty string for solid line instead of null
            strokeDasharray: ''
          };
          // Add label styling
          edge.labelStyle = {
            fill: '#F44336',
            fontWeight: 'bold'
          };
          edge.labelBgStyle = {
            fill: '#FFEBEE',
            fillOpacity: 0.8,
            rx: 5,
            ry: 5
          };
          // Add marker end for false edges to make direction clearer
          edge.markerEnd = 'arrowclosed';
        }
        
        // Add debug info to edge data
        edge.data = {
          ...edge.data,
          isConditional: true,
          condition: edge.label
        };
      }
      
      // Add styling for parallel edges
      if (edge.type === 'parallel') {
        edge.style = {
          ...edge.style,
          strokeWidth: 2.5,
          stroke: '#2ecc71' // Green for parallel
        };
      }
      
      // Add styling for sequential edges
      if (edge.type === 'sequential') {
        edge.style = {
          ...edge.style,
          strokeWidth: 2.5,
          stroke: '#000000', // Black for sequential - more prominent
          strokeLinecap: 'round' // Rounded ends for better appearance
        };
        
        // Add arrow markers for direction
        edge.markerEnd = 'arrowclosed';
      }
    });
  }
}

// The legacy directed layout algorithm has been removed
// We now exclusively use ELK.js for layout

/**
 * Apply the layout algorithm to the control flow graph
 *
 * This function serves as the main entry point for layout application.
 * It exclusively uses ELK.js for layout, with no fallback to legacy algorithms.
 *
 * Phase 1.5 Enhancement: This function now applies a layout that emphasizes
 * the control flow nature of the graph, with a left-to-right flow direction
 * and special handling for different types of control flow elements.
 *
 * @param graph The control flow graph to layout
 * @returns The control flow graph with updated positions
 */
export async function applyLayout(graph: FlowGraph): Promise<FlowGraph> {
  try {
    // Use ELK.js for layout - the only layout algorithm we now support
    return await applyElkLayout(graph);
  } catch (error) {
    console.error('Error applying ELK layout:', error);
    // If ELK fails, return the graph without layout changes
    return graph;
  }
}
