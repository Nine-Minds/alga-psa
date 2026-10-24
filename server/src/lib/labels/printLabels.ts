import {
  LABEL_CLASSES,
  LABEL_CLASS_ENTITY_TYPE,
  isLabelClass,
  type IUserWithRoles,
  type LabelClass,
  type LabelPrintFailure,
  type LabelViewModel,
  type LabelViewModelProvider,
} from '@alga-psa/types';
import type { LabelBatchLayout, LabelPrintItem } from '@alga-psa/billing/services';

/**
 * Composition root for label printing: the one place that knows the record owners (through their
 * `LabelViewModelProvider`s) AND the label renderer (billing). Neither side imports the other.
 *
 * Invariants, in order of execution:
 *  1. Authorization comes first. Providers enforce RBAC and record-level permission and return `null`
 *     for "missing" and "not permitted" alike; ANY null (and a caller who is not an MSP user) yields
 *     the same uniform not-found result, so an unauthorized request reveals nothing about a record.
 *  2. Rendering and printing are read-only: nothing is written, no event is published.
 *  3. QR content is only the canonical recordUrl (the renderer re-checks it).
 */

export const MAX_LABELS_PER_REQUEST = 200;

const DEFAULT_LAYOUT: LabelBatchLayout = {
  kind: 'one-per-page',
  pageSize: { width: 4, height: 2, unit: 'in' },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PrintLabelsRequest {
  labelClass: unknown;
  ids: unknown;
  templateCode?: unknown;
  layout?: unknown;
}

export type PrintLabelsResult =
  | { ok: true; pdf: Buffer; labels: number; sheets: number }
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
  describeClientError: (error: unknown) => { message: string; failures?: LabelPrintFailure[] } | null;
}

const NOT_FOUND: PrintLabelsResult = { ok: false, status: 404, message: 'Not found.' };

export async function printLabels(
  deps: PrintLabelsDeps,
  caller: { user: IUserWithRoles; tenant: string; baseUrl: string },
  request: PrintLabelsRequest
): Promise<PrintLabelsResult> {
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
  if (request.templateCode !== undefined && typeof request.templateCode !== 'string') {
    return { ok: false, status: 400, message: 'templateCode must be a string.' };
  }

  // MSP users only. A client-portal user gets the same answer as a missing record.
  if (caller.user.user_type !== 'internal') {
    return NOT_FOUND;
  }

  const provider = deps.providers[labelClass];
  if (!provider || provider.entityType !== LABEL_CLASS_ENTITY_TYPE[labelClass]) {
    // Not provided yet (stubbed / deferred): never reached with real data.
    return { ok: false, status: 422, message: `Labels of class "${labelClass}" are not available yet.` };
  }

  const viewModels = await provider.getLabelViewModels(
    { tenant: caller.tenant, user: caller.user, baseUrl: caller.baseUrl },
    ids
  );
  if (viewModels.length !== ids.length || viewModels.some((vm) => vm === null)) {
    return NOT_FOUND;
  }

  const items: LabelPrintItem[] = (viewModels as LabelViewModel[]).map((viewModel) => ({
    viewModel,
    ...(typeof request.templateCode === 'string' ? { templateCode: request.templateCode } : {}),
  }));

  try {
    const { pdf, labels, sheets } = await deps.renderPdf(
      caller.tenant,
      items,
      (request.layout as LabelBatchLayout | undefined) ?? DEFAULT_LAYOUT
    );
    return { ok: true, pdf, labels, sheets };
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
