import { 
  ProtoNodeTypes,
  ProtoNodeTypes_ThinkingNodeData,
  ProtoNodeTypes_ActionNodeData,
  ProtoNodeTypes_Office365ReceiverNodeData,
  ProtoNodeTypes_ClassifierNodeData,
  ProtoNodeTypes_TicketCreatorNodeData,
  ProtoNodeTypes_DecisionNodeData,
  ProtoNodeTypes_SelectorNodeData,
  ProtoNodeTypes_Condition,
  ProtoNodeTypes_Condition_ConditionType,
  Template
} from '../../generated/workflow';
import { createOutput, createInput } from './types/protoTypes';
import { ActionProperties, NodeProperties, ThinkingProperties, WorkflowNode, Office365ReceiverProperties, DecisionProperties, TicketCreatorProperties, ClassifierProperties, SelectorProperties } from './types/workflow';
import { ProtoNodeData, NodeTypes } from './types/nodes';

export function convertWorkflowNodeToCustomNodeData(node: WorkflowNode): ProtoNodeData {
  switch (node.type) {
    case 'thinking':
      return ProtoNodeTypes_ThinkingNodeData.create({
        label: node.label,
        outputs: node.outputs,
        thinkingProcess: {template: (node.properties as ThinkingProperties).thinkingProcess as string, stringType: {}},
      });
    case 'action':
      return ProtoNodeTypes_ActionNodeData.create({
        label: node.label,
        outputs: node.outputs,
        action: {template: (node.properties as ActionProperties).action as string, stringType: {}},
      });
    case 'office365Receiver':
      return ProtoNodeTypes_Office365ReceiverNodeData.create({
        label: node.label,
        outputs: node.outputs.map(output => createOutput(output.id, output.label, 'Email')),
        clientId: {template: (node.properties as Office365ReceiverProperties).clientId, stringType: {}},
        clientSecret: {template: (node.properties as Office365ReceiverProperties).clientSecret, stringType: {}},
        tenantId: {template: (node.properties as Office365ReceiverProperties).tenantId, stringType: {}},
        userEmail: {template: (node.properties as Office365ReceiverProperties).userEmail, stringType: {}},
      });
    case 'classifier':
      return ProtoNodeTypes_ClassifierNodeData.create({
        label: node.label,
        outputs: node.outputs.map(output => createOutput(output.id, output.label, 'String')),
        thinkingProcess: {template: (node.properties as ClassifierProperties).thinkingProcess, stringType: {}},
        classifications: [] //{template: (node.properties as ClassifierProperties).classifications as string[],
      });
      case 'ticketCreator':
        return ProtoNodeTypes_TicketCreatorNodeData.create({
          label: node.label,
          outputs: node.outputs.map(output => createOutput(output.id, output.label, 'Ticket')),
          ticketTitle: {template: (node.properties as TicketCreatorProperties).ticketTitle, stringType: {}},
          ticketDescription: {template: (node.properties as TicketCreatorProperties).ticketDescription, stringType: {}},
          ticketBoard: {template: (node.properties as TicketCreatorProperties).ticketBoard, stringType: {}},
          ticketPriority: {template: (node.properties as TicketCreatorProperties).ticketPriority, stringType: {}},
        });
    case 'decision':
      const decisionProps = node.properties as DecisionProperties;
      const conditions: { [key: string]: ProtoNodeTypes_Condition } = {};
      
      for (const [key, value] of Object.entries(decisionProps.conditions)) {
        conditions[key] = ProtoNodeTypes_Condition.create({
            type: getConditionType(value.type),
            value: {'template': value.value, stringType: {}},
          });
      }
      
      return ProtoNodeTypes_DecisionNodeData.create({
        label: node.label,
        outputs: node.outputs.map(output => createOutput(output.id, output.label, 'String')),
        conditions: conditions,
        defaultOutput: {'template': decisionProps.defaultOutput, stringType: {}},
      });
   
    case 'selector':
      return ProtoNodeTypes_SelectorNodeData.create({
        label: node.label,
        outputs: node.outputs.map(output => createOutput(output.id, output.label, 'Variant')),
        inputs: ((node.properties as SelectorProperties).inputs as {id: string, label: string}[]).map(input => createInput(input.id, input.label)),
        defaultInput: {'template': (node.properties as SelectorProperties).defaultInput as string, stringType: {}}
      });
    default:
      throw new Error(`Unsupported node type: ${node.type}`);
  }
}

function getConditionType(type: string): ProtoNodeTypes_Condition_ConditionType {
  switch (type.toUpperCase()) {
    case 'EQUALS':
      return ProtoNodeTypes_Condition_ConditionType.EQUALS;
    case 'THRESHOLD':
      return ProtoNodeTypes_Condition_ConditionType.THRESHOLD;
    case 'REGEX':
      return ProtoNodeTypes_Condition_ConditionType.REGEX;
    default:
      throw new Error(`Unsupported condition type: ${type}`);
  }
}

export function convertCustomNodeDataToProperties(data: Record<string, any>, type: NodeTypes): NodeProperties {
  switch (type) {
    case 'office365Receiver':
      return {
        clientId: data.clientId,
        clientSecret: data.clientSecret,
        tenantId: data.tenantId,
        userEmail: data.userEmail,
      };
    case 'classifier':
      return {
        thinkingProcess: data.thinkingProcess,
        classifications: data.classifications,
      };
    case 'selector':
      return {
        inputs: data.inputs,
        defaultInput: data.defaultInput,
      };
    case 'thinking':
      return {
        thinkingProcess: data.thinkingProcess,
      };
    case 'action':
      return {
        action: data.action,
      };
    case 'decision':
      return {
        conditions: data.conditions,
        defaultOutput: data.defaultOutput,
      };
    case 'ticketCreator':
      // Assuming ticketCreator is a special type of action node
      return {
        action: 'Create Ticket',
        // Include any specific ticketCreator properties here
      };
    default:
      throw new Error(`Unsupported node type: ${type}`);
  }
}
