import { getActionRegistryV2, getNodeTypeRegistry, getSchemaRegistry, initializeWorkflowRuntimeV2 } from '@shared/workflow/runtime';
import type { WorkflowBundleV1 } from '@shared/workflow/bundle/workflowBundleV1';
import { WorkflowBundleImportError } from './workflowBundleImportErrors';

export type WorkflowBundleMissingDependencies = {
  workflowKey: string;
  missingActions: Array<{ actionId: string; version: number }>;
  missingNodeTypes: string[];
  missingSchemaRefs: string[];
};

export const validateWorkflowBundleDependenciesV1 = (bundle: WorkflowBundleV1): void => {
  initializeWorkflowRuntimeV2();

  const actionRegistry = getActionRegistryV2();
  const nodeRegistry = getNodeTypeRegistry();
  const schemaRegistry = getSchemaRegistry();

  const missingByWorkflow: WorkflowBundleMissingDependencies[] = [];

  for (const wf of bundle.workflows) {
    const missingActions = wf.dependencies.actions.filter((a) => !actionRegistry.get(a.actionId, a.version));
    // Control blocks (control.if/control.tryCatch/control.return/etc.) are built into the runtime
    // and are not registered as node types. Do not treat them as missing dependencies.
    const missingNodeTypes = wf.dependencies.nodeTypes.filter((t) => !t.startsWith('control.') && !nodeRegistry.get(t));
    const missingSchemaRefs = wf.dependencies.schemaRefs.filter((ref) => !schemaRegistry.has(ref));

    if (missingActions.length || missingNodeTypes.length || missingSchemaRefs.length) {
      missingByWorkflow.push({
        workflowKey: wf.key,
        missingActions,
        missingNodeTypes,
        missingSchemaRefs
      });
    }
  }

  if (!missingByWorkflow.length) return;

  const aggregateActions = new Map<string, { actionId: string; version: number }>();
  const aggregateNodeTypes = new Set<string>();
  const aggregateSchemaRefs = new Set<string>();

  for (const entry of missingByWorkflow) {
    for (const a of entry.missingActions) aggregateActions.set(`${a.actionId}@${a.version}`, a);
    for (const t of entry.missingNodeTypes) aggregateNodeTypes.add(t);
    for (const r of entry.missingSchemaRefs) aggregateSchemaRefs.add(r);
  }

  throw new WorkflowBundleImportError('MISSING_DEPENDENCIES', 'Workflow bundle has missing runtime dependencies.', {
    status: 400,
    details: {
      missingByWorkflow,
      missingActions: Array.from(aggregateActions.values()),
      missingNodeTypes: Array.from(aggregateNodeTypes),
      missingSchemaRefs: Array.from(aggregateSchemaRefs)
    }
  });
};
