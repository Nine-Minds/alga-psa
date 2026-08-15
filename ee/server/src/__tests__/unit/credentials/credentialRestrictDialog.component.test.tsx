// @vitest-environment jsdom
/**
 * CredentialRestrictDialog component tests — Save is keyed to the successfully
 * loaded detail of the CURRENT credential:
 *  - Save is inert (button disabled, submit never fires) until the detail load
 *    for the current credential has resolved with the real grant list — an
 *    early save would replace stored grants with the seed's empty list.
 *  - Close (null) and every reopen re-arm all gating: pending, failing, or
 *    empty re-opened details keep Save inert, and nothing from a previous open
 *    can leak into the next one.
 *  - A detail-load failure (rejected or resolved-empty) is surfaced as an error
 *    and never submits an empty grant list.
 *  - A stale in-flight response for a previously shown credential cannot
 *    populate the dialog now showing a different credential.
 *  - The load effect keys on the credential id, not object identity: a same-id
 *    re-render preserves in-progress edits instead of wiping them.
 */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCredentialMock,
  setCredentialRestrictionMock,
  getAllUsersMock,
  getTeamsMock,
} = vi.hoisted(() => ({
  getCredentialMock: vi.fn(),
  setCredentialRestrictionMock: vi.fn(),
  getAllUsersMock: vi.fn(),
  getTeamsMock: vi.fn(),
}));

vi.mock('@ee/lib/actions/credentials/credentialActions', () => ({
  getCredential: getCredentialMock,
  setCredentialRestriction: setCredentialRestrictionMock,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getAllUsers: getAllUsersMock,
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeams: getTeamsMock,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({
    children,
    isOpen,
    title,
    footer,
  }: {
    children: React.ReactNode;
    isOpen: boolean;
    title?: string;
    footer?: React.ReactNode;
  }) =>
    isOpen ? (
      <div data-testid="restrict-dialog">
        {title ? <h2>{title}</h2> : null}
        {children}
        {footer}
      </div>
    ) : null,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { id?: string }) => (
    <button id={id} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/SwitchWithLabel', () => ({
  SwitchWithLabel: ({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (c: boolean) => void }) => (
    <label>
      <input type="checkbox" checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} />
      {label}
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, id, variant }: { children: React.ReactNode; id?: string; variant?: string }) => (
    <div id={id} role="alert" data-variant={variant}>
      {children}
    </div>
  ),
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({
  default: ({ label }: { label?: string }) => <div>{label}</div>,
}));

vi.mock('lucide-react', () => ({
  X: () => <span>x</span>,
}));

import { CredentialRestrictDialog } from '@ee/components/credentials/CredentialRestrictDialog';
import type { CredentialSummary } from '@ee/lib/credentials/contracts';

function algaCredential(id: string, isRestricted = false): CredentialSummary {
  return {
    id,
    source: 'alga',
    clientId: 'client-1',
    name: 'Cred',
    username: null,
    url: null,
    description: null,
    hasOtp: false,
    isRestricted,
    folderName: null,
    externalUrl: null,
    attachments: [],
    createdAt: null,
    updatedAt: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  getCredentialMock.mockReset();
  setCredentialRestrictionMock.mockReset();
  getAllUsersMock.mockReset();
  getTeamsMock.mockReset();
  getAllUsersMock.mockResolvedValue([]);
  getTeamsMock.mockResolvedValue([]);
  setCredentialRestrictionMock.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CredentialRestrictDialog — save-before-load / stale response', () => {
  it('Save is inert while the detail is loading and submits the LOADED grant list once resolved', async () => {
    const detail = deferred<unknown>();
    getCredentialMock.mockReturnValue(detail.promise);

    const { getByTestId } = render(
      <CredentialRestrictDialog credential={algaCredential('cred-X')} onClose={vi.fn()} onSaved={vi.fn()} />
    );

    const save = getByTestId('restrict-dialog').querySelector('#credential-restrict-save') as HTMLButtonElement;

    // While the detail load is pending, Save is disabled: a click cannot submit
    // the seed's empty grant list.
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(setCredentialRestrictionMock).not.toHaveBeenCalled();

    // The real detail resolves: restricted with one user grant.
    detail.resolve({
      ...algaCredential('cred-X'),
      grants: [{ subjectType: 'user', subjectId: 'user-u1' }],
      isRestricted: true,
    });
    await waitFor(() => expect(save.disabled).toBe(false));

    // Saving now submits the LOADED grants — not the seed's empty list.
    fireEvent.click(save);
    expect(setCredentialRestrictionMock).toHaveBeenCalledWith('cred-X', {
      isRestricted: true,
      grants: [{ subjectType: 'user', subjectId: 'user-u1' }],
    });
  });

  it('a detail-load failure surfaces an error and never submits the empty grant list', async () => {
    getCredentialMock.mockRejectedValue(new Error('load boom'));

    const { getByTestId, queryByRole } = render(
      <CredentialRestrictDialog credential={algaCredential('cred-X')} onClose={vi.fn()} onSaved={vi.fn()} />
    );

    await waitFor(() => expect(getByTestId('restrict-dialog').querySelector('#credential-restrict-error')).not.toBeNull());
    expect(queryByRole('alert')?.textContent).toContain('credentials.restrict.loadFailed');

    const save = getByTestId('restrict-dialog').querySelector('#credential-restrict-save') as HTMLButtonElement;
    fireEvent.click(save);
    expect(setCredentialRestrictionMock).not.toHaveBeenCalled();
  });

  it('a stale response for a previously shown credential cannot populate the dialog now showing another credential', async () => {
    const detailX = deferred<unknown>();
    getCredentialMock.mockImplementation((id: string) => {
      if (id === 'cred-X') return detailX.promise;
      return Promise.resolve({
        ...algaCredential('cred-Y'),
        grants: [{ subjectType: 'user', subjectId: 'user-Y' }],
        isRestricted: true,
      });
    });

    const { getByTestId, rerender } = render(
      <CredentialRestrictDialog credential={algaCredential('cred-X')} onClose={vi.fn()} onSaved={vi.fn()} />
    );

    // Reopen for a different credential while X's load is still in flight.
    rerender(<CredentialRestrictDialog credential={algaCredential('cred-Y')} onClose={vi.fn()} onSaved={vi.fn()} />);

    // Y's own detail has loaded: its grant is shown and Save is enabled.
    const save = getByTestId('restrict-dialog').querySelector('#credential-restrict-save') as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    expect(getByTestId('restrict-dialog').textContent).toContain('user-Y');

    // X's stale response lands AFTER Y is showing — it must be discarded.
    detailX.resolve({
      ...algaCredential('cred-X'),
      grants: [{ subjectType: 'user', subjectId: 'user-X' }],
      isRestricted: true,
    });
    await waitFor(() => {
      expect(getByTestId('restrict-dialog').textContent).not.toContain('user-X');
      expect(getByTestId('restrict-dialog').textContent).toContain('user-Y');
    });

    // Saving submits Y's grants, never X's.
    fireEvent.click(save);
    expect(setCredentialRestrictionMock).toHaveBeenCalledWith('cred-Y', {
      isRestricted: true,
      grants: [{ subjectType: 'user', subjectId: 'user-Y' }],
    });
  });

  it('close/reopen re-arms the gate: a pending, failing, or empty reopened detail keeps Save inert', async () => {
    // First open: the detail resolves with grants.
    getCredentialMock.mockResolvedValueOnce({
      ...algaCredential('cred-X'),
      grants: [{ subjectType: 'user', subjectId: 'user-u1' }],
      isRestricted: true,
    });

    const { getByTestId, rerender } = render(
      <CredentialRestrictDialog credential={algaCredential('cred-X')} onClose={vi.fn()} onSaved={vi.fn()} />
    );
    const dialog = () => getByTestId('restrict-dialog');
    const save = () => dialog().querySelector('#credential-restrict-save') as HTMLButtonElement;

    await waitFor(() => expect(save().disabled).toBe(false));

    // Close: the dialog unmounts entirely, so no previous-open state survives.
    rerender(<CredentialRestrictDialog credential={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(document.querySelector('[data-testid="restrict-dialog"]')).toBeNull();

    // Reopen the same credential with the detail fetch pending: Save is inert.
    const pending = deferred<unknown>();
    getCredentialMock.mockReturnValueOnce(pending.promise);
    rerender(<CredentialRestrictDialog credential={algaCredential('cred-X')} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(save().disabled).toBe(true));
    fireEvent.click(save());
    expect(setCredentialRestrictionMock).not.toHaveBeenCalled();

    // The reopened detail fails: the error surfaces and Save stays inert.
    pending.reject(new Error('reopen boom'));
    await waitFor(() => expect(dialog().querySelector('#credential-restrict-error')).not.toBeNull());
    expect(save().disabled).toBe(true);
    fireEvent.click(save());
    expect(setCredentialRestrictionMock).not.toHaveBeenCalled();

    // A third reopen whose detail resolves WITHOUT data must still be inert: a
    // resolved-but-not-loaded response must never unlock Save for the empty seed.
    rerender(<CredentialRestrictDialog credential={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    getCredentialMock.mockResolvedValueOnce(null);
    rerender(<CredentialRestrictDialog credential={algaCredential('cred-X')} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(save().disabled).toBe(true));
    fireEvent.click(save());
    expect(setCredentialRestrictionMock).not.toHaveBeenCalled();
  });

  it('close then reopen another credential: the pre-close in-flight response is discarded and Save submits only the reopened one', async () => {
    const detailX = deferred<unknown>();
    getCredentialMock.mockImplementation((id: string) => {
      if (id === 'cred-X') return detailX.promise;
      return Promise.resolve({
        ...algaCredential('cred-Y'),
        grants: [{ subjectType: 'user', subjectId: 'user-Y' }],
        isRestricted: true,
      });
    });

    const { getByTestId, rerender } = render(
      <CredentialRestrictDialog credential={algaCredential('cred-X')} onClose={vi.fn()} onSaved={vi.fn()} />
    );
    const dialog = () => getByTestId('restrict-dialog');
    const save = () => dialog().querySelector('#credential-restrict-save') as HTMLButtonElement;

    // Close while X's detail is still in flight.
    rerender(<CredentialRestrictDialog credential={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(document.querySelector('[data-testid="restrict-dialog"]')).toBeNull();

    // Reopen a different credential; its own detail loads.
    rerender(<CredentialRestrictDialog credential={algaCredential('cred-Y')} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(save().disabled).toBe(false));
    expect(dialog().textContent).toContain('user-Y');

    // X's slow response lands after Y is showing — discarded, never rendered.
    detailX.resolve({
      ...algaCredential('cred-X'),
      grants: [{ subjectType: 'user', subjectId: 'user-X' }],
      isRestricted: true,
    });
    await waitFor(() => {
      expect(dialog().textContent).not.toContain('user-X');
      expect(dialog().textContent).toContain('user-Y');
    });

    // Save submits exactly Y and its loaded grants.
    fireEvent.click(save());
    expect(setCredentialRestrictionMock).toHaveBeenCalledWith('cred-Y', {
      isRestricted: true,
      grants: [{ subjectType: 'user', subjectId: 'user-Y' }],
    });

    // A same-id re-render with a FRESH summary object must not wipe the loaded
    // grants (in-progress edits are preserved): the load effect keys on the
    // credential id, not object identity.
    fireEvent.click(dialog().querySelector('#credential-restrict-grant-remove-user-Y') as HTMLButtonElement);
    expect(dialog().textContent).not.toContain('user-Y');

    rerender(<CredentialRestrictDialog credential={algaCredential('cred-Y')} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(dialog().textContent).not.toContain('user-Y'));

    fireEvent.click(save());
    expect(setCredentialRestrictionMock).toHaveBeenCalledWith('cred-Y', {
      isRestricted: true,
      grants: [],
    });
  });

  it('Save fires only with the loaded-for-current-id state and submits exactly that id', async () => {
    getCredentialMock.mockResolvedValueOnce(null);

    const { getByTestId, rerender } = render(
      <CredentialRestrictDialog credential={algaCredential('cred-X')} onClose={vi.fn()} onSaved={vi.fn()} />
    );
    const dialog = () => getByTestId('restrict-dialog');
    const save = () => dialog().querySelector('#credential-restrict-save') as HTMLButtonElement;

    // The detail response resolves WITHOUT data: the load did not succeed, so
    // Save must stay inert instead of replacing the stored grants with the
    // empty seed.
    await waitFor(() => expect(save().disabled).toBe(true));
    fireEvent.click(save());
    expect(setCredentialRestrictionMock).not.toHaveBeenCalled();

    // A different credential's load may never be unlocked by the previous one's
    // state: its own detail must land first, and Save must submit that id and
    // that id's grants.
    getCredentialMock.mockImplementation((id: string) =>
      id === 'cred-Y'
        ? Promise.resolve({
            ...algaCredential('cred-Y'),
            grants: [{ subjectType: 'user', subjectId: 'user-Y' }],
            isRestricted: true,
          })
        : Promise.resolve(null)
    );
    rerender(<CredentialRestrictDialog credential={algaCredential('cred-Y')} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(save().disabled).toBe(false));
    fireEvent.click(save());
    expect(setCredentialRestrictionMock).toHaveBeenCalledTimes(1);
    expect(setCredentialRestrictionMock).toHaveBeenCalledWith('cred-Y', {
      isRestricted: true,
      grants: [{ subjectType: 'user', subjectId: 'user-Y' }],
    });
  });
});
