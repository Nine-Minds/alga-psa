import { getWorkflowExecutionStatus } from '@product/actions/workflow-visualization-actions';
import {
  FlowGraph,
  FlowNode,
  StateNodeData,
  ActionNodeData,
  EventNodeData,
  ConditionalNodeData,
  LoopNodeData,
  ParallelNodeData
} from '../types/visualizationTypes';

/**
 * Runtime status interface
 */
export interface RuntimeStatus {
  execution: {
    execution_id: string;
    workflow_name: string;
    current_state: string;
    status: string;
  };
  events: Array<{
    event_id: string;
    event_name: string;
    from_state: string;
    to_state: string;
  }>;
  actionResults: Array<{
    action_name: string;
    success: boolean;
    error_message?: string;
    result?: any;
  }>;
}

/**
 * Type guards for node data types
 */
function isStateNodeData(data: any): data is StateNodeData {
  return data && typeof data.stateName === 'string';
}

function isActionNodeData(data: any): data is ActionNodeData {
  return data && typeof data.actionName === 'string';
}

function isEventNodeData(data: any): data is EventNodeData {
  return data && typeof data.eventType === 'string' && Array.isArray(data.eventNames);
}

/**
 * Fetch runtime status for a workflow execution
 * This function now just calls the server action directly
 *
 * @param executionId The execution ID
 * @returns The runtime status or null if not found
 */
export async function fetchRuntimeStatus(executionId: string): Promise<RuntimeStatus | null> {
  try {
    // Fetch execution state using the server action
    const status = await getWorkflowExecutionStatus(executionId);
    return status;
  } catch (error) {
    console.error(`Failed to fetch runtime status: ${error}`);
    throw error;
  }
}

/**
 * Apply runtime status to a flow graph
 *
 * @param graph The flow graph
 * @param status The runtime status
 * @returns The updated flow graph
 */
export function applyRuntimeStatus(graph: FlowGraph, status: RuntimeStatus): FlowGraph {
  if (!status) return graph;
  
  // Create a new graph with updated status
  const updatedNodes = graph.nodes.map(node => {
    // Default status
    let nodeStatus: 'default' | 'active' | 'success' | 'error' | 'warning' = 'default';
    
    // Handle different node types
    if (node.type === 'state') {
      // State node
      const stateData = node.data as StateNodeData;
      if (stateData.stateName === status.execution.current_state) {
        nodeStatus = 'active';
      }
      
      return {
        ...node,
        data: {
          ...stateData,
          status: nodeStatus
        }
      };
    }
    else if (node.type === 'action') {
      // Action node
      const actionData = node.data as ActionNodeData;
      const actionResult = status.actionResults.find(ar => ar.action_name === actionData.actionName);
      if (actionResult) {
        nodeStatus = actionResult.success ? 'success' : 'error';
        
        return {
          ...node,
          data: {
            ...actionData,
            status: nodeStatus,
            result: actionResult.result,
            errorMessage: actionResult.error_message
          }
        };
      }
      
      return {
        ...node,
        data: {
          ...actionData,
          status: nodeStatus
        }
      };
    }
    else if (node.type === 'event') {
      // Event node
      const eventData = node.data as EventNodeData;
      if (eventData.eventType === 'waiting') {
        // Check if any of the events this node is waiting for have been processed
        const eventProcessed = status.events.some(e =>
          eventData.eventNames.includes(e.event_name)
        );
        if (eventProcessed) {
          nodeStatus = 'success';
        }
      } else if (eventData.eventType === 'emission') {
        // Check if this event has been emitted
        const eventEmitted = status.events.some(e =>
          eventData.eventNames.includes(e.event_name)
        );
        if (eventEmitted) {
          nodeStatus = 'success';
        }
      }
      
      return {
        ...node,
        data: {
          ...node.data,
          status: nodeStatus
        }
      };
    }
    
    // For other node types, just update the status
    return {
      ...node,
      data: {
        ...node.data,
        status: nodeStatus
      }
    };
  });
  
  // Update edges based on control flow
  const updatedEdges = graph.edges.map(edge => {
    // Determine if this edge has been traversed
    const isTraversed = determineEdgeTraversal(edge, status, graph);
    
    return {
      ...edge,
      animated: isTraversed,
      style: {
        ...edge.style,
        stroke: isTraversed ? '#3498db' : (edge.style?.stroke || '#ccc'),
        strokeWidth: isTraversed ? 2 : (edge.style?.strokeWidth || 1)
      }
    };
  });
  
  return {
    nodes: updatedNodes,
    edges: updatedEdges
  };
}

/**
 * Determine if an edge has been traversed based on runtime status
 *
 * @param edge The edge to check
 * @param status The runtime status
 * @param graph The flow graph
 * @returns True if the edge has been traversed
 */
function determineEdgeTraversal(edge: any, status: RuntimeStatus, graph: FlowGraph): boolean {
  // If no events, the edge hasn't been traversed
  if (!status.events || status.events.length === 0) return false;
  
  const sourceNode = graph.nodes.find(n => n.id === edge.source);
  const targetNode = graph.nodes.find(n => n.id === edge.target);
  
  if (!sourceNode || !targetNode) return false;
  
  // Check for state transitions
  if (sourceNode.type === 'state' && targetNode.type === 'state') {
    const sourceData = sourceNode.data as StateNodeData;
    const targetData = targetNode.data as StateNodeData;
    
    // Check if there's a direct state transition from source to target
    const directTransition = status.events.some(event =>
      sourceData.stateName === event.from_state &&
      targetData.stateName === event.to_state
    );
    
    if (directTransition) return true;
    
    // If the target state is the current state, animate the edge
    if (targetData.stateName === status.execution.current_state) {
      return true;
    }
  }
  
  // Check for action execution
  if (targetNode.type === 'action') {
    const targetData = targetNode.data as ActionNodeData;
    
    const actionResult = status.actionResults.find(ar =>
      ar.action_name === targetData.actionName
    );
    return !!actionResult;
  }
  
  // Check for event waiting
  if (targetNode.type === 'event') {
    const targetData = targetNode.data as EventNodeData;
    
    if (targetData.eventType === 'waiting') {
      return status.events.some(event =>
        targetData.eventNames.includes(event.event_name)
      );
    }
  }
  
  // For edges connected to the current state, animate them
  if (sourceNode.type === 'state') {
    const sourceData = sourceNode.data as StateNodeData;
    if (sourceData.stateName === status.execution.current_state) {
      return true;
    }
  }
  
  // For edges connected to nodes with success status, animate them
  if (sourceNode.data.status === 'success' || targetNode.data.status === 'success') {
    return true;
  }
  
  // For other edge types, we can't easily determine if they've been traversed
  return false;
}