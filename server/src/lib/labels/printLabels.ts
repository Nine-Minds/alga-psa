import {
  MAX_LABELS_PER_REQUEST,
  LABEL_CLASSES,
  LABEL_CLASS_ENTITY_TYPE,
  isLabelClass,
  type IUserWithRoles,
  type LabelClass,
  type LabelRequestContext,
  type LabelPrintFailure,
  type LabelViewModel,
  type LabelViewModelProvider,
} from '@alga-psa/types';
import type { LabelBatchLayout, LabelPrintItem, ResolvedLabelTemplate } from '@alga-psa/billing/services';

/**
 * Composition root for label printing: the one place that knows the record owners (through their
 * `LabelViewModelProvider`s) AND the label renderer (billing). Neither side imports the other.
 *
 * A print job is a list of label subjects `{ recordId, linkedAssetId? }`: one label each, in request order. The
 * same ticket may appear in several subjects with different picks (one tag per held item).
 *
 * Invariants, in order of execution:
 *  1. Authorization comes first. Providers enforce RBAC and record-level permission and return `null`
 *     for "missing" and "not permitted" alike. A caller who is not an MSP user, a single record that is
 *     null, and a batch where EVERY record is null all yield the same uniform not-found result.
 *     In a mixed batch, null records are skipped and only their COUNT is returned (`skipped`) - never
 *     which ids or why - so an unauthorized request reveals nothing about a record.
 *     Skips are counted PER SUBJECT (a ticket named three times that is unreadable counts three), because each
 *     subject is one label that was not printed. If no UNIQUE record is readable the answer is the same 404 for
 *     every caller and every request shape.
 *  2. Rendering and printing are read-only: nothing is written, no event is published, nothing recorded.
 *  3. QR content is only the canonical recordUrl (the renderer re-checks it).
 *  4. A render failure stays all-or-nothing (422) and lists every failing record.
 */

export { MAX_LABELS_PER_REQUEST };

const DEFAULT_LAYOUT: LabelBatchLayout = {
  kind: 'one-per-page',
  pageSize: { width: 4, height: 2, unit: 'in' },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PrintLabelsRequest {
  /** Default class for subjects that do not name their own. */
  labelClass?: unknown;
  /**
   * Label subjects: one label each, in request order, possibly of several classes. A subject's own
   * `labelClass` wins over the request default. `linkedAssetId` applies to `ticket-work-tag` only and is
   * dropped silently on any other class.
   */
  labels: unknown;
  /** Legacy shapes: always rejected (400). Declared only so the rejection is explicit. */
  ids?: unknown;
  items?: unknown;
  /** A tenant custom `work-tag` template id, or a standard code. Supersedes `templateCode`. */
  templateId?: unknown;
  /** Alias of `templateId` for standard codes (C1 request shape). */
  templateCode?: unknown;
  layout?: unknown;
  /** One distinct record only: print-time edits of the item and reason lines. Never persisted. */
  overrides?: unknown;
}

export interface LabelSubject {
  recordId: string;
  linkedAssetId?: string;
}

/** A subject with its class resolved. */
export interface ResolvedLabelSubject extends LabelSubject {
  labelClass: LabelClass;
}

export const MAX_OVERRIDE_LENGTH = 120;

/** Plain text, control characters stripped (whitespace controls become spaces), trimmed, capped. */
export function sanitizeLabelOverride(value: string): string | null {
  const cleaned = value
    .replace(/[\t\n\r\u000b\u000c\u0085\u2028\u2029]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  const capped = Array.from(cleaned).slice(0, MAX_OVERRIDE_LENGTH).join('').trim();
  return capped.length > 0 ? capped : null;
}

export type PrintLabelsResult =
  | { ok: true; pdf: Buffer; labels: number; sheets: number; skipped: number }
  | { ok: false; status: 400 | 404 | 422 | 500; message: string; failures?: LabelPrintFailure[] };

export interface PrintLabelsDeps {
  providers: Record<LabelClass, LabelViewModelProvider | undefined>;
  renderPdf: (
    tenant: string,
    items: readonly LabelPrintItem[],
    layout: LabelBatchLayout
  ) => Promise<{ pdf: Buffer; labels: number; sheets: number }>;
  /**
   * Describes a layout / render error that is the caller's fault (422) rather than ours (500), with the
   * records that could not print when the renderer names them; null for anything else (rethrown).
   */
  /** Resolves explicit templateId -> tenant class default -> class standard. Read-only. */
  resolveTemplate: (tenant: string, labelClass: LabelClass, templateId: string | null) => Promise<ResolvedLabelTemplate>;
  /**
   * Linked-asset tag + serial suffix per ticket, behind the asset kernel check (assets package). Tickets
   * never import assets, so the composition root merges this into ticket view models.
   */
  getLinkedAssetParts: (
    context: LabelRequestContext,
    subjects: ReadonlyArray<LabelSubject>
  ) => Promise<
    Array<{
      assetId: string;
      assetTag: string | null;
      serialSuffix: string | null;
      custodyLocation?: string | null;
      nextAction?: string | null;
    } | null>
  >;
  describeClientError: (error: unknown) => { message: string; failures?: LabelPrintFailure[] } | null;
}

const NOT_FOUND: PrintLabelsResult = { ok: false, status: 404, message: 'Not found.' };

function normalizeSubjects(request: PrintLabelsRequest): { subjects: ResolvedLabelSubject[] } | PrintLabelsResult {
  if (request.ids !== undefined || request.items !== undefined) {
    return { ok: false, status: 400, message: 'ids and items are not accepted; send labels: [{ labelClass?, recordId, linkedAssetId? }].' };
  }
  if (request.labelClass !== undefined && request.labelClass !== null && !isLabelClass(request.labelClass)) {
    return { ok: false, status: 400, message: `labelClass must be one of: ${LABEL_CLASSES.join(', ')}.` };
  }
  const defaultClass: LabelClass | null = isLabelClass(request.labelClass) ? request.labelClass : null;
  const rawLabels = request.labels;
  const badLabels = {
    ok: false as const,
    status: 400 as const,
    message: `labels must be 1 to ${MAX_LABELS_PER_REQUEST} label subjects { labelClass?, recordId, linkedAssetId? }.`,
  };
  if (!Array.isArray(rawLabels) || rawLabels.length === 0 || rawLabels.length > MAX_LABELS_PER_REQUEST) {
    return badLabels;
  }
  const subjects: ResolvedLabelSubject[] = [];
  for (const raw of rawLabels as unknown[]) {
    const item = raw as { labelClass?: unknown; recordId?: unknown; linkedAssetId?: unknown } | null;
    if (!item || typeof item !== 'object' || typeof item.recordId !== 'string' || !UUID.test(item.recordId)) {
      return badLabels;
    }
    if (item.labelClass !== undefined && item.labelClass !== null && !isLabelClass(item.labelClass)) {
      return { ok: false, status: 400, message: `labelClass must be one of: ${LABEL_CLASSES.join(', ')}.` };
    }
    const labelClass: LabelClass | null = isLabelClass(item.labelClass) ? item.labelClass : defaultClass;
    if (!labelClass) {
      return { ok: false, status: 400, message: `Every label needs a labelClass (one of: ${LABEL_CLASSES.join(', ')}), on the label or on the request.` };
    }
    // linkedAssetId only means something on a ticket work tag; on any other class it is dropped, not rejected.
    if (labelClass === 'ticket-work-tag' && item.linkedAssetId !== undefined && item.linkedAssetId !== null) {
      if (typeof item.linkedAssetId !== 'string' || !UUID.test(item.linkedAssetId)) return badLabels;
      subjects.push({ labelClass, recordId: item.recordId, linkedAssetId: item.linkedAssetId });
    } else {
      subjects.push({ labelClass, recordId: item.recordId });
    }
  }
  return { subjects };
}

export async function printLabels(
  deps: PrintLabelsDeps,
  caller: { user: IUserWithRoles; tenant: string; baseUrl: string },
  request: PrintLabelsRequest
): Promise<PrintLabelsResult> {
  const normalized = normalizeSubjects(request);
  if ('ok' in normalized) return normalized;
  const { subjects } = normalized;
  const classes = [...new Set(subjects.map((s) => s.labelClass))];
  const mixed = classes.length > 1;
  const uniqueIds = Array.from(new Set(subjects.map((subject) => subject.recordId)));

  for (const [name, value] of [['templateId', request.templateId], ['templateCode', request.templateCode]] as const) {
    if (value !== undefined && typeof value !== 'string') {
      return { ok: false, status: 400, message: `${name} must be a string.` };
    }
  }
  const requestedTemplate =
    (typeof request.templateId === 'string' && request.templateId) ||
    (typeof request.templateCode === 'string' && request.templateCode) ||
    null;
  if (mixed) {
    for (const name of ['templateId', 'templateCode', 'overrides'] as const) {
      if (request[name] !== undefined && request[name] !== null) {
        return { ok: false, status: 400, message: `${name} is not accepted when labels of several classes are printed.` };
      }
    }
  }

  // Overrides edit one ticket's own tag: one distinct ticket only, plain text, bounded.
  let overrides: { title?: string | null; detail?: string | null } | null = null;
  if (request.overrides !== undefined && request.overrides !== null) {
    const raw = request.overrides as Record<string, unknown>;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, status: 400, message: 'overrides must be an object.' };
    }
    if (classes[0] !== 'ticket-work-tag' || uniqueIds.length !== 1) {
      return { ok: false, status: 400, message: 'overrides are only accepted when printing a single ticket.' };
    }
    overrides = {};
    for (const key of ['title', 'detail'] as const) {
      if (raw[key] === undefined) continue;
      if (typeof raw[key] !== 'string') {
        return { ok: false, status: 400, message: `overrides.${key} must be a string.` };
      }
      overrides[key] = sanitizeLabelOverride(raw[key] as string);
    }
  }
  // MSP users only. A client-portal user gets the same answer as a missing record.
  if (caller.user.user_type !== 'internal') {
    return NOT_FOUND;
  }

  const providers = new Map<LabelClass, LabelViewModelProvider>();
  for (const cls of classes) {
    const provider = deps.providers[cls];
    if (!provider || provider.entityType !== LABEL_CLASS_ENTITY_TYPE[cls]) {
      // Not provided yet (stubbed / deferred): never reached with real data.
      return { ok: false, status: 422, message: `Labels of class "${cls}" are not available yet.` };
    }
    providers.set(cls, provider);
  }

  // A template of another label class (or an unknown one) is the caller's mistake: 400. It names no record.
  const templates = new Map<LabelClass, Extract<ResolvedLabelTemplate, { ok: true }>>();
  for (const cls of classes) {
    const template = await deps.resolveTemplate(caller.tenant, cls, requestedTemplate);
    if (!template.ok) {
      return { ok: false, status: 400, message: template.message };
    }
    templates.set(cls, template);
  }

  const context: LabelRequestContext = { tenant: caller.tenant, user: caller.user, baseUrl: caller.baseUrl };
  // One provider call per class (unique ids), then the results are put back in request order per subject.
  const byRecord = new Map<string, LabelViewModel>();
  for (const cls of classes) {
    const ids = Array.from(new Set(subjects.filter((s) => s.labelClass === cls).map((s) => s.recordId)));
    const providerResults = await providers.get(cls)!.getLabelViewModels(context, ids);
    if (providerResults.length !== ids.length) {
      return NOT_FOUND;
    }
    ids.forEach((id, index) => {
      const vm = providerResults[index];
      if (vm) byRecord.set(`${cls}:${id}`, vm);
    });
  }
  // Skip unreadable records and count them per subject; if nothing is readable the answer is the uniform 404.
  const readableSubjects = subjects.filter((subject) => byRecord.has(`${subject.labelClass}:${subject.recordId}`));
  if (readableSubjects.length === 0) {
    return NOT_FOUND;
  }
  const skipped = subjects.length - readableSubjects.length;

  // One view model per subject, in request order.
  let viewModels: LabelViewModel[] = readableSubjects.map((s) => byRecord.get(`${s.labelClass}:${s.recordId}`)!);
  const ticketPositions = readableSubjects.flatMap((s, index) => (s.labelClass === 'ticket-work-tag' ? [index] : []));
  if (ticketPositions.length > 0) {
    const parts = await deps.getLinkedAssetParts(
      context,
      ticketPositions.map((i) => ({ recordId: readableSubjects[i].recordId, linkedAssetId: readableSubjects[i].linkedAssetId }))
    );
    const partsByPosition = new Map<number, (typeof parts)[number]>();
    ticketPositions.forEach((position, k) => partsByPosition.set(position, parts[k]));
    viewModels = viewModels.map((vm, index) => {
      if (!partsByPosition.has(index)) return vm;
      const linked = partsByPosition.get(index);
      return linked
        ? {
            ...vm,
            secondaryIdentifier: linked.assetTag,
            serialSuffix: linked.serialSuffix,
            custodyLocation: linked.custodyLocation ?? null,
            nextAction: linked.nextAction ?? null,
          }
        : vm;
    });
  }
  if (overrides) {
    // Only the item and reason lines: url, identifier and codes are never touched.
    viewModels = viewModels.map((vm) => ({
      ...vm,
      ...(overrides.title !== undefined ? { title: overrides.title } : {}),
      ...(overrides.detail !== undefined ? { detail: overrides.detail } : {}),
    }));
  }

  const items: LabelPrintItem[] = viewModels.map((viewModel, index) => {
    const template = templates.get(readableSubjects[index].labelClass)!;
    return {
      viewModel,
      templateCode: template.templateCode,
      ...(template.templateAst ? { templateAst: template.templateAst } : {}),
    };
  });

  try {
    const { pdf, labels, sheets } = await deps.renderPdf(
      caller.tenant,
      items,
      (request.layout as LabelBatchLayout | undefined) ?? DEFAULT_LAYOUT
    );
    return { ok: true, pdf, labels, sheets, skipped };
  } catch (error) {
    const clientError = deps.describeClientError(error);
    if (clientError) {
      return {
        ok: false,
        status: 422,
        message: clientError.message,
        ...(clientError.failures?.length ? { failures: clientError.failures } : {}),
      };
    }
    throw error;
  }
}
