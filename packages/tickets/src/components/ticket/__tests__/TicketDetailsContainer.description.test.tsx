import { beforeEach, describe, expect, it, vi } from 'vitest';
import { persistTicketDescriptionUpdate } from '../ticketDescriptionUpdate';

describe('persistTicketDescriptionUpdate', () => {
  const setSubmitting = vi.fn();
  const updateTicket = vi.fn();
  const toastApi = {
    error: vi.fn(),
    success: vi.fn(),
  };
  const handleError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false and shows an auth error when the user is not logged in', async () => {
    const result = await persistTicketDescriptionUpdate({
      sessionUser: null,
      ticketId: 'ticket-1',
      currentAttributes: { existing: 'value' },
      content: '[{"type":"paragraph"}]',
      setSubmitting,
      updateTicket,
      toastApi,
      handleError,
    });

    expect(result).toBe(false);
    expect(toastApi.error).toHaveBeenCalledWith('You must be logged in to update the description');
    expect(updateTicket).not.toHaveBeenCalled();
  });

  it('persists serialized rich-text JSON into ticket.attributes.description for authenticated users', async () => {
    updateTicket.mockResolvedValue(undefined);

    const description = '[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]';
    const result = await persistTicketDescriptionUpdate({
      sessionUser: { id: 'user-1' },
      ticketId: 'ticket-1',
      currentAttributes: { existing: 'value' },
      content: description,
      setSubmitting,
      updateTicket,
      toastApi,
      handleError,
    });

    expect(result).toBe(true);
    expect(updateTicket).toHaveBeenCalledWith(
      'ticket-1',
      expect.objectContaining({
        attributes: {
          existing: 'value',
          description,
        },
        updated_at: expect.any(String),
      })
    );
    expect(setSubmitting).toHaveBeenNthCalledWith(1, true);
    expect(setSubmitting).toHaveBeenLastCalledWith(false);
    expect(toastApi.success).toHaveBeenCalledWith('Description updated successfully');
  });

  it('routes description update failures through shared error handling', async () => {
    const error = new Error('nope');
    updateTicket.mockRejectedValue(error);

    const result = await persistTicketDescriptionUpdate({
      sessionUser: { id: 'user-1' },
      ticketId: 'ticket-1',
      currentAttributes: { existing: 'value' },
      content: '[{"type":"paragraph"}]',
      setSubmitting,
      updateTicket,
      toastApi,
      handleError,
    });

    expect(result).toBe(false);
    expect(handleError).toHaveBeenCalledWith(error, 'Failed to update description');
    expect(setSubmitting).toHaveBeenNthCalledWith(1, true);
    expect(setSubmitting).toHaveBeenLastCalledWith(false);
  });
});
