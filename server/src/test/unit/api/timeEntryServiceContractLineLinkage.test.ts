// @vitest-environment node

/**
 * REST time-entry contract-line linkage decisions (alga0002015).
 * The eligibility query and work-item lookup are mocked; this pins the REST-only rules that sit in
 * front of the shared write core: explicit-line validation, the ambiguity 400, PATCH preservation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getEligibleContractLines = vi.fn();
const getWorkItemBillingContext = vi.fn();

vi.mock('@alga-psa/scheduling/lib/contractLineDisambiguation', () => ({
  getEligibleContractLines: (...args: unknown[]) => getEligibleContractLines(...args),
}));
vi.mock('@alga-psa/scheduling/lib/timeEntryWriteCore', () => ({
  getWorkItemBillingContext: (...args: unknown[]) => getWorkItemBillingContext(...args),
  persistTimeEntry: vi.fn(),
  publishPersistedTimeEntryEvents: vi.fn(),
}));
vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
}));
vi.mock('@alga-psa/scheduling/lib/stopwatch/stopwatchCore', () => ({
  StopwatchConflictError: class extends Error {},
  getOpenSession: vi.fn(),
  getSession: vi.fn(),
  logSession: vi.fn(),
  startSession: vi.fn(),
}));
vi.mock('server/src/lib/api/services/StopwatchApiService', () => ({
  mapStopwatchError: (e: unknown) => e,
  publishLoggedSessionEvents: vi.fn(),
}));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  tenantDb: vi.fn(() => ({})),
}));

import { TimeEntryService } from '../../../lib/api/services/TimeEntryService';
import { ValidationError } from '../../../lib/api/middleware/apiMiddleware';

const line = (id: string, extra: Record<string, unknown> = {}) => ({
  client_contract_line_id: id,
  contract_line_id: id,
  contract_line_name: `Line ${id}`,
  contract_line_type: 'Hourly',
  contract_id: `contract-${id}`,
  contract_name: `Contract ${id}`,
  ...extra,
});

const service = new TimeEntryService() as any;
const context = { tenant: 't1' } as any;
const base = { workItemType: 'ticket', workItemId: 'tk1', serviceId: 's1', workDate: '2026-10-01', explicitContractLineId: null };

beforeEach(() => {
  getEligibleContractLines.mockReset();
  getWorkItemBillingContext.mockReset();
  getWorkItemBillingContext.mockResolvedValue({ clientId: 'c1', billingProfileId: null });
});

describe('create: resolveContractLineForWrite', () => {
  it('links the single eligible line and records auto provenance', async () => {
    getEligibleContractLines.mockResolvedValue([line('L1')]);
    expect(await service.resolveContractLineForWrite({}, context, base)).toEqual({ id: 'L1', source: 'auto_unique_service' });
  });

  it('uses a valid explicit line', async () => {
    getEligibleContractLines.mockResolvedValue([line('L1'), line('L2')]);
    expect(await service.resolveContractLineForWrite({}, context, { ...base, explicitContractLineId: 'L2' }))
      .toEqual({ id: 'L2', source: 'explicit' });
  });

  it('400s on an explicit line that is not eligible', async () => {
    getEligibleContractLines.mockResolvedValue([line('L1')]);
    const err = await service.resolveContractLineForWrite({}, context, { ...base, explicitContractLineId: 'NOPE' }).catch((e: any) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.statusCode).toBe(400);
    expect(err.details.reason).toBe('contract_line_not_eligible');
  });

  it('400s on ambiguity and lists candidates', async () => {
    getEligibleContractLines.mockResolvedValue([line('L1'), line('L2', { contract_line_type: 'Fixed' })]);
    const err = await service.resolveContractLineForWrite({}, context, base).catch((e: any) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.details.reason).toBe('contract_line_ambiguous');
    expect(err.details.eligible_contract_lines).toEqual([
      expect.objectContaining({ contract_line_id: 'L1', contract_line_name: 'Line L1', contract_name: 'Contract L1', contract_line_type: 'Hourly' }),
      expect.objectContaining({ contract_line_id: 'L2', contract_line_type: 'Fixed' }),
    ]);
  });

  it('narrows by the work item billing profile instead of 400ing', async () => {
    getWorkItemBillingContext.mockResolvedValue({ clientId: 'c1', billingProfileId: 'bp1' });
    getEligibleContractLines.mockResolvedValue([line('L1', { billing_profile_id: 'bp1' }), line('L2')]);
    expect(await service.resolveContractLineForWrite({}, context, base)).toEqual({ id: 'L1', source: 'auto_billing_profile' });
  });

  it('no eligible line: entry still saves, unresolved (UI outcome)', async () => {
    getEligibleContractLines.mockResolvedValue([]);
    expect(await service.resolveContractLineForWrite({}, context, base)).toEqual({ id: null, source: 'unresolved' });
  });

  it('work item without a client resolves nothing and never queries eligibility', async () => {
    getWorkItemBillingContext.mockResolvedValue({ clientId: null, billingProfileId: null });
    expect(await service.resolveContractLineForWrite({}, context, base)).toEqual({ id: null, source: 'unresolved' });
    expect(getEligibleContractLines).not.toHaveBeenCalled();
  });
});

describe('update: resolveContractLineForUpdate', () => {
  const existing = { contract_line_id: 'L1', contract_line_source: 'auto_unique_service' };
  const upd = { ...base, isBillable: true, linkageInputsChanged: false };

  it('keeps the stored line (and provenance) when nothing linkage-relevant changed, without querying', async () => {
    expect(await service.resolveContractLineForUpdate({}, context, existing, upd))
      .toEqual({ id: 'L1', source: 'auto_unique_service' });
    expect(getEligibleContractLines).not.toHaveBeenCalled();
  });

  it('a notes-only edit of a legacy unlinked entry stays unlinked, even if now ambiguous', async () => {
    expect(await service.resolveContractLineForUpdate({}, context, { contract_line_id: null, contract_line_source: null }, upd))
      .toEqual({ id: null, source: null });
  });

  it('keeps the line after a service change when it is still eligible, even if others are too', async () => {
    getEligibleContractLines.mockResolvedValue([line('L1'), line('L2')]);
    expect(await service.resolveContractLineForUpdate({}, context, existing, { ...upd, linkageInputsChanged: true }))
      .toEqual({ id: 'L1', source: 'auto_unique_service' });
  });

  it('re-resolves when the line is no longer eligible', async () => {
    getEligibleContractLines.mockResolvedValue([line('L9')]);
    expect(await service.resolveContractLineForUpdate({}, context, existing, { ...upd, linkageInputsChanged: true }))
      .toEqual({ id: 'L9', source: 'auto_unique_service' });
  });

  it('400s when re-resolution is ambiguous', async () => {
    getEligibleContractLines.mockResolvedValue([line('L8'), line('L9')]);
    const err = await service.resolveContractLineForUpdate({}, context, existing, { ...upd, linkageInputsChanged: true }).catch((e: any) => e);
    expect(err.details.reason).toBe('contract_line_ambiguous');
  });

  it('clears the line when the service is no longer covered by any line', async () => {
    getEligibleContractLines.mockResolvedValue([]);
    expect(await service.resolveContractLineForUpdate({}, context, existing, { ...upd, linkageInputsChanged: true }))
      .toEqual({ id: null, source: 'unresolved' });
  });

  it('validates a caller-supplied line on PATCH', async () => {
    getEligibleContractLines.mockResolvedValue([line('L1'), line('L2')]);
    expect(await service.resolveContractLineForUpdate({}, context, existing, { ...upd, explicitContractLineId: 'L2' }))
      .toEqual({ id: 'L2', source: 'explicit' });
    await expect(service.resolveContractLineForUpdate({}, context, existing, { ...upd, explicitContractLineId: 'X' }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('non-billable carries no linkage', async () => {
    expect(await service.resolveContractLineForUpdate({}, context, existing, { ...upd, isBillable: false }))
      .toEqual({ id: null, source: null });
  });
});
