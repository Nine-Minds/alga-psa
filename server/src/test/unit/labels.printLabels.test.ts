import { describe, expect, it, vi } from 'vitest';
import type { LabelViewModel, LabelViewModelProvider } from '@alga-psa/types';
import { printLabels, sanitizeLabelOverride, type PrintLabelsDeps } from '../../lib/labels/printLabels';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const vm = (id: string): LabelViewModel => ({
  labelClass: 'ticket-work-tag', entityType: 'ticket', recordId: id,
  url: `https://x.test/msp/tickets/${id}`, identifier: id.slice(0, 4), code128Value: null,
  title: null, clientName: null, detail: null, secondaryIdentifier: null, serialSuffix: null,
});

const L = (ids: string[]) => ids.map((recordId) => ({ recordId }));

const setup = (readable: string[], userType = 'internal') => {
  const provider: LabelViewModelProvider = {
    entityType: 'ticket', labelClass: 'ticket-work-tag',
    getLabelViewModels: vi.fn(async (_c, ids) => ids.map((i) => (readable.includes(i) ? vm(i) : null))),
  };
  const renderPdf = vi.fn(async () => ({ pdf: Buffer.from('%PDF'), labels: 1, sheets: 1 }));
  const deps: PrintLabelsDeps = {
    providers: { 'ticket-work-tag': provider, 'asset-identity': undefined, 'stock-unit-identity': undefined, 'staging-container': undefined, 'rma-work-tag': undefined },
    renderPdf, describeClientError: () => null,
    resolveTemplate: vi.fn(async () => ({ ok: true as const, templateCode: 'standard-ticket-work-tag', templateAst: null })) as never,
    getLinkedAssetParts: vi.fn(async (_c, subjects: unknown[]) => subjects.map(() => null)) as never,
  };
  const caller = { user: { user_type: userType } as never, tenant: 't', baseUrl: 'https://x.test' };
  return { deps, provider, renderPdf, caller };
};

describe('printLabels', () => {
  it('renders in request order, passing the provider view models through', async () => {
    const s = setup([A, B, C]);
    const r = await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', labels: L([C, A, B]) });
    expect(r.ok).toBe(true);
    const items = (s.renderPdf.mock.calls[0] as unknown[])[1] as Array<{ viewModel: LabelViewModel }>;
    expect(items.map((i) => i.viewModel.recordId)).toEqual([C, A, B]);
  });

  it('T-skip: unreadable records are skipped and only counted; missing and unauthorized look the same', async () => {
    const s = setup([A]);
    const missing = await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', labels: L([A, B]) });
    const other = await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', labels: L([A, C]) });
    expect(missing).toMatchObject({ ok: true, skipped: 1 });
    expect(other).toMatchObject({ ok: true, skipped: 1 });
    const items = (s.renderPdf.mock.calls[0] as unknown[])[1] as Array<{ viewModel: LabelViewModel }>;
    expect(items.map((i) => i.viewModel.recordId)).toEqual([A]);
  });

  it('T-skip: when nothing is readable (single or whole batch) the answer is the uniform 404', async () => {
    const s = setup([]);
    const single = await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', labels: L([A]) });
    const batch = await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', labels: L([A, B]) });
    expect(single).toEqual({ ok: false, status: 404, message: 'Not found.' });
    expect(batch).toEqual(single);
    expect(s.renderPdf).not.toHaveBeenCalled();
  });

  it('T-overrides: sanitises and applies title/detail for a single ticket only', async () => {
    const s = setup([A, B]);
    await printLabels(s.deps, s.caller, {
      labelClass: 'ticket-work-tag', labels: L([A]), overrides: { title: '  Laptop\u0000\n 12 ', detail: 'x'.repeat(300) },
    });
    const vms = ((s.renderPdf.mock.calls[0] as unknown[])[1] as Array<{ viewModel: LabelViewModel }>).map((i) => i.viewModel);
    expect(vms[0].title).toBe('Laptop 12');
    expect(vms[0].detail).toHaveLength(120);
    expect(vms[0].url).toBe(`https://x.test/msp/tickets/${A}`);
    for (const body of [
      { labelClass: 'ticket-work-tag', labels: L([A, B]), overrides: { title: 'x' } },
      { labelClass: 'asset-identity', labels: L([A]), overrides: { title: 'x' } },
      { labelClass: 'ticket-work-tag', labels: L([A]), overrides: { title: 5 } },
    ]) {
      expect(await printLabels(s.deps, s.caller, body)).toMatchObject({ ok: false, status: 400 });
    }
    expect(sanitizeLabelOverride(' \u0007 ')).toBeNull();
  });

  it('T-asset-link: merges linked asset parts into ticket view models, one entry per subject', async () => {
    const s = setup([A]);
    const parts = s.deps.getLinkedAssetParts as ReturnType<typeof vi.fn>;
    parts.mockResolvedValue([{ assetId: C, assetTag: 'WL-1', serialSuffix: '9876' }]);
    await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', labels: [{ recordId: A, linkedAssetId: C }] });
    expect(parts.mock.calls[0][1]).toEqual([{ recordId: A, linkedAssetId: C }]);
    const vms = ((s.renderPdf.mock.calls[0] as unknown[])[1] as Array<{ viewModel: LabelViewModel }>).map((i) => i.viewModel);
    expect(vms[0]).toMatchObject({ secondaryIdentifier: 'WL-1', serialSuffix: '9876' });
  });

  it('F3: one ticket named three times with different picks gives three labels, each with its own parts', async () => {
    const s = setup([A]);
    const parts = s.deps.getLinkedAssetParts as ReturnType<typeof vi.fn>;
    parts.mockResolvedValue(
      ['Shelf 1', 'Shelf 2', 'Shelf 3'].map((custodyLocation, i) => ({
        assetId: `asset-${i}`, assetTag: `T${i}`, serialSuffix: null, custodyLocation, nextAction: null,
      }))
    );
    const labels = [A, A, A].map((recordId, i) => ({ recordId, linkedAssetId: `${i}${C.slice(1)}` }));
    const r = await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', labels });
    expect(r).toMatchObject({ ok: true, skipped: 0 });
    expect(s.provider.getLabelViewModels).toHaveBeenCalledWith(expect.anything(), [A]); // once per unique record
    const vms = ((s.renderPdf.mock.calls[0] as unknown[])[1] as Array<{ viewModel: LabelViewModel }>).map((i) => i.viewModel);
    expect(vms.map((v) => v.custodyLocation)).toEqual(['Shelf 1', 'Shelf 2', 'Shelf 3']);
    expect(vms.map((v) => v.secondaryIdentifier)).toEqual(['T0', 'T1', 'T2']);
  });

  it('skips are counted per subject; an unreadable ticket named three times counts three', async () => {
    const s = setup([A]);
    const r = await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', labels: L([A, B, B, B]) });
    expect(r).toMatchObject({ ok: true, skipped: 3 });
    const parts = s.deps.getLinkedAssetParts as ReturnType<typeof vi.fn>;
    expect(parts.mock.calls[0][1]).toEqual([{ recordId: A }]);
  });

  it('overrides need exactly one distinct recordId (repeated is fine, two distinct is a 400)', async () => {
    const s = setup([A, B]);
    expect(
      await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', labels: L([A, A]), overrides: { title: 'x' } })
    ).toMatchObject({ ok: true });
    expect(
      await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', labels: L([A, B]), overrides: { title: 'x' } })
    ).toMatchObject({ ok: false, status: 400 });
  });

  it('linkedAssetId on another label class is dropped silently, not rejected', async () => {
    const s = setup([A]);
    s.deps.providers['asset-identity'] = { ...s.provider, entityType: 'asset', labelClass: 'asset-identity' } as never;
    const r = await printLabels(s.deps, s.caller, { labelClass: 'asset-identity', labels: [{ recordId: A, linkedAssetId: C }] });
    expect(r).toMatchObject({ ok: true });
  });

  it('the removed `ids` and `items` fields are rejected, and top-level `linkedAssetId` is ignored', async () => {
    const s = setup([A]);
    expect(await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', ids: [A] } as never)).toMatchObject({ ok: false, status: 400 });
    expect(await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', labels: L([A]), ids: [A] } as never)).toMatchObject({ ok: false, status: 400 });
    expect(await printLabels(s.deps, s.caller, { items: [{ labelClass: 'ticket-work-tag', id: A }] } as never)).toMatchObject({ ok: false, status: 400 });
    expect(await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', labels: L([A]), items: [] } as never)).toMatchObject({ ok: false, status: 400 });
    expect(s.provider.getLabelViewModels).not.toHaveBeenCalled();
    const r = await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', labels: L([A]), linkedAssetId: C } as never);
    expect((s.deps.getLinkedAssetParts as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual([{ recordId: A }]);
    expect(r).toMatchObject({ ok: true });
  });

  it('T-custody: merges custody lines from the same seam; a ticket with no readable held asset is unchanged', async () => {
    const s = setup([A, B]);
    (s.deps.getLinkedAssetParts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { assetId: C, assetTag: 'WL-1', serialSuffix: null, custodyLocation: 'Main Office / Shelf B3', nextAction: 'Waiting on vendor, Oct 29' },
      null,
    ]);
    await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', labels: L([A, B]) });
    const vms = ((s.renderPdf.mock.calls[0] as unknown[])[1] as Array<{ viewModel: LabelViewModel }>).map((i) => i.viewModel);
    expect(vms[0]).toMatchObject({ custodyLocation: 'Main Office / Shelf B3', nextAction: 'Waiting on vendor, Oct 29' });
    expect(vms[1].custodyLocation ?? null).toBeNull();
    expect(vms[1].nextAction ?? null).toBeNull();
    // Only the seam is called: printing has no write dependency to call.
    expect(s.deps.getLinkedAssetParts).toHaveBeenCalledTimes(1);
  });

  it('T-resolve: a template of the wrong class is a 400 before any data read', async () => {
    const s = setup([A]);
    (s.deps.resolveTemplate as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, message: 'wrong class' });
    expect(await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', labels: L([A]), templateId: 'standard-asset-label' }))
      .toEqual({ ok: false, status: 400, message: 'wrong class' });
    expect(s.provider.getLabelViewModels).not.toHaveBeenCalled();
  });

  it('client-portal users get the same 404 without touching the provider', async () => {
    const s = setup([A], 'client');
    const r = await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', labels: L([A]) });
    expect(r).toEqual({ ok: false, status: 404, message: 'Not found.' });
    expect(s.provider.getLabelViewModels).not.toHaveBeenCalled();
  });

  it('validates input before any data access', async () => {
    const s = setup([A]);
    for (const body of [
      { labelClass: 'nope', labels: L([A]) },
      { labelClass: 'ticket-work-tag', labels: L([]) },
      { labelClass: 'ticket-work-tag', labels: L(['not-a-uuid']) },
      { labelClass: 'ticket-work-tag', labels: L(Array(201).fill(A)) },
      { labelClass: 'ticket-work-tag', labels: L([A]), templateCode: 5 },
    ]) {
      expect(await printLabels(s.deps, s.caller, body)).toMatchObject({ ok: false, status: 400 });
    }
    expect(s.provider.getLabelViewModels).not.toHaveBeenCalled();
  });

  it('a class without a provider is a 422, not a data read', async () => {
    const s = setup([A]);
    expect(await printLabels(s.deps, s.caller, { labelClass: 'asset-identity', labels: L([A]) })).toMatchObject({ status: 422 });
  });

  it('maps renderer client errors to 422 and rethrows others', async () => {
    const s = setup([A]);
    s.renderPdf.mockRejectedValueOnce(new Error('bad layout'));
    s.deps.describeClientError = (e) => ({ message: (e as Error).message });
    expect(await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', labels: L([A]) })).toEqual({
      ok: false,
      status: 422,
      message: 'bad layout',
    });
    s.renderPdf.mockRejectedValueOnce(new Error('boom'));
    s.deps.describeClientError = () => null;
    await expect(printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', labels: L([A]) })).rejects.toThrow('boom');
  });

  it('a 422 lists every record that cannot print, with the suggested template', async () => {
    const s = setup([A, B, C]);
    const failures = [
      { index: 0, recordId: A, identifier: 'levelio:Z2lk', templateCode: 'standard-asset-label-code128', message: 'too long', suggestedTemplateCode: 'standard-asset-label' },
      { index: 2, recordId: C, identifier: 'levelio:Z2lm', templateCode: 'standard-asset-label-code128', message: 'too long', suggestedTemplateCode: 'standard-asset-label' },
    ];
    s.renderPdf.mockRejectedValueOnce(new Error('2 of 3 labels cannot be printed'));
    s.deps.describeClientError = (e) => ({ message: (e as Error).message, failures });
    expect(await printLabels(s.deps, s.caller, { labelClass: 'ticket-work-tag', labels: L([A, B, C]) })).toEqual({
      ok: false,
      status: 422,
      message: '2 of 3 labels cannot be printed',
      failures,
    });
  });

  describe('mixed items (C6 bulk print)', () => {
    const boxVm = (id: string): LabelViewModel => ({
      labelClass: 'staging-container', entityType: 'staging_container', recordId: id,
      url: `https://x.test/msp/projects/${C}/staging?containerId=${id}`, identifier: `PRJ-1-B0${id.slice(0, 1)}`,
      code128Value: `PRJ-1-B0${id.slice(0, 1)}`, title: null, clientName: null, detail: null,
      secondaryIdentifier: null, serialSuffix: null, sequence: { n: 1, total: 2 },
    });
    const mixedSetup = (readableBoxes: string[], readableTickets: string[]) => {
      const s = setup(readableTickets);
      const boxes: LabelViewModelProvider = {
        entityType: 'staging_container', labelClass: 'staging-container',
        getLabelViewModels: vi.fn(async (_c, ids) => ids.map((i) => (readableBoxes.includes(i) ? boxVm(i) : null))),
      };
      s.deps.providers['staging-container'] = boxes;
      (s.deps.resolveTemplate as ReturnType<typeof vi.fn>).mockImplementation(async (_t: string, cls: string) => ({
        ok: true as const, templateCode: `standard-${cls}`,
      }));
      return { ...s, boxes };
    };

    it('keeps request order across classes, one provider call per class, each with its own template', async () => {
      const s = mixedSetup([A, B], [C]);
      const r = await printLabels(s.deps, s.caller, {
        labels: [
          { labelClass: 'staging-container', recordId: A },
          { labelClass: 'ticket-work-tag', recordId: C },
          { labelClass: 'staging-container', recordId: B },
        ],
      });
      expect(r).toMatchObject({ ok: true, skipped: 0 });
      expect(s.boxes.getLabelViewModels).toHaveBeenCalledTimes(1);
      expect((s.boxes.getLabelViewModels as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual([A, B]);
      const items = (s.renderPdf.mock.calls[0] as unknown[])[1] as Array<{ viewModel: LabelViewModel; templateCode: string }>;
      expect(items.map((i) => [i.viewModel.recordId, i.templateCode])).toEqual([
        [A, 'standard-staging-container'],
        [C, 'standard-ticket-work-tag'],
        [B, 'standard-staging-container'],
      ]);
    });

    it('skips and counts unreadable records; nothing readable is the uniform 404', async () => {
      const s = mixedSetup([A], []);
      const partial = await printLabels(s.deps, s.caller, {
        labels: [{ labelClass: 'staging-container', recordId: A }, { labelClass: 'ticket-work-tag', recordId: B }],
      });
      expect(partial).toMatchObject({ ok: true, skipped: 1 });
      const none = await printLabels(s.deps, s.caller, { labels: [{ labelClass: 'staging-container', recordId: B }] });
      expect(none).toEqual({ ok: false, status: 404, message: 'Not found.' });
    });

    it('validates labels and the shared cap, and refuses template/overrides on a mixed request before any data read', async () => {
      const s = mixedSetup([A], [A]);
      const mix = [{ labelClass: 'staging-container', recordId: A }, { labelClass: 'ticket-work-tag', recordId: A }];
      for (const body of [
        { labels: [] },
        { labels: Array(201).fill({ labelClass: 'staging-container', recordId: A }) },
        { labels: [{ labelClass: 'nope', recordId: A }] },
        { labels: [{ labelClass: 'staging-container', recordId: 'x' }] },
        { labels: mix, templateId: 'standard-staging-container' },
        { labels: mix, overrides: { title: 'x' } },
      ]) {
        expect(await printLabels(s.deps, s.caller, body)).toMatchObject({ ok: false, status: 400 });
      }
      expect(s.boxes.getLabelViewModels).not.toHaveBeenCalled();
      expect(s.provider.getLabelViewModels).not.toHaveBeenCalled();
    });

    it('a subject class wins over the request default; the default fills subjects without one', async () => {
      const s = mixedSetup([A], [C]);
      const r = await printLabels(s.deps, s.caller, {
        labelClass: 'ticket-work-tag',
        labels: [{ recordId: C }, { labelClass: 'staging-container', recordId: A }],
      });
      expect(r).toMatchObject({ ok: true, skipped: 0 });
      const items = (s.renderPdf.mock.calls[0] as unknown[])[1] as Array<{ viewModel: LabelViewModel }>;
      expect(items.map((i) => i.viewModel.recordId)).toEqual([C, A]);
    });

    it('a mixed request counts skips per subject', async () => {
      const s = mixedSetup([A], [C]);
      const r = await printLabels(s.deps, s.caller, {
        labels: [
          { labelClass: 'staging-container', recordId: A },
          { labelClass: 'ticket-work-tag', recordId: B },
          { labelClass: 'ticket-work-tag', recordId: B },
          { labelClass: 'ticket-work-tag', recordId: C },
        ],
      });
      expect(r).toMatchObject({ ok: true, skipped: 2 });
    });

    it('a subject with no class and no request default is a 400', async () => {
      const s = mixedSetup([A], [A]);
      expect(await printLabels(s.deps, s.caller, { labels: [{ recordId: A }] })).toMatchObject({ ok: false, status: 400 });
      expect(await printLabels(s.deps, s.caller, { labels: [{ labelClass: 'ticket-work-tag', recordId: A }, { recordId: B }] })).toMatchObject({ ok: false, status: 400 });
      expect(s.provider.getLabelViewModels).not.toHaveBeenCalled();
    });

    it('a mixed batch is all-or-nothing on render failure', async () => {
      const s = mixedSetup([A], [C]);
      s.renderPdf.mockRejectedValueOnce(new Error('1 of 2 labels cannot be printed'));
      s.deps.describeClientError = (e) => ({ message: (e as Error).message });
      expect(await printLabels(s.deps, s.caller, {
        labels: [{ labelClass: 'staging-container', recordId: A }, { labelClass: 'ticket-work-tag', recordId: C }],
      })).toEqual({ ok: false, status: 422, message: '1 of 2 labels cannot be printed' });
    });
  });
});
