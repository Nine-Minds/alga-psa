import React from 'react';

// OSS stub implementation for Workflow features
export const DnDFlow = () => {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Enterprise Feature</h2>
        <p className="text-gray-600">
          Workflow designer requires Enterprise Edition. Please upgrade to access this feature.
        </p>
      </div>
    </div>
  );
};

export const WorkflowNodes = {
  ActionNode: () => (
    <div className="p-4 border rounded">
      <p className="text-sm text-gray-600">Enterprise Feature Required</p>
    </div>
  ),
  DecisionNode: () => (
    <div className="p-4 border rounded">
      <p className="text-sm text-gray-600">Enterprise Feature Required</p>
    </div>
  ),
  ReceiverNode: () => (
    <div className="p-4 border rounded">
      <p className="text-sm text-gray-600">Enterprise Feature Required</p>
    </div>
  ),
  TicketCreatorNode: () => (
    <div className="p-4 border rounded">
      <p className="text-sm text-gray-600">Enterprise Feature Required</p>
    </div>
  ),
};

export const WorkflowToggle = () => {
  return (
    <div className="flex items-center justify-center h-32">
      <div className="text-center">
        <p className="text-gray-600">
          Workflow toggle requires Enterprise Edition.
        </p>
      </div>
    </div>
  );
};

// Default export
export default {
  DnDFlow,
  WorkflowNodes,
  WorkflowToggle,
};

