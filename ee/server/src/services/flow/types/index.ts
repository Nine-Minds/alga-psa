export * from './db-models';
export * from './workflow';
export * from './nodes';

// Re-export API types with DB models
import { 
  DBWorkflow, 
  DBWorkflowVersion, 
  DBNodeVersion, 
  DBNodePropertyVersion, 
  DBNodeOutputVersion,
  DBEdgeVersion 
} from './db-models';

export interface WorkflowVersionResponse extends Omit<DBWorkflowVersion, 'nodes' | 'edges'> {
  workflow: Omit<DBWorkflow, 'latest_version_id'>;
  nodes: (Omit<DBNodeVersion, 'properties' | 'outputs'> & {
    properties: DBNodePropertyVersion[];
    outputs: DBNodeOutputVersion[];
  })[];
  edges: DBEdgeVersion[];
}
