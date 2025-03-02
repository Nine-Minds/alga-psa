import { WorkflowAnalysis, WorkflowComponent } from '../types/astTypes';

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
  
  // Create nodes for state transitions
  analysis.states.forEach((state, index) => {
    const id = `state-${index}`;
    nodes.push({
      id,
      type: 'state',
      data: {
        label: state.stateName,
        stateName: state.stateName,
        sourceLocation: state.sourceLocation,
        status: 'default'
      },
      position: { x: 0, y: index * 100 } // Initial position, will be adjusted by layout
    });
    componentToNodeId.set(state, id);
  });
  
  // Create nodes for action calls
  analysis.actions.forEach((action, index) => {
    const id = `action-${index}`;
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
      position: { x: 150, y: index * 100 } // Initial position, will be adjusted by layout
    });
    componentToNodeId.set(action, id);
  });
  
  // Create nodes for event operations
  analysis.events.forEach((event, index) => {
    const id = `event-${index}`;
    const isWaiting = event.type === 'eventWaiting';
    
    nodes.push({
      id,
      type: 'event',
      data: {
        label: isWaiting 
          ? `Wait for ${(event as any).eventNames.join(' or ')}` 
          : `Emit ${(event as any).eventName}`,
        eventType: isWaiting ? 'waiting' : 'emission',
        eventNames: isWaiting ? (event as any).eventNames : [(event as any).eventName],
        sourceLocation: event.sourceLocation,
        status: 'default'
      },
      position: { x: 300, y: index * 100 } // Initial position, will be adjusted by layout
    });
    componentToNodeId.set(event, id);
  });
  
  // Create nodes for conditionals
  analysis.conditionals.forEach((conditional, index) => {
    const id = `conditional-${index}`;
    nodes.push({
      id,
      type: 'conditional',
      data: {
        label: `If ${conditional.condition}`,
        condition: conditional.condition,
        sourceLocation: conditional.sourceLocation,
        status: 'default'
      },
      position: { x: 450, y: index * 100 } // Initial position, will be adjusted by layout
    });
    componentToNodeId.set(conditional, id);
  });
  
  // Create nodes for loops
  analysis.loops.forEach((loop, index) => {
    const id = `loop-${index}`;
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
      position: { x: 600, y: index * 100 } // Initial position, will be adjusted by layout
    });
    componentToNodeId.set(loop, id);
  });
  
  // Create nodes for parallel executions
  analysis.parallelExecutions.forEach((parallel, index) => {
    const id = `parallel-${index}`;
    nodes.push({
      id,
      type: 'parallel',
      data: {
        label: `Parallel Execution`,
        branchCount: parallel.branches.length,
        sourceLocation: parallel.sourceLocation,
        status: 'default'
      },
      position: { x: 750, y: index * 100 } // Initial position, will be adjusted by layout
    });
    componentToNodeId.set(parallel, id);
  });
  
  // Create edges from control flow
  analysis.controlFlow.forEach((flow, index) => {
    const sourceId = componentToNodeId.get(flow.from);
    const targetId = componentToNodeId.get(flow.to);
    
    if (sourceId && targetId) {
      const id = `edge-${index}`;
      edges.push({
        id,
        source: sourceId,
        target: targetId,
        type: flow.type === 'sequential' ? 'controlFlow' : flow.type,
        label: flow.condition,
        animated: false,
        style: {
          stroke: '#ccc'
        }
      });
    }
  });
  
  return { nodes, edges };
}

/**
 * Apply a simple automatic layout to the flow graph
 * 
 * @param graph The flow graph to layout
 * @returns The flow graph with updated positions
 */
export function applySimpleLayout(graph: FlowGraph): FlowGraph {
  // This is a very simple layout that just arranges nodes in a grid
  // A more sophisticated layout algorithm would be used in a real implementation
  
  const nodesByType: Record<string, FlowNode[]> = {};
  
  // Group nodes by type
  graph.nodes.forEach(node => {
    if (!nodesByType[node.type]) {
      nodesByType[node.type] = [];
    }
    nodesByType[node.type].push(node);
  });
  
  // Position nodes in columns by type
  const columnWidth = 250;
  const rowHeight = 100;
  const types = ['state', 'action', 'event', 'conditional', 'loop', 'parallel'];
  
  types.forEach((type, columnIndex) => {
    const nodes = nodesByType[type] || [];
    nodes.forEach((node, rowIndex) => {
      node.position = {
        x: columnIndex * columnWidth,
        y: rowIndex * rowHeight
      };
    });
  });
  
  return {
    nodes: graph.nodes,
    edges: graph.edges
  };
}