/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CoManagedTicketHandbackComposer from '../../../components/co-managed/CoManagedTicketHandbackComposer';

/**
 * Ticket-list T013 — uncertain-handback session recovery.
 *
 * This is the case where being wrong duplicates or loses customer work: the
 * transport is lost after a handback was sent, the operator reloads, and the
 * question is whether the browser replays the SAME command or invents a new
 * one. The composer implements versioning, a 24-hour expiry, actor-scoped keys
 * and a deliberate never-auto-submit rule, and none of it was tested — the only
 * component tests on this path target CoManagedTicketBulkHandback, the
 * checklist F028/F039 exist to retire.
 *
 * The persistence helpers are module-private on purpose, so these drive the
 * real component against real sessionStorage rather than reaching inside it.
 */

const mocks = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock('../../../lib/actions/coManagedTicketQueueActions', () => ({
  bulkHandBackCoManagedTicketsAction: mocks.submit,
}));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata() {}, updateActions() {} }),
}));
vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: ({ id, label, ...props }: any) => <label htmlFor={id}>{label}<textarea id={id} {...props} /></label>,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key }), useOptionalI18n: () => null,
}));

const ACTOR = 'msp-tenant:user-1';
const KEY = `co-managed:handback-intent:${ACTOR}`;

const items = () => ([
  { tenant: 'a', relationshipId: 'relationship-a', ticketId: 'ticket-a', workspaceName: 'Customer A',
    fields: { ticket_number: 'T-1', title: 'Printer', responsibility: 'msp', work_revision: 3 } },
] as any);

/** A persisted intent exactly as the composer writes one. */
function intent(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    expiresAt: Date.now() + 60_000,
    actorScope: ACTOR,
    labels: ['Customer A · T-1 · Printer'],
    request: {
      note: 'Returned while the link dropped',
      items: [{
        operationId: 'frozen-operation-id',
        expectedRevision: 3,
        resource: { kind: 'ticket', tenant: 'a', relationshipId: 'relationship-a', id: 'ticket-a' },
      }],
    },
    ...overrides,
  });
}

const renderComposer = (props: Record<string, unknown> = {}) =>
  render(<CoManagedTicketHandbackComposer selectedItems={items()} onDone={vi.fn()} actorScope={ACTOR} {...props} />);

beforeEach(() => { vi.resetAllMocks(); window.sessionStorage.clear(); });
afterEach(cleanup);

describe('restoring an unresolved handback', () => {
  it('never submits a restored intent automatically', () => {
    // The whole point. A reload must not re-send a command the operator has
    // not confirmed; it must ask.
    window.sessionStorage.setItem(KEY, intent());
    renderComposer();
    expect(screen.getByRole('alert')).toHaveTextContent('coManaged.queue.bulkHandback.resume');
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('replays the EXACT frozen command, not a newly built one', async () => {
    // A fresh build would mint a new operationId, and the server would treat
    // the retry as a second handback instead of the same one.
    mocks.submit.mockResolvedValue([{ index: 0, ok: true, receipt: {} }]);
    window.sessionStorage.setItem(KEY, intent());
    renderComposer();
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.retry' }));
    await screen.findByRole('status');
    const sent = mocks.submit.mock.lastCall![0];
    expect(sent.items[0].operationId).toBe('frozen-operation-id');
    expect(sent.items[0].expectedRevision).toBe(3);
    expect(sent.note).toBe('Returned while the link dropped');
  });

  it('clears the persisted intent once the result is known', async () => {
    mocks.submit.mockResolvedValue([{ index: 0, ok: true, receipt: {} }]);
    window.sessionStorage.setItem(KEY, intent());
    renderComposer();
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.retry' }));
    await screen.findByRole('status');
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('discarding removes the intent and returns to the ordinary composer', () => {
    window.sessionStorage.setItem(KEY, intent());
    renderComposer();
    fireEvent.click(screen.getByRole('button', { name: 'actions.cancel' }));
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('coManaged.ticket.note')).toBeInTheDocument();
  });
});

describe('intents that must NOT be restored', () => {
  it('ignores and deletes an expired intent', () => {
    // A day-old handback is not something to resume blind.
    window.sessionStorage.setItem(KEY, intent({ expiresAt: Date.now() - 1 }));
    renderComposer();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('ignores an intent belonging to a different actor', () => {
    // Actor scoping is what stops one operator resuming another's work on a
    // shared machine. The key is per-actor AND the payload is re-checked.
    window.sessionStorage.setItem(`co-managed:handback-intent:other-actor`, intent({ actorScope: 'other-actor' }));
    renderComposer();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores an intent whose actorScope does not match its own key', () => {
    window.sessionStorage.setItem(KEY, intent({ actorScope: 'someone-else' }));
    renderComposer();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores an intent written by an older format version', () => {
    window.sessionStorage.setItem(KEY, intent({ version: 0 }));
    renderComposer();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores a corrupt payload instead of throwing', () => {
    window.sessionStorage.setItem(KEY, '{not json');
    expect(() => renderComposer()).not.toThrow();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores an intent with no items', () => {
    window.sessionStorage.setItem(KEY, intent({ request: { note: 'n', items: [] } }));
    renderComposer();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('persisting before the first submission', () => {
  it('writes the replay command BEFORE the action is called', async () => {
    // If the write happened after the response, a lost transport would leave
    // nothing to replay and the retry would mint a new operation identity.
    let storedAtCallTime: string | null = null;
    mocks.submit.mockImplementation(async () => {
      storedAtCallTime = window.sessionStorage.getItem(KEY);
      return [{ index: 0, ok: true, receipt: {} }];
    });
    renderComposer();
    fireEvent.change(screen.getByLabelText('coManaged.ticket.note'), { target: { value: 'Back to you' } });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.handback' }));
    await screen.findByRole('status');
    expect(storedAtCallTime).not.toBeNull();
    const persisted = JSON.parse(storedAtCallTime!);
    expect(persisted.request.items[0].operationId).toBe(mocks.submit.mock.lastCall![0].items[0].operationId);
    expect(persisted.actorScope).toBe(ACTOR);
  });

  it('survives an uncertain result so a reload can resume it', async () => {
    mocks.submit.mockRejectedValue(new Error('transport lost'));
    renderComposer();
    fireEvent.change(screen.getByLabelText('coManaged.ticket.note'), { target: { value: 'Back to you' } });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.handback' }));
    await screen.findByText('coManaged.ticket.uncertain');
    // Still stored: the operator can reload and be offered the same command.
    expect(window.sessionStorage.getItem(KEY)).not.toBeNull();
  });

  it('says so, and still allows a retry, when storage is unavailable', async () => {
    // Private-browsing and locked-down profiles throw from setItem. Losing
    // reload recovery must not cost the operator the handback itself.
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    mocks.submit.mockResolvedValue([{ index: 0, ok: true, receipt: {} }]);
    renderComposer();
    fireEvent.change(screen.getByLabelText('coManaged.ticket.note'), { target: { value: 'Back to you' } });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.ticket.handback' }));
    await screen.findByRole('status');
    expect(screen.getByText('coManaged.queue.bulkHandback.noReloadRecovery')).toBeInTheDocument();
    expect(mocks.submit).toHaveBeenCalledOnce();
    setItem.mockRestore();
  });
});
