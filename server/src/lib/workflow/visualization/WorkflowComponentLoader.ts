import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

// Define the props type based on the component's props
export type WorkflowProps = {};
export type WorkflowComponentType = ComponentType<WorkflowProps>;

// Dynamic import with fallback to prevent build issues when flow components are not available
export const DynamicWorkflowComponent = dynamic<WorkflowProps>(
  () => import('@ee/components/flow/DnDFlow')
    .then(mod => mod.default)
    .catch(() => import('@/empty/components/flow/DnDFlow').then(mod => mod.default))
);
