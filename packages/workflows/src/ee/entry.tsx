// EE implementation for Workflow features
// This will import the actual implementation from the ee/ directory

// Direct component exports
export { default as DnDFlow } from '../../../../ee/server/src/components/flow/DnDFlow';
export const WorkflowNodes = {
  ActionNode: () => import('../../../../ee/server/src/components/flow/nodes/ActionNode'),
  DecisionNode: () => import('../../../../ee/server/src/components/flow/nodes/DecisionNode'),
  ReceiverNode: () => import('../../../../ee/server/src/components/flow/nodes/ReceiverNode'),
  TicketCreatorNode: () => import('../../../../ee/server/src/components/flow/nodes/TicketCreatorNode'),
  ClassifierNode: () => import('../../../../ee/server/src/components/flow/nodes/ClassifierNode'),
  ThinkingNode: () => import('../../../../ee/server/src/components/flow/nodes/ThinkingNode'),
  Office365ReceiverNode: () => import('../../../../ee/server/src/components/flow/nodes/Office365ReceiverNode'),
  SelectorNode: () => import('../../../../ee/server/src/components/flow/nodes/SelectorNode'),
};
export const WorkflowToggle = () => import('../../../../ee/server/src/components/flow/WorkflowToggle');

// Default export
const workflows = {
  DnDFlow: () => import('../../../../ee/server/src/components/flow/DnDFlow').then(mod => mod.default),
  WorkflowNodes: {
    ActionNode: () => import('../../../../ee/server/src/components/flow/nodes/ActionNode'),
    DecisionNode: () => import('../../../../ee/server/src/components/flow/nodes/DecisionNode'),
    ReceiverNode: () => import('../../../../ee/server/src/components/flow/nodes/ReceiverNode'),
    TicketCreatorNode: () => import('../../../../ee/server/src/components/flow/nodes/TicketCreatorNode'),
    ClassifierNode: () => import('../../../../ee/server/src/components/flow/nodes/ClassifierNode'),
    ThinkingNode: () => import('../../../../ee/server/src/components/flow/nodes/ThinkingNode'),
    Office365ReceiverNode: () => import('../../../../ee/server/src/components/flow/nodes/Office365ReceiverNode'),
    SelectorNode: () => import('../../../../ee/server/src/components/flow/nodes/SelectorNode'),
  },
  WorkflowToggle: () => import('../../../../ee/server/src/components/flow/WorkflowToggle'),
};

export default workflows;
