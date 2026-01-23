/**
 * Types for React Flow visualization of workflow definitions
 */
import { Node, Edge } from 'reactflow';
import { SourceLocation, WorkflowComponent } from './astTypes';

/**
 * Node data for state nodes
 */
export interface StateNodeData {
  label: string;
  stateName: string;
  sourceLocation?: SourceLocation;
  status: 'default' | 'active' | 'success' | 'error' | 'warning';
}

/**
 * Node data for action nodes
 */
export interface ActionNodeData {
  label: string;
  actionName: string;
  arguments?: any[];
  sourceLocation?: SourceLocation;
  status: 'default' | 'active' | 'success' | 'error' | 'warning';
  result?: any;
}

/**
 * Node data for event nodes
 */
export interface EventNodeData {
  label: string;
  eventType: 'waiting' | 'emission';
  eventNames: string[];
  sourceLocation?: SourceLocation;
  status: 'default' | 'active' | 'success' | 'error' | 'warning';
}

/**
 * Node data for conditional nodes
 */
export interface ConditionalNodeData {
  label: string;
  condition: string;
  sourceLocation?: SourceLocation;
  status: 'default' | 'active' | 'success' | 'error' | 'warning';
}

/**
 * Node data for loop nodes
 */
export interface LoopNodeData {
  label: string;
  loopType: 'for' | 'while' | 'doWhile';
  condition: string;
  sourceLocation?: SourceLocation;
  status: 'default' | 'active' | 'success' | 'error' | 'warning';
}

/**
 * Node data for parallel execution nodes
 */
export interface ParallelNodeData {
  label: string;
  branchCount: number;
  sourceLocation?: SourceLocation;
  status: 'default' | 'active' | 'success' | 'error' | 'warning';
}

/**
 * Union type for all node data types
 */
export type WorkflowNodeData =
  | StateNodeData
  | ActionNodeData
  | EventNodeData
  | ConditionalNodeData
  | LoopNodeData
  | ParallelNodeData;

/**
 * Common properties that can be added to any node data type
 */
export interface CommonNodeData {
  isEntryPoint?: boolean;
  depth?: number;
  rank?: number;
}

// Extend each node data type with common properties
export type ExtendedStateNodeData = StateNodeData & CommonNodeData;
export type ExtendedActionNodeData = ActionNodeData & CommonNodeData;
export type ExtendedEventNodeData = EventNodeData & CommonNodeData;
export type ExtendedConditionalNodeData = ConditionalNodeData & CommonNodeData;
export type ExtendedLoopNodeData = LoopNodeData & CommonNodeData;
export type ExtendedParallelNodeData = ParallelNodeData & CommonNodeData;

// Update the union type
export type ExtendedWorkflowNodeData =
  | ExtendedStateNodeData
  | ExtendedActionNodeData
  | ExtendedEventNodeData
  | ExtendedConditionalNodeData
  | ExtendedLoopNodeData
  | ExtendedParallelNodeData;

/**
 * Flow node type for React Flow
 */
export interface FlowNode {
  id: string;
  type: 'state' | 'action' | 'event' | 'conditional' | 'loop' | 'parallel';
  data: ExtendedWorkflowNodeData;
  position: { x: number; y: number };
  selected?: boolean;
  dragging?: boolean;
}

/**
 * Flow edge type for React Flow
 */
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string; // Added for connecting to specific source handles
  targetHandle?: string; // Added for connecting to specific target handles
  type?: 'controlFlow' | 'conditional' | 'loop' | 'parallel' | 'smoothstep';
  label?: string;
  animated?: boolean;
  style?: Record<string, any>;
  selected?: boolean;
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
 * Runtime status for workflow execution
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
  }>;
}

/**
 * Props for the WorkflowVisualizer component
 */
export interface WorkflowVisualizerProps {
  workflowDefinitionId: string;
  executionId?: string;
  height?: number | string;
  width?: number | string;
  showControls?: boolean;
  showLegend?: boolean;
  pollInterval?: number;
  initialDefinition?: any;
  initialExecutionStatus?: any;
  workflowDSL?: string;
}