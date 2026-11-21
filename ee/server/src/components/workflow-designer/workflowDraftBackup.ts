/**
 * The workflow designer's local draft backup: the shared implementation, bound to this
 * designer's storage namespace.
 */
import {
  clearDesignerDraftBackup,
  designerDraftBackupKey,
  readDesignerDraftBackup,
  shouldOfferDesignerDraftBackup,
  writeDesignerDraftBackup,
  type DesignerDraftBackup,
} from '@alga-psa/ui/components/designer';

const NAMESPACE = 'workflowDesigner';

export type WorkflowDraftBackup<TDefinition = unknown> = DesignerDraftBackup<TDefinition>;

export const workflowDraftBackupKey = (workflowId: string | null | undefined): string =>
  designerDraftBackupKey(NAMESPACE, workflowId);

export const writeWorkflowDraftBackup = <TDefinition>(
  workflowId: string | null | undefined,
  backup: WorkflowDraftBackup<TDefinition>
): void => writeDesignerDraftBackup(NAMESPACE, workflowId, backup);

export const readWorkflowDraftBackup = <TDefinition>(
  workflowId: string | null | undefined
): WorkflowDraftBackup<TDefinition> | null => readDesignerDraftBackup<TDefinition>(NAMESPACE, workflowId);

export const clearWorkflowDraftBackup = (workflowId: string | null | undefined): void =>
  clearDesignerDraftBackup(NAMESPACE, workflowId);

export const shouldOfferWorkflowDraftBackup = shouldOfferDesignerDraftBackup;
