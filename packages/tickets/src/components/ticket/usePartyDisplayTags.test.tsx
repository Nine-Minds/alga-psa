// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

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
    { initialProps: { contactId: 'a' } },
  );

describe('usePartyDisplayTags', () => {
  beforeEach(() => fetchTags.mockReset());

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
});
