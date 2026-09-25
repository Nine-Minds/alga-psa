/* @vitest-environment jsdom */

import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const setClientInboundEmailDomainsAutoCreateContacts = vi.fn();

vi.mock('@alga-psa/clients/actions/clientInboundEmailDomainActions', () => ({
  setClientInboundEmailDomainsAutoCreateContacts: (...args: unknown[]) => setClientInboundEmailDomainsAutoCreateContacts(...args),
}));

import { useInboundDomainAutoCreateDraft, type InboundDomainRow } from './useInboundDomainAutoCreateDraft';

const persisted: InboundDomainRow[] = [
  { id: 'd-off', domain: 's2569-off.test', auto_create_contacts: false },
  { id: 'd-on', domain: 's2569-on.test', auto_create_contacts: false },
];

function useHarness(clientId = 'client-1') {
  const [domains, setDomains] = useState(persisted);
  return { persistedDomains: domains, draft: useInboundDomainAutoCreateDraft(clientId, domains, setDomains) };
}

describe('useInboundDomainAutoCreateDraft', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('stages a toggle as an unsaved change without calling the server', () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.draft.toggle('d-on', true));

    expect(setClientInboundEmailDomainsAutoCreateContacts).not.toHaveBeenCalled();
    expect(result.current.draft.hasChanges).toBe(true);
    expect(result.current.draft.domains.find((d) => d.id === 'd-on')?.auto_create_contacts).toBe(true);
    expect(result.current.persistedDomains.find((d) => d.id === 'd-on')?.auto_create_contacts).toBe(false);
  });

  it('is clean again when a toggle is flipped back to its saved value', () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.draft.toggle('d-on', true));
    act(() => result.current.draft.toggle('d-on', false));
    expect(result.current.draft.hasChanges).toBe(false);
  });

  it('persists only the changed domains on save and clears the draft', async () => {
    setClientInboundEmailDomainsAutoCreateContacts.mockResolvedValue([
      { id: 'd-on', client_id: 'client-1', domain: 's2569-on.test', auto_create_contacts: true },
    ]);
    const { result } = renderHook(() => useHarness());
    act(() => result.current.draft.toggle('d-on', true));

    let saved = false;
    await act(async () => { saved = await result.current.draft.save(); });

    expect(saved).toBe(true);
    expect(setClientInboundEmailDomainsAutoCreateContacts).toHaveBeenCalledWith('client-1', [{ domainId: 'd-on', enabled: true }]);
    expect(result.current.draft.hasChanges).toBe(false);
    expect(result.current.persistedDomains.find((d) => d.id === 'd-on')?.auto_create_contacts).toBe(true);
  });

  it('skips the server when nothing is staged', async () => {
    const { result } = renderHook(() => useHarness());
    await act(async () => { await result.current.draft.save(); });
    expect(setClientInboundEmailDomainsAutoCreateContacts).not.toHaveBeenCalled();
  });

  it('keeps the draft when the save fails', async () => {
    setClientInboundEmailDomainsAutoCreateContacts.mockResolvedValue({ actionError: 'Inbound email domain not found.' });
    const { result } = renderHook(() => useHarness());
    act(() => result.current.draft.toggle('d-on', true));

    let saved = true;
    await act(async () => { saved = await result.current.draft.save(); });

    expect(saved).toBe(false);
    expect(result.current.draft.hasChanges).toBe(true);
    expect(result.current.persistedDomains.find((d) => d.id === 'd-on')?.auto_create_contacts).toBe(false);
  });

  it('discards staged toggles', () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.draft.toggle('d-on', true));
    act(() => result.current.draft.discard());
    expect(result.current.draft.hasChanges).toBe(false);
    expect(result.current.draft.domains.find((d) => d.id === 'd-on')?.auto_create_contacts).toBe(false);
  });
});
