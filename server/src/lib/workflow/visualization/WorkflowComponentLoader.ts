import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

// Define the props type based on the component's props
export type WorkflowProps = {};
export type WorkflowComponentType = ComponentType<WorkflowProps>;

// Dynamic import using the new aliasing system
export const DynamicWorkflowComponent = dynamic<WorkflowProps>(
  () => import('@product/workflows/entry')
    .then(mod => mod.DnDFlow)
    .catch(() => import('@/empty/components/flow/DnDFlow').then(mod => mod.default))
);
