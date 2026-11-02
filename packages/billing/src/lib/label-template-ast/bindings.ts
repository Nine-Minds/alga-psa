import type { TemplateAst } from '@alga-psa/types';

type LabelTemplateBindings = NonNullable<TemplateAst['bindings']>;
type LabelTemplateValueBindings = NonNullable<LabelTemplateBindings['values']>;

/**
 * The value bindings a label template can address. Paths resolve against `LabelViewModel`
 * (`@alga-psa/types`), which the record owners build through `LabelViewModelProvider`. One generic
 * `work-tag` document type serves every label class, so the binding catalog is the same for all.
 */
export const LABEL_TEMPLATE_VALUE_BINDINGS: LabelTemplateValueBindings = {
  recordUrl: { id: 'recordUrl', kind: 'value', path: 'url' },
  identifier: { id: 'identifier', kind: 'value', path: 'identifier', fallback: '' },
  code128Value: { id: 'code128Value', kind: 'value', path: 'code128Value', fallback: '' },
  title: { id: 'title', kind: 'value', path: 'title', fallback: '' },
  clientName: { id: 'clientName', kind: 'value', path: 'clientName', fallback: '' },
  detail: { id: 'detail', kind: 'value', path: 'detail', fallback: '' },
  secondaryIdentifier: { id: 'secondaryIdentifier', kind: 'value', path: 'secondaryIdentifier', fallback: '' },
  serialSuffix: { id: 'serialSuffix', kind: 'value', path: 'serialSuffix', fallback: '' },
  custodyLocation: { id: 'custodyLocation', kind: 'value', path: 'custodyLocation', fallback: '' },
  nextAction: { id: 'nextAction', kind: 'value', path: 'nextAction', fallback: '' },
  // Display lines derived by the renderer AFTER hidden fields are nulled ("Asset {tag}", "S/N ...{suffix}").
  assetLine: { id: 'assetLine', kind: 'value', path: 'display.assetLine', fallback: '' },
  serialLine: { id: 'serialLine', kind: 'value', path: 'display.serialLine', fallback: '' },
  // Staging box position, computed at render time: "Box n of m", and its parts.
  sequenceLine: { id: 'sequenceLine', kind: 'value', path: 'display.sequenceLine', fallback: '' },
  sequenceNumber: { id: 'sequenceNumber', kind: 'value', path: 'sequence.n', fallback: '' },
  sequenceTotal: { id: 'sequenceTotal', kind: 'value', path: 'sequence.total', fallback: '' },
  // RMA work tag (C5): bench lines the generic fields have no slot for.
  rmaStatus: { id: 'rmaStatus', kind: 'value', path: 'rma.statusLabel', fallback: '' },
  rmaReturnBy: { id: 'rmaReturnBy', kind: 'value', path: 'display.rmaReturnByLine', fallback: '' },
  rmaShipping: { id: 'rmaShipping', kind: 'value', path: 'rma.shipping', fallback: '' },
  rmaTicket: { id: 'rmaTicket', kind: 'value', path: 'display.rmaTicketLine', fallback: '' },
  tenantName: { id: 'tenantName', kind: 'value', path: 'tenantClient.name', fallback: '' },
  // The standard templates' text brand line: the issuer name, but only when there is no logo to show.
  tenantBrandText: { id: 'tenantBrandText', kind: 'value', path: 'tenantClient.brandText', fallback: '' },
  tenantLogo: { id: 'tenantLogo', kind: 'value', path: 'tenantClient.logoUrl' },
};

export const buildLabelTemplateBindings = (): LabelTemplateBindings => ({
  values: { ...LABEL_TEMPLATE_VALUE_BINDINGS },
  collections: {},
});
