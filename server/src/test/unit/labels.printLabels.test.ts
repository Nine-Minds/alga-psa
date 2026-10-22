import { describe, expect, it, vi } from 'vitest';
import type { LabelViewModel, LabelViewModelProvider } from '@alga-psa/types';
import { printLabels, type PrintLabelsDeps } from '../../lib/labels/printLabels';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const vm = (id: string): LabelViewModel => ({
  labelClass: 'ticket-work-tag', entityType: 'ticket', recordId: id,
  url: `https://x.test/msp/tickets/${id}`, identifier: id.slice(0, 4), code128Value: null,
  title: null, clientName: null, detail: null, secondaryIdentifier: null, serialSuffix: null,
});

const setup = (readable: string[], userType = 'internal') => {
  const provider: LabelViewModelProvider = {
    entityType: 'ticket', labelClass: 'ticket-work-tag',
    getLabelViewModels: vi.fn(async (_c, ids) => ids.map((i) => (readable.includes(i) ? vm(i) : null))),
  };
  const renderPdf = vi.fn(async () => ({ pdf: Buffer.from('%PDF'), labels: 1, sheets: 1 }));
  const deps: PrintLabelsDeps = {
    providers: { 'ticket-work-tag': provider, 'asset-identity': undefined, 'stock-unit-identity': undefined },
    renderPdf, describeClientError: () => null,
  };
  const caller = { user: { user_type: userType } as never, tenant: 't', baseUrl: 'https://x.test' };
  return { deps, provider, renderPdf, caller };
};

describe('printLabels', () => {
  it('renders in request order, passing the provider view models through', async () => {
    const s = setup([A, B, C]);
    const r = await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', ids: [C, A, B] });
    expect(r.ok).toBe(true);
    const items = (s.renderPdf.mock.calls[0] as unknown[])[1] as Array<{ viewModel: LabelViewModel }>;
    expect(items.map((i) => i.viewModel.recordId)).toEqual([C, A, B]);
  });

  it('missing and unauthorized records are indistinguishable and nothing renders', async () => {
    const s = setup([A]);
    const missing = await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', ids: [A, B] });
    const other = await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', ids: [A, C] });
    expect(missing).toEqual({ ok: false, status: 404, message: 'Not found.' });
    expect(other).toEqual(missing);
    expect(s.renderPdf).not.toHaveBeenCalled();
  });

  it('client-portal users get the same 404 without touching the provider', async () => {
    const s = setup([A], 'client');
    const r = await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', ids: [A] });
    expect(r).toEqual({ ok: false, status: 404, message: 'Not found.' });
    expect(s.provider.getLabelViewModels).not.toHaveBeenCalled();
  });

  it('validates input before any data access', async () => {
    const s = setup([A]);
    for (const body of [
      { labelClass: 'nope', ids: [A] },
      { labelClass: 'ticket-work-tag', ids: [] },
      { labelClass: 'ticket-work-tag', ids: ['not-a-uuid'] },
      { labelClass: 'ticket-work-tag', ids: Array(201).fill(A) },
      { labelClass: 'ticket-work-tag', ids: [A], templateCode: 5 },
    ]) {
      expect(await printLabels(s.deps, s.caller, body)).toMatchObject({ ok: false, status: 400 });
    }
    expect(s.provider.getLabelViewModels).not.toHaveBeenCalled();
  });

  it('a class without a provider is a 422, not a data read', async () => {
    const s = setup([A]);
    expect(await printLabels(s.deps, s.caller, { labelClass: 'asset-identity', ids: [A] })).toMatchObject({ status: 422 });
  });

  it('maps renderer client errors to 422 and rethrows others', async () => {
    const s = setup([A]);
    s.renderPdf.mockRejectedValueOnce(new Error('bad layout'));
    s.deps.describeClientError = (e) => ({ message: (e as Error).message });
    expect(await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', ids: [A] })).toEqual({
      ok: false,
      status: 422,
      message: 'bad layout',
    });
    s.renderPdf.mockRejectedValueOnce(new Error('boom'));
    s.deps.describeClientError = () => null;
    await expect(printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', ids: [A] })).rejects.toThrow('boom');
  });

  it('a 422 lists every record that cannot print, with the suggested template', async () => {
    const s = setup([A, B, C]);
    const failures = [
      { index: 0, recordId: A, identifier: 'levelio:Z2lk', templateCode: 'standard-asset-label-code128', message: 'too long', suggestedTemplateCode: 'standard-asset-label' },
      { index: 2, recordId: C, identifier: 'levelio:Z2lm', templateCode: 'standard-asset-label-code128', message: 'too long', suggestedTemplateCode: 'standard-asset-label' },
    ];
    s.renderPdf.mockRejectedValueOnce(new Error('2 of 3 labels cannot be printed'));
    s.deps.describeClientError = (e) => ({ message: (e as Error).message, failures });
    expect(await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', ids: [A, B, C] })).toEqual({
      ok: false,
      status: 422,
      message: '2 of 3 labels cannot be printed',
      failures,
    });
  });
});
