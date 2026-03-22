type JsonSchema = {
  [key: string]: unknown;
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  $ref?: string;
  definitions?: Record<string, JsonSchema>;
};

export type WorkflowDesignerCatalogKind = 'core-object' | 'transform' | 'app' | 'ai';

export type WorkflowDesignerCatalogAction = {
  id: string;
  version: number;
  label: string;
  description?: string;
  inputFieldNames: string[];
  outputFieldNames: string[];
};

export type WorkflowDesignerCatalogRecord = {
  groupKey: string;
  label: string;
  iconToken: string;
  tileKind: WorkflowDesignerCatalogKind;
  allowedActionIds: string[];
  defaultActionId?: string;
  description?: string;
  actions: WorkflowDesignerCatalogAction[];
};

export type WorkflowDesignerCatalogSourceAction = {
  id: string;
  version: number;
  ui?: {
    label?: string;
    description?: string;
    category?: string;
    icon?: string;
  };
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
};

type BuiltInCatalogSeed = {
  groupKey: string;
  label: string;
  iconToken: string;
  tileKind: Extract<WorkflowDesignerCatalogKind, 'core-object' | 'transform' | 'ai'>;
  description: string;
  defaultActionId?: string;
  modules?: string[];
  actionIds?: string[];
};

const BUILT_IN_CATALOG_SEEDS: BuiltInCatalogSeed[] = [
  {
    groupKey: 'ticket',
    label: 'Ticket',
    iconToken: 'ticket',
    tileKind: 'core-object',
    description: 'Create, find, update, assign, and manage tickets.',
    defaultActionId: 'tickets.create',
    modules: ['tickets']
  },
  {
    groupKey: 'contact',
    label: 'Contact',
    iconToken: 'contact',
    tileKind: 'core-object',
    description: 'Find and search contacts for downstream workflow steps.',
    defaultActionId: 'contacts.find',
    modules: ['contacts']
  },
  {
    groupKey: 'client',
    label: 'Client',
    iconToken: 'client',
    tileKind: 'core-object',
    description: 'Find and search clients from the PSA client directory.',
    defaultActionId: 'clients.find',
    modules: ['clients']
  },
  {
    groupKey: 'communication',
    label: 'Communication',
    iconToken: 'communication',
    tileKind: 'core-object',
    description: 'Send customer-facing or internal communications.',
    defaultActionId: 'email.send',
    modules: ['email', 'notifications']
  },
  {
    groupKey: 'scheduling',
    label: 'Scheduling',
    iconToken: 'scheduling',
    tileKind: 'core-object',
    description: 'Assign and update scheduled work.',
    defaultActionId: 'scheduling.assign_user',
    modules: ['scheduling']
  },
  {
    groupKey: 'project',
    label: 'Project',
    iconToken: 'project',
    tileKind: 'core-object',
    description: 'Create and manage project work items.',
    defaultActionId: 'projects.create_task',
    modules: ['projects']
  },
  {
    groupKey: 'time',
    label: 'Time',
    iconToken: 'time',
    tileKind: 'core-object',
    description: 'Create and manage time tracking entries.',
    defaultActionId: 'time.create_entry',
    modules: ['time']
  },
  {
    groupKey: 'crm',
    label: 'CRM',
    iconToken: 'crm',
    tileKind: 'core-object',
    description: 'Create and track CRM activity records.',
    defaultActionId: 'crm.create_activity_note',
    modules: ['crm']
  },
  {
    groupKey: 'transform',
    label: 'Transform',
    iconToken: 'transform',
    tileKind: 'transform',
    description: 'Shape and normalize workflow data without raw expressions.',
    modules: ['transform']
  },
  {
    groupKey: 'ai',
    label: 'AI',
    iconToken: 'ai',
    tileKind: 'ai',
    description: 'Infer structured workflow data with the configured AI provider.',
    defaultActionId: 'ai.infer',
    actionIds: ['ai.infer']
  }
];

const BUILT_IN_MODULE_TO_GROUP = new Map<string, BuiltInCatalogSeed>();
for (const seed of BUILT_IN_CATALOG_SEEDS) {
  for (const moduleName of seed.modules ?? []) {
    BUILT_IN_MODULE_TO_GROUP.set(moduleName, seed);
  }
}

const getActionModuleName = (actionId: string): string => actionId.split('.')[0]?.trim().toLowerCase() ?? '';

const toTitleCase = (value: string): string =>
  value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const resolveSchema = (schema: JsonSchema | undefined, root?: JsonSchema): JsonSchema | undefined => {
  if (!schema) return undefined;

  if (schema.$ref && root?.definitions) {
    const refKey = schema.$ref.replace('#/definitions/', '');
    const resolved = root.definitions?.[refKey];
    if (resolved) return resolveSchema(resolved, root);
  }

  if (schema.anyOf?.length) {
    const nonNullVariant = schema.anyOf.find((variant) => {
      if (!variant?.type) return true;
      if (Array.isArray(variant.type)) return variant.type.some((entry) => entry !== 'null');
      return variant.type !== 'null';
    });
    if (nonNullVariant) return resolveSchema(nonNullVariant, root);
  }

  if (schema.oneOf?.length) {
    const firstVariant = schema.oneOf[0];
    if (firstVariant) return resolveSchema(firstVariant, root);
  }

  return schema;
};

const extractTopLevelFieldNames = (schema: JsonSchema | undefined): string[] => {
  const resolved = resolveSchema(schema, schema);
  if (!resolved?.properties) return [];
  return Object.keys(resolved.properties).sort((left, right) => left.localeCompare(right));
};

const toCatalogAction = (action: WorkflowDesignerCatalogSourceAction): WorkflowDesignerCatalogAction => ({
  id: action.id,
  version: action.version,
  label: action.ui?.label?.trim() || action.id,
  description: action.ui?.description?.trim() || undefined,
  inputFieldNames: extractTopLevelFieldNames(action.inputSchema),
  outputFieldNames: extractTopLevelFieldNames(action.outputSchema)
});

export const buildWorkflowDesignerActionCatalog = (
  actions: WorkflowDesignerCatalogSourceAction[]
): WorkflowDesignerCatalogRecord[] => {
  const catalogActions = actions
    .map((action) => ({
      source: action,
      moduleName: getActionModuleName(action.id),
      catalogAction: toCatalogAction(action)
    }));

  const records: WorkflowDesignerCatalogRecord[] = BUILT_IN_CATALOG_SEEDS.map((seed) => {
    const matchingActions = catalogActions
      .filter(({ source, moduleName }) => {
        if (seed.actionIds?.includes(source.id)) return true;
        if (seed.modules?.includes(moduleName)) return true;
        return false;
      })
      .map(({ catalogAction }) => catalogAction)
      .sort((left, right) => left.label.localeCompare(right.label));

    return {
      groupKey: seed.groupKey,
      label: seed.label,
      iconToken: seed.iconToken,
      tileKind: seed.tileKind,
      allowedActionIds: matchingActions.map((action) => action.id),
      defaultActionId: seed.defaultActionId,
      description: seed.description,
      actions: matchingActions
    };
  });

  const builtInActionIds = new Set(records.flatMap((record) => record.allowedActionIds));

  const appRecords = new Map<string, WorkflowDesignerCatalogRecord>();
  for (const { source, moduleName, catalogAction } of catalogActions) {
    if (builtInActionIds.has(source.id)) continue;

    const normalizedModuleName = moduleName || source.id.trim().toLowerCase();
    if (!normalizedModuleName) continue;

    const groupKey = `app:${normalizedModuleName}`;
    const existing = appRecords.get(groupKey);
    if (existing) {
      existing.allowedActionIds.push(source.id);
      existing.actions.push(catalogAction);
      continue;
    }

    const label = toTitleCase(normalizedModuleName);
    appRecords.set(groupKey, {
      groupKey,
      label,
      iconToken: source.ui?.icon?.trim() || 'app',
      tileKind: 'app',
      allowedActionIds: [source.id],
      description: `App actions exposed by ${label}.`,
      actions: [catalogAction]
    });
  }

  const sortedAppRecords = Array.from(appRecords.values())
    .map((record) => ({
      ...record,
      allowedActionIds: [...record.allowedActionIds].sort((left, right) => left.localeCompare(right)),
      actions: [...record.actions].sort((left, right) => left.label.localeCompare(right.label))
    }))
    .sort((left, right) => left.label.localeCompare(right.label));

  return [...records, ...sortedAppRecords];
};

export const getWorkflowDesignerCatalogRecordForAction = (
  catalog: WorkflowDesignerCatalogRecord[],
  actionId: string | null | undefined
): WorkflowDesignerCatalogRecord | undefined => {
  if (!actionId) return undefined;
  return catalog.find((record) => record.allowedActionIds.includes(actionId));
};

export const isBuiltInWorkflowDesignerGroup = (groupKey: string): boolean =>
  BUILT_IN_CATALOG_SEEDS.some((seed) => seed.groupKey === groupKey);

export const getBuiltInWorkflowDesignerCatalogSeed = (moduleName: string): BuiltInCatalogSeed | undefined =>
  BUILT_IN_MODULE_TO_GROUP.get(moduleName.trim().toLowerCase());
