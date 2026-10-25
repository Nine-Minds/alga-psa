import { describe, expect, it } from 'vitest';
import { LABEL_HIDEABLE_FIELDS, type LabelViewModel } from '@alga-psa/types';
import { buildLabelModel } from './renderLabelBatchHtml';
import { LABEL_TEMPLATE_VALUE_BINDINGS } from '../label-template-ast/bindings';
import { templateAstSchema } from '../invoice-template-ast/schema';

const vm: LabelViewModel = {
  labelClass: 'ticket-work-tag', entityType: 'ticket', recordId: 'r1',
  url: 'https://x.test/msp/tickets/r1', identifier: 'T-1', code128Value: null,
  title: 'Broken screen', clientName: 'Acme', detail: 'Hardware', secondaryIdentifier: 'WL-9', serialSuffix: '1234',
};
const tenant = { name: 'Nine Minds', logoUrl: 'data:image/png;base64,AAAA' };

describe('buildLabelModel', () => {
  it('derives display lines and shows brand text only when there is no logo', () => {
    const m = buildLabelModel(vm, tenant);
    expect(m.display).toEqual({ assetLine: 'Asset WL-9', serialLine: 'S/N …1234', sequenceLine: null });
    expect(m.tenantClient?.brandText).toBeNull();
    expect(buildLabelModel(vm, { name: 'Nine Minds', logoUrl: null }).tenantClient?.brandText).toBe('Nine Minds');
  });

  it('T-hidden: nulls hidden fields BEFORE deriving, so no "Asset"/"S/N" stub text survives', () => {
    const m = buildLabelModel(vm, tenant, ['secondaryIdentifier', 'serialSuffix', 'title', 'clientName', 'detail', 'tenantLogo']);
    expect(m).toMatchObject({ title: null, clientName: null, detail: null, secondaryIdentifier: null, serialSuffix: null });
    expect(m.display).toEqual({ assetLine: null, serialLine: null, sequenceLine: null });
    expect(m.tenantClient?.logoUrl).toBeNull();
    expect(m.tenantClient?.brandText).toBe('Nine Minds');
  });

  it('T-hidden: url and identifier can never be hidden', () => {
    expect(LABEL_HIDEABLE_FIELDS).not.toContain('url');
    expect(LABEL_HIDEABLE_FIELDS).not.toContain('identifier');
    const m = buildLabelModel(vm, tenant, [...LABEL_HIDEABLE_FIELDS]);
    expect(m.url).toBe(vm.url);
    expect(m.identifier).toBe(vm.identifier);
  });

  it('T-hidden: the strict schema rejects hiding url / identifier but keeps labelSettings optional', () => {
    const base = { kind: 'invoice-template-ast', version: 1, layout: { id: 'root', type: 'document', children: [] } };
    const withHidden = (hiddenFields: string[]) =>
      templateAstSchema.safeParse({ ...base, metadata: { labelClass: 'ticket-work-tag', labelSettings: { hiddenFields } } });
    expect(withHidden(['title']).success).toBe(true);
    expect(withHidden(['url']).success).toBe(false);
    expect(withHidden(['identifier']).success).toBe(false);
    expect(templateAstSchema.safeParse({ ...base, metadata: { templateName: 'Invoice' } }).success).toBe(true);
  });

  it('T-sens: the binding catalog exposes only view-model fields and never a full serial or ids', () => {
    const paths = Object.values(LABEL_TEMPLATE_VALUE_BINDINGS).map((b) => (b as { path: string }).path).sort();
    expect(paths).toEqual([
      'clientName', 'code128Value', 'detail', 'display.assetLine', 'display.sequenceLine', 'display.serialLine',
      'identifier', 'secondaryIdentifier', 'sequence.n', 'sequence.total', 'serialSuffix', 'tenantClient.brandText',
      'tenantClient.logoUrl', 'tenantClient.name', 'title', 'url',
    ]);
    expect(paths.some((p) => /serial$|recordId|email|phone/i.test(p) && p !== 'serialSuffix')).toBe(false);
  });

  it('C6: a staging box shows its position as "Box n of m"; other classes have no position line', () => {
    const box: LabelViewModel = {
      ...vm,
      labelClass: 'staging-container',
      entityType: 'staging_container',
      url: 'https://x.test/msp/projects/p1/staging?containerId=r1',
      identifier: 'PRJ-1-B03',
      code128Value: 'PRJ-1-B03',
      sequence: { n: 3, total: 5 },
    };
    expect(buildLabelModel(box, tenant).display?.sequenceLine).toBe('Box 3 of 5');
    expect(buildLabelModel({ ...box, sequence: null }, tenant).display?.sequenceLine).toBeNull();
  });
});
