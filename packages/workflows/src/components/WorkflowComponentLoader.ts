// @ts-nocheck
// TODO: @/empty path alias resolved at build time
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

// Define the props type based on the component's props
export type WorkflowProps = {};
export type WorkflowComponentType = ComponentType<WorkflowProps>;

// Dynamic import using the new aliasing system
export const DynamicWorkflowComponent = dynamic<WorkflowProps>(
  () => import('@alga-psa/workflows/entry')
    .then(mod => mod.DnDFlow)
    .catch(() => import('@/empty/workflows/entry').then(mod => mod.DnDFlow))
);
