// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { TicketDataSourceProvider } from './TicketDataSourceContext';
import { createTicketIdGuardDataSource } from '../../lib/testing/ticketIdGuardDataSource';

const fetchTags = vi.fn();
vi.mock('../../actions/optimizedTicketActions', () => ({
  getTicketPartyDisplayTags: (...args: unknown[]) => fetchTags(...args),
}));

import { usePartyDisplayTags } from './usePartyDisplayTags';

const badge = (id: string) => ({ tag_id: id, tag_text: id }) as never;
const OLD = { contact: [badge('vip-old')], client: [] };
const NEW = { contact: [badge('vip-new')], client: [badge('client-new')] };

const setup = (onError = vi.fn()) =>
  renderHook(
    ({ contactId }: { contactId: string }) =>
      usePartyDisplayTags({ ticketId: 't1', contactId, clientId: 'c1', initial: OLD, onError }),
    {
      initialProps: { contactId: 'a' },
      wrapper: ({ children }) => <TicketDataSourceProvider dataSource={hookDataSource}>{children}</TicketDataSourceProvider>,
    },
  );

const hookDataSource = createTicketIdGuardDataSource({
  overrides: { tags: { getTicketPartyDisplayTags: fetchTags } },
});

describe('usePartyDisplayTags', () => {
  beforeEach(() => fetchTags.mockReset());

  it('loads a changed party through the injected data source without calling native actions', async () => {
    const loadTags = vi.fn().mockResolvedValue(NEW);
    const onError = vi.fn();
    const dataSource = createTicketIdGuardDataSource({
      overrides: { tags: { getTicketPartyDisplayTags: loadTags } },
    });
    const { result, rerender } = renderHook(
      ({ contactId }: { contactId: string }) => usePartyDisplayTags({
        ticketId: 'foreign-ticket', contactId, clientId: 'foreign-client', initial: OLD, onError,
      }),
      {
        initialProps: { contactId: 'original-contact' },
        wrapper: ({ children }) => <TicketDataSourceProvider dataSource={dataSource}>{children}</TicketDataSourceProvider>,
      },
    );

    expect(result.current).toEqual(OLD);
    expect(loadTags).not.toHaveBeenCalled();
    rerender({ contactId: 'new-contact' });
    await waitFor(() => expect(result.current).toEqual(NEW));
    expect(loadTags).toHaveBeenCalledWith('foreign-ticket', 'new-contact', 'foreign-client');
    expect(fetchTags).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('clears the old badge and reports the error when the refetch fails, then a retry populates', async () => {
    const onError = vi.fn();
    fetchTags.mockResolvedValueOnce({ type: 'error', message: 'nope' });
    const { result, rerender } = setup(onError);
    expect(result.current).toEqual(OLD);

    rerender({ contactId: 'b' });
    expect(result.current).toEqual({ contact: [], client: [] });
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(result.current).toEqual({ contact: [], client: [] });

    fetchTags.mockResolvedValueOnce(NEW);
    act(() => onError.mock.calls[0][1]());
    await waitFor(() => expect(result.current).toEqual(NEW));
    expect(fetchTags).toHaveBeenCalledTimes(2);
  });

  it('treats a rejected promise like an error and can fetch again', async () => {
    const onError = vi.fn();
    fetchTags.mockRejectedValueOnce(new Error('network'));
    const { result, rerender } = setup(onError);
    rerender({ contactId: 'b' });
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(result.current).toEqual({ contact: [], client: [] });

    fetchTags.mockResolvedValueOnce(NEW);
    rerender({ contactId: 'c' });
    await waitFor(() => expect(result.current).toEqual(NEW));
  });

  it('never lets a stale response overwrite a newer party', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    fetchTags.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    fetchTags.mockResolvedValueOnce(NEW);
    const { result, rerender } = setup();
    rerender({ contactId: 'b' });
    rerender({ contactId: 'c' });
    await waitFor(() => expect(result.current).toEqual(NEW));
    await act(async () => resolveFirst(OLD));
    expect(result.current).toEqual(NEW);
  });

  it('refetches the original party after a failed change away and back', async () => {
    const onError = vi.fn();
    fetchTags.mockResolvedValueOnce({ type: 'error', message: 'nope' });
    const { result, rerender } = setup(onError);
    rerender({ contactId: 'b' });
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));

    fetchTags.mockResolvedValueOnce(OLD);
    rerender({ contactId: 'a' });
    await waitFor(() => expect(result.current).toEqual(OLD));
    expect(fetchTags).toHaveBeenCalledTimes(2);
    expect(fetchTags).toHaveBeenLastCalledWith('t1', 'a', 'c1');
  });

  it('Retry after a failure fetches again for the current party', async () => {
    const onError = vi.fn();
    fetchTags.mockRejectedValueOnce(new Error('x'));
    const { result, rerender } = setup(onError);
    rerender({ contactId: 'b' });
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    fetchTags.mockResolvedValueOnce(NEW);
    act(() => onError.mock.calls[0][1]());
    await waitFor(() => expect(result.current).toEqual(NEW));
    expect(fetchTags).toHaveBeenLastCalledWith('t1', 'b', 'c1');
  });
});
