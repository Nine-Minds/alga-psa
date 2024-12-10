import { UUID } from 'crypto';
import { WorkflowExecutionGraph } from '../workflowExecutionGraph';

export interface DBWorkflow {
  id: number;
  created_at: Date;
  updated_at: Date;
  enabled: boolean;
  latest_version_id: number;
}

export interface DBWorkflowVersion {
  id: number;
  workflow_id: number;
  version: number;
  name: string;
  description: string | null;
  execution_graph: WorkflowExecutionGraph
  created_at: Date;
}

export interface DBWorkflowRun {
  id: UUID;
  workflow_id: number | null;
  status: string;
  started_at: Date;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  workflow_version_id: number | null;
}

export interface DBNodeVersion {
  id: number;
  workflow_version_id: number;
  node_id: UUID;
  type: string;
  label: string | null;
  x_position: number | null;
  y_position: number | null;
  properties: DBNodePropertyVersion[];
  created_at: Date;
}

export interface DBNode {
  id: UUID;
  workflow_id: number | null;
  created_at: Date;
  updated_at: Date;
  latest_version_id: number;
}

export interface DBRunResult {
  id: UUID;
  run_id: UUID | null;
  node_id: UUID | null;
  result: any;
  created_at: Date;
  updated_at: Date;
}

export interface DBEmailSubscription {
  id: number;
  subscription_id: string;
  workflow_id: number;
  node_id: UUID;
  created_at: Date;
  updated_at: Date;
}

export interface DBEdgeVersion {
  id: number;
  workflow_version_id: number;
  edge_id: UUID;
  source_node_id: UUID;
  source_output_id: string | null;
  target_node_id: UUID;
  target_input_id: string | null;
  created_at: Date;
}

export interface DBEdge {
  id: UUID;
  workflow_id: number | null;
  created_at: Date;
  updated_at: Date;
  latest_version_id: number;
}

export interface DBNodePropertyVersion {
  id: number;
  key: string;
  value: string | null;
}

export interface DBNodeProperty {
  id: number;
  node_id: UUID | null;
  created_at: Date;
  updated_at: Date;
  latest_version_id: number;
}

export interface DBNodeOutputVersion {
  id: number;
  node_version_id: number;
  output_key: string;
  label: string | null;
  created_at: Date;
}

export interface DBNodeOutput {
  id: number;
  node_id: UUID | null;
  created_at: Date;
  updated_at: Date;
  latest_version_id: number;
}
