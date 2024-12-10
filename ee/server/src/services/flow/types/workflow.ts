import { ProtoNodeData, NodeTypes } from './nodes';

export interface WorkflowNode {
  id: string;
  type: NodeTypes;
  label: string;
  x_position: number;
  y_position: number;
  properties: NodeProperties;
  outputs: { id: string; label: string }[];
}

export type NodeProperties = 
  | Office365ReceiverProperties
  | ThinkingProperties
  | ActionProperties
  | ClassifierProperties
  | TicketCreatorProperties
  | DecisionProperties
  | SelectorProperties;

export interface Office365ReceiverProperties {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  userEmail: string;
}

export interface ThinkingProperties {
  thinkingProcess: string;
}

export interface ActionProperties {
  action: string;
}

export interface ClassifierProperties {
  thinkingProcess: string;
  classifications: string[];
}

export interface TicketCreatorProperties {
  ticketTitle: string;
  ticketDescription: string;
  ticketBoard: string;
  ticketPriority: string;
}

export interface DecisionProperties {
  conditions: {
    [outputKey: string]: {
      type: 'equals' | 'threshold' | 'regex';
      value: string;
    };
  };
  defaultOutput: string;
}

export interface SelectorProperties {
  inputs: { id: string; label: string }[];
  defaultInput: string;
}

export interface WorkflowEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  source_output_id: string | null;
  target_input_id: string | null;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  enabled?: boolean;
}
