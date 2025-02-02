import { Node as ReactFlowNode, NodeProps as ReactFlowNodeProps } from 'reactflow';
import {
  Office365ReceiverNodeData,
  ThinkingNodeData,
  ActionNodeData,
  ClassifierNodeData,
  SpecialOperationNodeData,
  SelectorNodeData,
  DecisionNodeData,
  TicketCreatorNodeData
} from '@ee/services/flow/types/workflowTypes';

export interface PickerOption {
  id: string;
  label: string;
}

export interface PickerProps {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
}

export type NodeTypes = 
  | 'thinking' 
  | 'action' 
  | 'office365Receiver' 
  | 'classifier' 
  | 'ticketCreator' 
  | 'decision' 
  | 'selector';

export type ProtoNodeData = 
  | Office365ReceiverNodeData
  | ThinkingNodeData
  | ActionNodeData
  | ClassifierNodeData
  | SpecialOperationNodeData
  | SelectorNodeData
  | DecisionNodeData
  | TicketCreatorNodeData;

export interface CustomNode extends ReactFlowNode {
  type: NodeTypes;
  data: ProtoNodeData;
}

export interface CustomNodeProps extends ReactFlowNodeProps {
  id: string;
  type: NodeTypes;
  data: ProtoNodeData;
}
