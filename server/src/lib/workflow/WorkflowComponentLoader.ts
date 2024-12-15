import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

// Import only the default export for type
import type DndFlow from '@ee/components/flow/DnDFlow';

// Define the props type based on the component's props
export type WorkflowProps = React.ComponentProps<typeof DndFlow>;
export type WorkflowComponentType = typeof DndFlow;

// Dynamic import will resolve to either the EE component or the CE empty component
// based on the webpack alias configuration
export const DynamicWorkflowComponent = dynamic<WorkflowProps>(
  () => import('@ee/components/flow/DnDFlow').then(mod => mod.default),
  { ssr: false }
);
