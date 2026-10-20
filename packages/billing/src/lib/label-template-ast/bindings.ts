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
  tenantName: { id: 'tenantName', kind: 'value', path: 'tenantClient.name', fallback: '' },
  tenantLogo: { id: 'tenantLogo', kind: 'value', path: 'tenantClient.logoUrl' },
};

export const buildLabelTemplateBindings = (): LabelTemplateBindings => ({
  values: { ...LABEL_TEMPLATE_VALUE_BINDINGS },
  collections: {},
});
