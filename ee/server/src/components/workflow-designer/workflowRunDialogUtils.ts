type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

export type EventCatalogEntryLite = {
  event_type: string;
  name: string;
  description?: string | null;
  category?: string | null;
  tenant?: string | null;
};

export type SchemaDiffSummary = {
  onlyInEvent: string[];
  onlyInPayload: string[];
  requiredOnlyInEvent: string[];
  requiredOnlyInPayload: string[];
  typeMismatches: Array<{ field: string; eventType?: string; payloadType?: string }>;
};

const normalizeType = (schema?: JsonSchema | null) => {
  if (!schema?.type) return undefined;
  return Array.isArray(schema.type) ? schema.type[0] : schema.type;
};

export const filterEventCatalogEntries = (
  entries: EventCatalogEntryLite[],
  search: string
) => {
  const term = search.trim().toLowerCase();
  if (!term) return entries;
  return entries.filter((entry) => (
    entry.event_type.toLowerCase().includes(term)
    || entry.name.toLowerCase().includes(term)
    || (entry.category ?? '').toLowerCase().includes(term)
    || (entry.description ?? '').toLowerCase().includes(term)
  ));
};

export const getSchemaDiffSummary = (
  payloadSchema?: JsonSchema | null,
  eventSchema?: JsonSchema | null
): SchemaDiffSummary | null => {
  if (!payloadSchema || !eventSchema) return null;
  const payloadProps = payloadSchema.properties ?? {};
  const eventProps = eventSchema.properties ?? {};

  const payloadKeys = new Set(Object.keys(payloadProps));
  const eventKeys = new Set(Object.keys(eventProps));

  const onlyInEvent = Array.from(eventKeys).filter((key) => !payloadKeys.has(key));
  const onlyInPayload = Array.from(payloadKeys).filter((key) => !eventKeys.has(key));

  const payloadRequired = new Set(payloadSchema.required ?? []);
  const eventRequired = new Set(eventSchema.required ?? []);

  const requiredOnlyInEvent = Array.from(eventRequired).filter((key) => !payloadRequired.has(key));
  const requiredOnlyInPayload = Array.from(payloadRequired).filter((key) => !eventRequired.has(key));

  const typeMismatches = Array.from(payloadKeys).reduce<SchemaDiffSummary['typeMismatches']>((acc, key) => {
    if (!eventKeys.has(key)) return acc;
    const payloadType = normalizeType(payloadProps[key]);
    const eventType = normalizeType(eventProps[key]);
    if (payloadType && eventType && payloadType !== eventType) {
      acc.push({ field: key, payloadType, eventType });
    }
    return acc;
  }, []);

  return {
    onlyInEvent,
    onlyInPayload,
    requiredOnlyInEvent,
    requiredOnlyInPayload,
    typeMismatches
  };
};

export const pickEventTemplates = (params: {
  eventType?: string | null;
  category?: string | null;
}) => {
  const eventType = params.eventType ?? '';
  const category = params.category ?? '';
  const haystack = `${eventType} ${category}`.toLowerCase();
  const templates: string[] = [];

  if (haystack.includes('email')) {
    templates.push('email');
  }
  if (haystack.includes('webhook')) {
    templates.push('webhook');
  }

  return templates;
};

export const buildWorkflowRunHref = (runId: string): string =>
  `/msp/workflows/runs/${encodeURIComponent(runId)}`;

export type WorkflowRunStartFailureReason = 'runtime_unavailable' | 'launch_failed';

/** Outcome shown in the Run dialog when a run could not be started. */
export type WorkflowRunStartFailure = {
  /** Run record created for the attempt (already marked failed), when there is one. */
  runId: string | null;
  title: string;
  description: string;
  /** Raw server message, shown secondarily for administrators. */
  technicalDetail: string | null;
};

type Translate = (key: string, options: Record<string, unknown>) => string;

export const describeWorkflowRunLaunchFailure = (
  t: Translate,
  launchFailure: { reason: WorkflowRunStartFailureReason; message: string },
  runId: string
): WorkflowRunStartFailure => {
  if (launchFailure.reason === 'runtime_unavailable') {
    return {
      runId,
      title: t('runDialog.startFailure.engineUnavailableTitle', {
        defaultValue: 'The workflow engine could not be reached',
      }),
      description: t('runDialog.startFailure.engineUnavailableDescription', {
        defaultValue:
          'The run was recorded but could not start, so it is marked failed. Try again in a few minutes. If this keeps happening, ask an administrator to check the workflow service.',
      }),
      technicalDetail: launchFailure.message || null,
    };
  }

  return {
    runId,
    title: t('runDialog.startFailure.launchFailedTitle', { defaultValue: 'The run could not start' }),
    description: t('runDialog.startFailure.launchFailedDescription', {
      defaultValue: 'The run was recorded and marked failed. Open it to see the error.',
    }),
    technicalDetail: launchFailure.message || null,
  };
};

/**
 * Readable label for a schema-generated form field: "actorUserId" → "Actor user",
 * "contactId" → "Contact", "created_at" → "Created at". An id suffix is dropped because the
 * field shows a picker or a name, not the raw id.
 */
export const humanizeRunDialogFieldLabel = (fieldKey: string): string => {
  const words = fieldKey
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  if (words.length > 1 && (words[words.length - 1] === 'id' || words[words.length - 1] === 'ids')) {
    const plural = words[words.length - 1] === 'ids';
    words.pop();
    if (plural) words[words.length - 1] = `${words[words.length - 1]}s`;
  }
  if (words.length === 0) return fieldKey;
  const sentence = words.join(' ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
};

/** Picker kinds whose options belong to one client, so a known client narrows them. */
export const CLIENT_SCOPED_PICKER_KINDS: ReadonlySet<string> = new Set(['contact', 'client-location']);

type RunDialogPickerFieldLike = {
  editor?: { dependencies?: string[]; picker?: { resource: string } };
  picker?: { kind: string; dependencies?: string[] };
};

/**
 * Narrows a client-scoped picker (contacts, locations) to the client of a ticket already chosen
 * elsewhere in the form, by declaring a client_id dependency and supplying its value. Leaves the
 * field alone when the client is unknown or the field already declares its own client scope.
 */
export const applyDerivedClientScope = <T extends RunDialogPickerFieldLike>(
  field: T,
  rootInputMapping: Record<string, unknown>,
  derivedClientId: string | null
): { field: T; rootInputMapping: Record<string, unknown> } => {
  const kind = field.editor?.picker?.resource ?? field.picker?.kind;
  const declared = field.editor?.dependencies ?? field.picker?.dependencies ?? [];
  if (!derivedClientId || !kind || !CLIENT_SCOPED_PICKER_KINDS.has(kind) || declared.includes('client_id')) {
    return { field, rootInputMapping };
  }
  const existingClientId = rootInputMapping.client_id;
  return {
    field: field.editor
      ? { ...field, editor: { ...field.editor, dependencies: [...declared, 'client_id'] } }
      : { ...field, picker: field.picker ? { ...field.picker, dependencies: [...declared, 'client_id'] } : field.picker },
    rootInputMapping: typeof existingClientId === 'string' && existingClientId.trim()
      ? rootInputMapping
      : { ...rootInputMapping, client_id: derivedClientId },
  };
};

// The pattern zod emits for dateOnlySchema (shared/workflow/runtime/schemas/commonEventPayloadSchemas.ts).
const DATE_ONLY_PATTERNS = new Set(['^(\\d{4})-(\\d{2})-(\\d{2})$', '^\\d{4}-\\d{2}-\\d{2}$']);

/**
 * Which date picker a string field needs: format "date" / "date-time", or the YYYY-MM-DD pattern
 * that date-only payload fields use. Null for any other field.
 */
export const getRunDialogDateFormat = (
  schema: { type?: string | string[]; format?: string; pattern?: string } | null | undefined
): 'date' | 'date-time' | null => {
  if (!schema) return null;
  if (schema.format === 'date' || schema.format === 'date-time') return schema.format;
  if (typeof schema.pattern === 'string' && DATE_ONLY_PATTERNS.has(schema.pattern)) return 'date';
  return null;
};

type BlankPayloadSchema = {
  type?: string | string[];
  default?: unknown;
  properties?: Record<string, BlankPayloadSchema>;
};

/**
 * Starting payload for the Run dialog when there is no sample: only fields with a schema default,
 * so the JSON view isn't a wall of empty strings and the form shows real empty inputs.
 */
export const buildBlankPayloadFromSchema = (schema: BlankPayloadSchema | null | undefined): Record<string, unknown> => {
  const payload: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(schema?.properties ?? {})) {
    if (child.default !== undefined) {
      payload[key] = child.default;
      continue;
    }
    if (child.properties) {
      const nested = buildBlankPayloadFromSchema(child);
      if (Object.keys(nested).length > 0) payload[key] = nested;
    }
  }
  return payload;
};
