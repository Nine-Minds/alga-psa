import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

// Import only the default export for type
import type DndFlow from 'services/workflow-worker/src/placeholder/components/flow/DnDFlow';

// Define the props type based on the component's props
export type WorkflowProps = {};
export type WorkflowComponentType = typeof DndFlow;

// Dynamic import will resolve to either the EE component or the CE empty component
// based on the webpack alias configuration
export const DynamicWorkflowComponent = dynamic<WorkflowProps>(
  () => import('ee/server/src/components/flow/DnDFlow').then(mod => mod.default),
  { ssr: false }
);
