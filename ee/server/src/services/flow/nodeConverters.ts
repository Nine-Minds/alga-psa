import { 
  ThinkingNodeData,
  ActionNodeData,
  Office365ReceiverNodeData,
  ClassifierNodeData,
  TicketCreatorNodeData,
  DecisionNodeData,
  SelectorNodeData,
  Condition,
  ConditionType,
  Template,
  createSystemType
} from './types/workflowTypes';
import { createOutput, createInput } from './types/protoTypes';
import { ActionProperties, NodeProperties, ThinkingProperties, WorkflowNode, Office365ReceiverProperties, DecisionProperties, TicketCreatorProperties, ClassifierProperties, SelectorProperties } from './types/workflow';
import { ProtoNodeData, NodeTypes } from './types/nodes';

function createTemplate(value: string): Template {
  return { template: value, type: { value: '' } };
}

export function convertWorkflowNodeToCustomNodeData(node: WorkflowNode): ProtoNodeData {
  switch (node.type) {
    case 'thinking':
      return {
        label: node.label,
        outputs: node.outputs,
        thinkingProcess: createTemplate((node.properties as ThinkingProperties).thinkingProcess),
      } as ThinkingNodeData;
    case 'action':
      return {
        label: node.label,
        outputs: node.outputs,
        action: createTemplate((node.properties as ActionProperties).action),
      } as ActionNodeData;
    case 'office365Receiver':
      return {
        label: node.label,
        outputs: node.outputs.map(output => createOutput(output.id, output.label, 'Email')),
        clientId: createTemplate((node.properties as Office365ReceiverProperties).clientId),
        clientSecret: createTemplate((node.properties as Office365ReceiverProperties).clientSecret),
        tenantId: createTemplate((node.properties as Office365ReceiverProperties).tenantId),
        userEmail: createTemplate((node.properties as Office365ReceiverProperties).userEmail),
      } as Office365ReceiverNodeData;
    case 'classifier':
      return {
        label: node.label,
        outputs: node.outputs.map(output => createOutput(output.id, output.label, 'String')),
        thinkingProcess: createTemplate((node.properties as ClassifierProperties).thinkingProcess),
        source: createTemplate(''),
        classifications: ((node.properties as ClassifierProperties).classifications || []).map(c => createTemplate(c)),
      } as ClassifierNodeData;
    case 'ticketCreator':
      return {
        label: node.label,
        outputs: node.outputs.map(output => createOutput(output.id, output.label, 'Ticket')),
        ticketTitle: createTemplate((node.properties as TicketCreatorProperties).ticketTitle),
        ticketDescription: createTemplate((node.properties as TicketCreatorProperties).ticketDescription),
        ticketBoard: createTemplate((node.properties as TicketCreatorProperties).ticketBoard),
        ticketPriority: createTemplate((node.properties as TicketCreatorProperties).ticketPriority),
      } as TicketCreatorNodeData;
    case 'decision':
      const decisionProps = node.properties as DecisionProperties;
      const conditions: Record<string, Condition> = {};
      
      for (const [key, value] of Object.entries(decisionProps.conditions)) {
        conditions[key] = {
          type: getConditionType(value.type),
          value: createTemplate(value.value),
        };
      }
      
      return {
        label: node.label,
        outputs: node.outputs.map(output => createOutput(output.id, output.label, 'String')),
        conditions: conditions,
        defaultOutput: createTemplate(decisionProps.defaultOutput),
      } as DecisionNodeData;
   
    case 'selector':
      return {
        label: node.label,
        outputs: node.outputs.map(output => createOutput(output.id, output.label, 'Variant')),
        inputs: ((node.properties as SelectorProperties).inputs || []).map(input => createInput(input.id, input.label)),
        defaultInput: createTemplate((node.properties as SelectorProperties).defaultInput),
      } as SelectorNodeData;
    default:
      throw new Error(`Unsupported node type: ${node.type}`);
  }
}

function getConditionType(type: string): ConditionType {
  switch (type.toUpperCase()) {
    case 'EQUALS':
      return ConditionType.EQUALS;
    case 'THRESHOLD':
      return ConditionType.THRESHOLD;
    case 'REGEX':
      return ConditionType.REGEX;
    default:
      throw new Error(`Unsupported condition type: ${type}`);
  }
}

export function convertCustomNodeDataToProperties(data: Record<string, any>, type: NodeTypes): NodeProperties {
  switch (type) {
    case 'office365Receiver':
      return {
        clientId: data.clientId?.template || '',
        clientSecret: data.clientSecret?.template || '',
        tenantId: data.tenantId?.template || '',
        userEmail: data.userEmail?.template || '',
      };
    case 'classifier':
      return {
        thinkingProcess: data.thinkingProcess?.template || '',
        classifications: (data.classifications || []).map((c: Template) => c.template),
      };
    case 'selector':
      return {
        inputs: data.inputs || [],
        defaultInput: data.defaultInput?.template || '',
      };
    case 'thinking':
      return {
        thinkingProcess: data.thinkingProcess?.template || '',
      };
    case 'action':
      return {
        action: data.action?.template || '',
      };
    case 'decision':
      const conditions: DecisionProperties['conditions'] = {};
      for (const [key, value] of Object.entries(data.conditions || {})) {
        const condition = value as Condition;
        conditions[key] = {
          type: condition.type.toLowerCase() as 'equals' | 'threshold' | 'regex',
          value: condition.value?.template || '',
        };
      }
      return {
        conditions,
        defaultOutput: data.defaultOutput?.template || '',
      };
    case 'ticketCreator':
      return {
        ticketTitle: data.ticketTitle?.template || '',
        ticketDescription: data.ticketDescription?.template || '',
        ticketBoard: data.ticketBoard?.template || '',
        ticketPriority: data.ticketPriority?.template || '',
      };
    default:
      throw new Error(`Unsupported node type: ${type}`);
  }
}
