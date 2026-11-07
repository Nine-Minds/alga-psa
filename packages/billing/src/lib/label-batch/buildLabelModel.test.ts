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
      'clientName', 'code128Value', 'custodyLocation', 'detail', 'display.assetLine', 'display.rmaReturnByLine', 'display.rmaTicketLine', 'display.sequenceLine', 'display.serialLine',
      'identifier', 'nextAction', 'rma.shipping', 'rma.statusLabel', 'secondaryIdentifier', 'sequence.n', 'sequence.total', 'serialSuffix', 'tenantClient.brandText',
      'tenantClient.logoUrl', 'tenantClient.name', 'title', 'url',
    ]);
    expect(paths.some((p) => /serial$|recordId|email|phone/i.test(p) && p !== 'serialSuffix')).toBe(false);
  });

  it('C5: an RMA tag derives its return-by and ticket lines; other classes get none', () => {
    const rma: LabelViewModel = {
      ...vm,
      labelClass: 'rma-work-tag',
      entityType: 'rma',
      url: 'https://x.test/msp/inventory/rma?rmaId=r1',
      identifier: 'RMA-00007',
      rma: { statusLabel: 'Sent to vendor', returnBy: '2026-11-15', shipping: 'UPS 1Z9', ticketNumber: 'TIC-1' },
    };
    const display = buildLabelModel(rma, tenant).display;
    expect(display?.rmaReturnByLine).toBe('Return by 2026-11-15');
    expect(display?.rmaTicketLine).toBe('Ticket TIC-1');
    expect(buildLabelModel({ ...rma, rma: { statusLabel: null, returnBy: null, shipping: null, ticketNumber: null } }, tenant).display?.rmaReturnByLine).toBeNull();
    expect(buildLabelModel(vm, tenant).display).not.toHaveProperty('rmaReturnByLine');
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

describe('buildLabelModel: held-equipment (custody) lines', () => {
  const held = { ...vm, custodyLocation: 'Main Office / Shelf B3', nextAction: 'Waiting on vendor, Oct 29' };

  it('custody lines replace the work-reason line (line budget) and are hideable', () => {
    const m = buildLabelModel(held, tenant);
    expect(m).toMatchObject({ detail: null, custodyLocation: 'Main Office / Shelf B3', nextAction: 'Waiting on vendor, Oct 29' });
    expect(buildLabelModel(held, tenant, ['custodyLocation', 'nextAction']).detail).toBe('Hardware');
    expect(buildLabelModel(held, tenant, ['custodyLocation']).nextAction).toBe('Waiting on vendor, Oct 29');
  });

  it('a tag with no custody prints exactly as before', () => {
    const m = buildLabelModel(vm, tenant);
    expect(m).toMatchObject({ detail: 'Hardware', custodyLocation: null, nextAction: null });
    expect(m.display?.serialLine).toBe(`S/N \u2026${vm.serialSuffix}`);
  });

  it('custody lines also take the serial line\'s place; the asset line still names the held device', () => {
    const m = buildLabelModel(held, tenant);
    expect(m.display?.serialLine).toBeNull();
    expect(m.display?.assetLine).toBe(`Asset ${vm.secondaryIdentifier}`);
    expect(buildLabelModel(held, tenant, ['custodyLocation', 'nextAction']).display?.serialLine).toBe(`S/N \u2026${vm.serialSuffix}`);
  });

  it('binds custodyLocation and nextAction, and the work tag template uses them', async () => {
    expect(LABEL_TEMPLATE_VALUE_BINDINGS.custodyLocation).toMatchObject({ path: 'custodyLocation' });
    expect(LABEL_TEMPLATE_VALUE_BINDINGS.nextAction).toMatchObject({ path: 'nextAction' });
    const { STANDARD_LABEL_TEMPLATE_ASTS } = await import('../label-template-ast/standardTemplates');
    const json = JSON.stringify(Object.values(STANDARD_LABEL_TEMPLATE_ASTS));
    expect(json).toContain('"bindingId":"custodyLocation"');
  });

  it('line budget holds with the longest strings: the work-tag text column stays within the 44 mm row', async () => {
    const { getStandardLabelTemplateAstByCode, STANDARD_LABEL_TICKET_WORK_TAG_CODE } = await import('../label-template-ast/standardTemplates');
    
    const ast: any = getStandardLabelTemplateAstByCode(STANDARD_LABEL_TICKET_WORK_TAG_CODE);
    const column = ast.layout.children[0].children[0].children as any[];
    const px = (n: any) => Number.parseFloat(String(n.style.inline.maxHeight ?? '0'));
    const byId = (id: string) => column.find((n) => n.id === id);
    // Worst case: custody prints, so the reason and serial lines are collapsed. The identifier is uncapped: allow 3 lines at 20px.
    const printed = column.filter((n) => n.id !== 'reason' && n.id !== 'serial');
    const heights = printed.map((n) => (n.id === 'ticket-number' ? 3 * 20 * 1.1 : px(n)));
    const gaps = (printed.length - 1) * (0.5 * 3.7795);
    const total = heights.reduce((a, b) => a + b, 0) + gaps;
    expect(byId('custody-location')).toBeTruthy();
    expect(byId('next-action')).toBeTruthy();
    expect(total).toBeLessThanOrEqual(44 * 3.7795);
  });
});
