import { Node as ReactFlowNode, NodeProps as ReactFlowNodeProps } from 'reactflow';
import * as Proto from '../../../generated/workflow';

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
  | Proto.ProtoNodeTypes_Office365ReceiverNodeData
  | Proto.ProtoNodeTypes_ThinkingNodeData
  | Proto.ProtoNodeTypes_ActionNodeData
  | Proto.ProtoNodeTypes_ClassifierNodeData
  | Proto.ProtoNodeTypes_SpecialOperationNodeData
  | Proto.ProtoNodeTypes_SelectorNodeData
  | Proto.ProtoNodeTypes_DecisionNodeData
  | Proto.ProtoNodeTypes_TicketCreatorNodeData;

export interface CustomNode extends ReactFlowNode {
  type: NodeTypes;
  data: ProtoNodeData;
}

export interface CustomNodeProps extends ReactFlowNodeProps {
  id: string;
  type: NodeTypes;
  data: ProtoNodeData;
}
