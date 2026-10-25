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
 * Invariants, in order of execution:
 *  1. Authorization comes first. Providers enforce RBAC and record-level permission and return `null`
 *     for "missing" and "not permitted" alike. A caller who is not an MSP user, a single record that is
 *     null, and a batch where EVERY record is null all yield the same uniform not-found result.
 *     In a mixed batch, null records are skipped and only their COUNT is returned (`skipped`) - never
 *     which ids or why - so an unauthorized request reveals nothing about a record.
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
  /** Single-class request: one label class for every id. */
  labelClass?: unknown;
  ids?: unknown;
  /**
   * Mixed request (C6 bulk print): labels of several classes in ONE PDF, in this order. Each class prints
   * with its tenant default (or standard) template; templateId, overrides and linkedAssetId are not
   * accepted with `items`. The cap, ordering and skip/404 rules are the same as a single-class request.
   */
  items?: unknown;
  /** A tenant custom `work-tag` template id, or a standard code. Supersedes `templateCode`. */
  templateId?: unknown;
  /** Alias of `templateId` for standard codes (C1 request shape). */
  templateCode?: unknown;
  layout?: unknown;
  /** Single ticket only: print-time edits of the item and reason lines. Never persisted. */
  overrides?: unknown;
  /** Single ticket only: which linked asset to print when several are linked. Ignored when invalid. */
  linkedAssetId?: unknown;
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
    ticketIds: readonly string[],
    chosen: Record<string, string>
  ) => Promise<Record<string, { assetId: string; assetTag: string | null; serialSuffix: string | null } | null>>;
  describeClientError: (error: unknown) => { message: string; failures?: LabelPrintFailure[] } | null;
}

const NOT_FOUND: PrintLabelsResult = { ok: false, status: 404, message: 'Not found.' };

interface NormalizedEntry {
  labelClass: LabelClass;
  id: string;
}

function normalizeEntries(request: PrintLabelsRequest): { entries: NormalizedEntry[]; mixed: boolean } | PrintLabelsResult {
  if (request.items !== undefined) {
    if (request.labelClass !== undefined || request.ids !== undefined) {
      return { ok: false, status: 400, message: 'Send either labelClass and ids, or items, not both.' };
    }
    const items = request.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > MAX_LABELS_PER_REQUEST) {
      return { ok: false, status: 400, message: `items must be 1 to ${MAX_LABELS_PER_REQUEST} labels.` };
    }
    const entries: NormalizedEntry[] = [];
    for (const item of items) {
      const raw = item as { labelClass?: unknown; id?: unknown } | null;
      if (!raw || typeof raw !== 'object' || !isLabelClass(raw.labelClass) || typeof raw.id !== 'string' || !UUID.test(raw.id)) {
        return {
          ok: false,
          status: 400,
          message: `Each item must be { labelClass: ${LABEL_CLASSES.join(' | ')}, id: record id }.`,
        };
      }
      entries.push({ labelClass: raw.labelClass, id: raw.id });
    }
    for (const name of ['templateId', 'templateCode', 'overrides', 'linkedAssetId'] as const) {
      if (request[name] !== undefined && request[name] !== null) {
        return { ok: false, status: 400, message: `${name} is not accepted with items.` };
      }
    }
    return { entries, mixed: true };
  }

  if (!isLabelClass(request.labelClass)) {
    return { ok: false, status: 400, message: `labelClass must be one of: ${LABEL_CLASSES.join(', ')}.` };
  }
  const labelClass = request.labelClass;
  const ids = request.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_LABELS_PER_REQUEST ||
    !ids.every((id): id is string => typeof id === 'string' && UUID.test(id))
  ) {
    return { ok: false, status: 400, message: `ids must be 1 to ${MAX_LABELS_PER_REQUEST} record ids.` };
  }
  return { entries: ids.map((id) => ({ labelClass, id })), mixed: false };
}

export async function printLabels(
  deps: PrintLabelsDeps,
  caller: { user: IUserWithRoles; tenant: string; baseUrl: string },
  request: PrintLabelsRequest
): Promise<PrintLabelsResult> {
  const normalized = normalizeEntries(request);
  if ('ok' in normalized) return normalized;
  const { entries, mixed } = normalized;
  const classes = [...new Set(entries.map((e) => e.labelClass))];
  // Single-class request: the class and ids every existing check below is phrased in.
  const labelClass = classes[0];
  const ids = entries.map((e) => e.id);

  for (const [name, value] of [['templateId', request.templateId], ['templateCode', request.templateCode]] as const) {
    if (value !== undefined && typeof value !== 'string') {
      return { ok: false, status: 400, message: `${name} must be a string.` };
    }
  }
  const requestedTemplate = mixed
    ? null
    : (typeof request.templateId === 'string' && request.templateId) ||
      (typeof request.templateCode === 'string' && request.templateCode) ||
      null;

  // Overrides edit one ticket's own tag: single ticket only, plain text, bounded.
  let overrides: { title?: string | null; detail?: string | null } | null = null;
  if (request.overrides !== undefined && request.overrides !== null) {
    const raw = request.overrides as Record<string, unknown>;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, status: 400, message: 'overrides must be an object.' };
    }
    if (labelClass !== 'ticket-work-tag' || ids.length !== 1) {
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
  // Absent unless it is a well-formed id on a single-ticket print. Whether it is linked to the ticket and
  // readable is decided in the assets package; a bad value is ignored silently, never an error.
  const linkedAssetId =
    !mixed && labelClass === 'ticket-work-tag' && ids.length === 1 && typeof request.linkedAssetId === 'string' && UUID.test(request.linkedAssetId)
      ? request.linkedAssetId
      : null;

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
  // One provider call per class, then the results are put back in request order.
  const results: Array<LabelViewModel | null> = new Array(entries.length).fill(null);
  for (const cls of classes) {
    const positions = entries.flatMap((e, index) => (e.labelClass === cls ? [index] : []));
    const providerResults = await providers.get(cls)!.getLabelViewModels(context, positions.map((i) => entries[i].id));
    if (providerResults.length !== positions.length) {
      return NOT_FOUND;
    }
    positions.forEach((position, k) => {
      results[position] = providerResults[k];
    });
  }
  const readable = results.filter((vm): vm is LabelViewModel => vm !== null);
  // Skip unreadable records and count them; if nothing is readable the answer is the uniform 404.
  if (readable.length === 0) {
    return NOT_FOUND;
  }
  const skipped = entries.length - readable.length;

  let viewModels = readable;
  const ticketIds = readable.filter((vm) => vm.labelClass === 'ticket-work-tag').map((vm) => vm.recordId);
  if (ticketIds.length > 0) {
    const parts = await deps.getLinkedAssetParts(
      context,
      ticketIds,
      linkedAssetId ? { [readable[0].recordId]: linkedAssetId } : {}
    );
    viewModels = viewModels.map((vm) => {
      if (vm.labelClass !== 'ticket-work-tag') return vm;
      const linked = parts[vm.recordId];
      return linked ? { ...vm, secondaryIdentifier: linked.assetTag, serialSuffix: linked.serialSuffix } : vm;
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

  const items: LabelPrintItem[] = viewModels.map((viewModel) => {
    const template = templates.get(viewModel.labelClass)!;
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
