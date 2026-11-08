// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTicketMergedPayload } from '@alga-psa/shared/lib/tickets/ticketWorkflowEventPayloads';
import type { BundleAttachResult, BundleModeChangeResult } from './ticketBundleUtils';
import {
  addChildrenToBundleAction,
  bundleTicketsAction,
  updateBundleSettingsAction,
} from './ticketBundleActions';

const mocks = vi.hoisted(() => ({
  attach: vi.fn<(...args: unknown[]) => Promise<BundleAttachResult>>(),
  changeSettings: vi.fn<(...args: unknown[]) => Promise<BundleModeChangeResult>>(),
  registerAfterCommit: vi.fn(),
  revalidatePath: vi.fn(),
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: unknown[]) =>
    action({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_db: unknown, callback: (trx: unknown) => unknown) => callback({}),
  registerAfterCommit: mocks.registerAfterCommit,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: mocks.publishWorkflowEvent }));
vi.mock('./ticketBundleUtils', () => ({
  attachChildrenToBundle: mocks.attach,
  changeBundleSettings: mocks.changeSettings,
}));

const masterTicketId = '11111111-1111-4111-8111-111111111111';
const childTicketIds = ['22222222-2222-4222-8222-222222222222'];
const input = { masterTicketId, childTicketIds };

beforeEach(() => vi.resetAllMocks());

describe.each([
  ['bundleTicketsAction', bundleTicketsAction],
  ['addChildrenToBundleAction', addChildrenToBundleAction],
] as const)('%s result handling', (_name, action) => {
  it('returns a localized business failure without publishing or refreshing tickets', async () => {
    mocks.attach.mockResolvedValue({
      ok: false,
      code: 'already_bundled',
      childTicketId: childTicketIds[0],
      childTicketNumber: 'T-42',
    });

    expect(await action(input)).toEqual({
      actionError: 'Ticket is already bundled: T-42',
      messageKey: 'features/tickets:errors.bundle.alreadyBundled',
      messageParams: { ticket: 'T-42' },
    });
    expect(mocks.registerAfterCommit).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('returns the attached tickets and schedules their events after commit', async () => {
    const payload = buildTicketMergedPayload({
      sourceTicketId: childTicketIds[0], targetTicketId: masterTicketId,
      mergedAt: '2026-11-08T12:00:00Z', reason: 'bundle:added_children',
    });
    mocks.attach.mockResolvedValue({
      ok: true,
      value: {
        masterTicketId,
        childTicketIds,
        publications: [{ eventType: 'TICKET_MERGED', payload }],
      },
    });

    expect(await action(input)).toMatchObject({ masterTicketId, childTicketIds });
    expect(mocks.registerAfterCommit).toHaveBeenCalledTimes(1);
    expect(mocks.registerAfterCommit).toHaveBeenCalledWith(
      expect.anything(), expect.any(Function), 'TICKET_MERGED bundle-attach',
    );
    expect(mocks.publishWorkflowEvent).not.toHaveBeenCalled();
    await mocks.registerAfterCommit.mock.calls[0][1]();
    expect(mocks.publishWorkflowEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'TICKET_MERGED', payload,
      ctx: expect.objectContaining({ tenantId: 'tenant-1' }),
    }));
  });
});

describe('updateBundleSettingsAction result handling', () => {
  it('returns a closed-master policy failure without scheduling events', async () => {
    mocks.changeSettings.mockResolvedValue({
      ok: false, code: 'choice_required', allowedChoices: ['reopen_master'],
    });

    expect(await updateBundleSettingsAction({ masterTicketId, mode: 'sync_updates' })).toEqual({
      actionError: "This bundle's master is closed. Choose how to add the child: reopen the master.",
      messageKey: 'features/tickets:errors.bundle.closedMasterChoiceRequired',
      messageParams: { choices: 'reopen the master' },
    });
    expect(mocks.registerAfterCommit).not.toHaveBeenCalled();
  });

  it('returns a user-safe failure when bundle settings do not exist', async () => {
    mocks.changeSettings.mockResolvedValue({ ok: false, code: 'settings_not_found' });

    expect(await updateBundleSettingsAction({ masterTicketId })).toMatchObject({
      actionError: 'Bundle settings not found',
    });
    expect(mocks.registerAfterCommit).not.toHaveBeenCalled();
  });

  it('returns the saved settings on success', async () => {
    const settings = {
      master_ticket_id: masterTicketId, mode: 'sync_updates' as const, reopen_on_child_reply: true,
    };
    mocks.changeSettings.mockResolvedValue({
      ok: true, value: { settings, publications: [] },
    });

    expect(await updateBundleSettingsAction({ masterTicketId, mode: 'sync_updates' })).toEqual(settings);
  });
});
