type ActionRef = { actionId: string; version: number };

export type WorkflowBundleDependencySummaryV1 = {
  actions: ActionRef[];
  nodeTypes: string[];
  schemaRefs: string[];
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const addSchemaRefsFromDefinition = (definition: any, schemaRefs: Set<string>) => {
  if (!isPlainObject(definition)) return;
  if (typeof definition.payloadSchemaRef === 'string' && definition.payloadSchemaRef.trim()) {
    schemaRefs.add(definition.payloadSchemaRef.trim());
  }
  const trigger = definition.trigger;
  if (isPlainObject(trigger) && typeof trigger.sourcePayloadSchemaRef === 'string' && trigger.sourcePayloadSchemaRef.trim()) {
    schemaRefs.add(trigger.sourcePayloadSchemaRef.trim());
  }
};

const walkSteps = (steps: any, actions: Map<string, ActionRef>, nodeTypes: Set<string>) => {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (!isPlainObject(step)) continue;
    const type = step.type;
    if (typeof type !== 'string' || !type) continue;

    // Only node steps require node type registrations; control.* blocks are handled by the runtime itself.
    if (!type.startsWith('control.')) {
      nodeTypes.add(type);
    }

    if (type === 'action.call' && isPlainObject(step.config)) {
      const actionId = step.config.actionId;
      const version = step.config.version;
      if (typeof actionId === 'string' && actionId.trim() && (typeof version === 'number' || typeof version === 'string')) {
        const v = Number(version);
        if (Number.isFinite(v) && v > 0) {
          const normalizedId = actionId.trim();
          actions.set(`${normalizedId}@${v}`, { actionId: normalizedId, version: v });
        }
      }
    }

    // Recurse into control blocks.
    if (type === 'control.if') {
      walkSteps((step as any).then, actions, nodeTypes);
      walkSteps((step as any).else, actions, nodeTypes);
    } else if (type === 'control.forEach') {
      walkSteps((step as any).body, actions, nodeTypes);
    } else if (type === 'control.tryCatch') {
      walkSteps((step as any).try, actions, nodeTypes);
      walkSteps((step as any).catch, actions, nodeTypes);
    }
  }
};

export const collectWorkflowDefinitionDependencySummaryV1 = (definition: any): WorkflowBundleDependencySummaryV1 => {
  const actions = new Map<string, ActionRef>();
  const nodeTypes = new Set<string>();
  const schemaRefs = new Set<string>();

  addSchemaRefsFromDefinition(definition, schemaRefs);
  if (isPlainObject(definition)) {
    walkSteps((definition as any).steps, actions, nodeTypes);
  }

  return {
    actions: Array.from(actions.values()).sort((a, b) => (a.actionId === b.actionId ? a.version - b.version : a.actionId.localeCompare(b.actionId))),
    nodeTypes: Array.from(nodeTypes).sort((a, b) => a.localeCompare(b)),
    schemaRefs: Array.from(schemaRefs).sort((a, b) => a.localeCompare(b))
  };
};

export const mergeDependencySummariesV1 = (
  summaries: WorkflowBundleDependencySummaryV1[]
): WorkflowBundleDependencySummaryV1 => {
  const actions = new Map<string, ActionRef>();
  const nodeTypes = new Set<string>();
  const schemaRefs = new Set<string>();

  for (const summary of summaries) {
    for (const action of summary.actions) actions.set(`${action.actionId}@${action.version}`, action);
    for (const nodeType of summary.nodeTypes) nodeTypes.add(nodeType);
    for (const schemaRef of summary.schemaRefs) schemaRefs.add(schemaRef);
  }

  return {
    actions: Array.from(actions.values()).sort((a, b) => (a.actionId === b.actionId ? a.version - b.version : a.actionId.localeCompare(b.actionId))),
    nodeTypes: Array.from(nodeTypes).sort((a, b) => a.localeCompare(b)),
    schemaRefs: Array.from(schemaRefs).sort((a, b) => a.localeCompare(b))
  };
};

