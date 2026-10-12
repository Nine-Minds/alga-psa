import type { DataField, DataTreeContext } from './SourceDataTree';

/**
 * Sample data for previewing expressions and text in the designer, built from the workflow's data
 * shapes: each text field becomes a bracketed placeholder naming the field (`[client name]`), numbers
 * become 1 and flags become true, so a preview shows where each value lands.
 */
const placeholderFor = (field: DataField): string =>
  `[${field.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase()}]`;

const sampleValue = (field: DataField): unknown => {
  const children = field.children ?? [];
  switch (field.type) {
    case 'object':
      return Object.fromEntries(children.map((child) => [child.name, sampleValue(child)]));
    case 'array':
      return children.length > 0
        ? [Object.fromEntries(children.map((child) => [child.name, sampleValue(child)]))]
        : [placeholderFor(field)];
    case 'number':
    case 'integer':
      return 1;
    case 'boolean':
      return true;
    default:
      return placeholderFor(field);
  }
};

const fieldsToObject = (fields: DataField[]): Record<string, unknown> =>
  Object.fromEntries(fields.map((field) => [field.name, sampleValue(field)]));

/** Payload fields carry their full path (`payload.ticketId`); nest them under their root. */
const nestUnderRoot = (fields: DataField[], root: string): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const relative = field.path.startsWith(`${root}.`) ? field.path.slice(root.length + 1) : field.name;
    const segments = relative.split('.');
    let cursor = result;
    for (const segment of segments.slice(0, -1)) {
      cursor[segment] = (cursor[segment] as Record<string, unknown> | undefined) ?? {};
      cursor = cursor[segment] as Record<string, unknown>;
    }
    cursor[segments[segments.length - 1]] = sampleValue(field);
  }
  return result;
};

export type WorkflowSampleContext = {
  payload: Record<string, unknown>;
  vars: Record<string, unknown>;
  meta: Record<string, unknown>;
  error?: Record<string, unknown>;
  /** Present inside a For Each: lets the preview evaluate the items list and use its first item. */
  __loop?: { itemVar: string; indexVar: string; itemsExpr?: string };
  [local: string]: unknown;
};

/** Loop locals the runtime binds for the current item (see the workflow runtime's lexical scope). */
export const bindSampleLoopItem = (
  context: WorkflowSampleContext,
  item: unknown
): WorkflowSampleContext => {
  const loop = context.__loop;
  if (!loop) return context;
  const locals = { item, index: 0, length: 1, isFirst: true, isLast: true, [loop.itemVar]: item };
  return {
    ...context,
    ...locals,
    [loop.indexVar]: 0,
    local: locals,
    vars: { ...context.vars, [loop.itemVar]: item },
  };
};

export const buildWorkflowSampleContext = (context: DataTreeContext | undefined): WorkflowSampleContext => {
  const base: WorkflowSampleContext = {
    payload: nestUnderRoot(context?.payload ?? [], 'payload'),
    vars: Object.fromEntries(
      (context?.vars ?? []).map((step) => [step.saveAs, fieldsToObject(step.fields)])
    ),
    meta: fieldsToObject(context?.meta ?? []),
    ...(context?.error?.length ? { error: fieldsToObject(context.error) } : {}),
  };
  const loop = context?.forEach;
  if (!loop?.itemVar) return base;
  // Until the preview evaluates the items list, the item is a placeholder named after the variable.
  const placeholderItem = placeholderFor({ name: loop.itemVar, path: loop.itemVar, type: 'string', source: 'forEach' });
  return bindSampleLoopItem(
    { ...base, __loop: { itemVar: loop.itemVar, indexVar: loop.indexVar, itemsExpr: loop.itemsExpr } },
    placeholderItem
  );
};
