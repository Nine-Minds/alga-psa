// EE implementation for Workflow features
// This will import the actual implementation from the ee/ directory

// Direct component exports
export { default as DnDFlow } from '../../../ee/server/src/components/workflow-designer/WorkflowDesigner';
export const WorkflowNodes = {
  ActionNode: () => import('../../../ee/server/src/components/flow/nodes/ActionNode.js'),
  DecisionNode: () => import('../../../ee/server/src/components/flow/nodes/DecisionNode.js'),
  ReceiverNode: () => import('../../../ee/server/src/components/flow/nodes/ReceiverNode.js'),
  TicketCreatorNode: () => import('../../../ee/server/src/components/flow/nodes/TicketCreatorNode.js'),
  ClassifierNode: () => import('../../../ee/server/src/components/flow/nodes/ClassifierNode.js'),
  ThinkingNode: () => import('../../../ee/server/src/components/flow/nodes/ThinkingNode.js'),
  Office365ReceiverNode: () => import('../../../ee/server/src/components/flow/nodes/Office365ReceiverNode.js'),
  SelectorNode: () => import('../../../ee/server/src/components/flow/nodes/SelectorNode.js'),
};
export const WorkflowToggle = () => import('../../../ee/server/src/components/flow/WorkflowToggle.js');

// Default export
const workflows = {
  DnDFlow: () => import('../../../ee/server/src/components/workflow-designer/WorkflowDesigner').then(mod => mod.default),
  WorkflowNodes: {
    ActionNode: () => import('../../../ee/server/src/components/flow/nodes/ActionNode.js'),
    DecisionNode: () => import('../../../ee/server/src/components/flow/nodes/DecisionNode.js'),
    ReceiverNode: () => import('../../../ee/server/src/components/flow/nodes/ReceiverNode.js'),
    TicketCreatorNode: () => import('../../../ee/server/src/components/flow/nodes/TicketCreatorNode.js'),
    ClassifierNode: () => import('../../../ee/server/src/components/flow/nodes/ClassifierNode.js'),
    ThinkingNode: () => import('../../../ee/server/src/components/flow/nodes/ThinkingNode.js'),
    Office365ReceiverNode: () => import('../../../ee/server/src/components/flow/nodes/Office365ReceiverNode.js'),
    SelectorNode: () => import('../../../ee/server/src/components/flow/nodes/SelectorNode.js'),
  },
  WorkflowToggle: () => import('../../../ee/server/src/components/flow/WorkflowToggle.js'),
};

export default workflows;
