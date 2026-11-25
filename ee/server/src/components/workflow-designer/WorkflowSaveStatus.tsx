'use client';

import React from 'react';
import {
  DesignerSaveStatus,
  describeSavedAgo,
  getDesignerSaveState,
  type DesignerSaveState,
} from '@alga-psa/ui/components/designer';

export type WorkflowSaveState = DesignerSaveState;

export const getWorkflowSaveState = getDesignerSaveState;
export { describeSavedAgo };

/** The shared save status, bound to the workflow designer's namespace and element id. */
export const WorkflowSaveStatus: React.FC<{ state: WorkflowSaveState }> = ({ state }) => (
  <DesignerSaveStatus state={state} i18nNamespace="msp/workflows" id="workflow-designer-save-status" />
);

export default WorkflowSaveStatus;
