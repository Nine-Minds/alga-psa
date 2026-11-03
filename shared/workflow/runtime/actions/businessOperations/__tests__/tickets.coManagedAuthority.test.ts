import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coManagedWorkflowTicketSeam } from '../../../../../lib/coManagedDelivery';
import { retainWorkflowTicketAuthority } from '../shared';

const { servesMock, loggerErrorMock } = vi.hoisted(() => ({
  servesMock: vi.fn(async (..._args: unknown[]) => ({ served: false, reasons: { served: 'not-participating' } })),
  loggerErrorMock: vi.fn((..._args: unknown[]) => undefined)
}));
vi.mock('@alga-psa/core/capability', () => ({ serves: (...args: unknown[]) => servesMock(...args) }));
vi.mock('@alga-psa/core/logger', () => ({ default: { error: (...args: unknown[]) => loggerErrorMock(...args) } }));

const ctx = { runId: 'run-1', stepPath: 'a.b' } as any;
const tx = { tenantId: 'tenant-1', trx: { marker: 'trx' }, actorUserId: 'user-1' } as any;

describe('workflow ticket mutation adapter (L4a workflowTicketAuthority)', () => {
  const original = process.env.FORCE_CAPABILITIES;
  beforeEach(() => {
    coManagedWorkflowTicketSeam.reset();
    servesMock.mockReset().mockResolvedValue({ served: false, reasons: { served: 'not-participating' } } as any);
    loggerErrorMock.mockReset();
  });
  afterEach(() => { coManagedWorkflowTicketSeam.reset(); process.env.FORCE_CAPABILITIES = original ?? ''; });

  it('allows a tenant only after authoritative classification says it is not served', async () => {
    await expect(retainWorkflowTicketAuthority(ctx, tx, 't1', ['comments'])).resolves.toBeUndefined();
    expect(servesMock).toHaveBeenCalledWith('co-managed', 'tenant-1');
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('fails closed when tenant classification is inconclusive', async () => {
    servesMock.mockResolvedValue({ served: false, reasons: { served: 'participation-error' } } as any);
    await expect(retainWorkflowTicketAuthority(ctx, tx, 't1', ['comments'])).rejects.toMatchObject({ code: 'AUTHORIZATION_UNAVAILABLE' });
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a served tenant has no registered authority provider', async () => {
    servesMock.mockResolvedValue({ served: true, reasons: { served: 'open' } } as any);
    await expect(retainWorkflowTicketAuthority(ctx, tx, 't1', ['comments'])).rejects.toMatchObject({ code: 'AUTHORIZATION_UNAVAILABLE' });
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
  });

  it('does not construct the provider for a tenant that is not served', async () => {
    const factory = vi.fn(() => { throw new Error('must not be built'); });
    coManagedWorkflowTicketSeam.register(factory);
    servesMock.mockResolvedValue({ served: false, reasons: { served: 'not-participating' } } as any);
    await retainWorkflowTicketAuthority(ctx, tx, 't1', ['status_id']);
    expect(factory).not.toHaveBeenCalled();
  });

  it('retains run / author authority inside the action transaction for a served tenant, and publishes nothing', async () => {
    const retain = vi.fn(async () => undefined);
    coManagedWorkflowTicketSeam.register(() => ({ retain }) as any);
    servesMock.mockResolvedValue({ served: true, reasons: { served: 'open' } } as any);
    await retainWorkflowTicketAuthority(ctx, tx, 't1', ['assignment']);
    expect(retain).toHaveBeenCalledWith(tx.trx, { tenant: 'tenant-1', ticketId: 't1', workflowRunId: 'run-1', actorUserId: 'user-1', fields: ['assignment'], readFields: [] });
  });

});
