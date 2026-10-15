import { afterEach, expect, it, vi } from 'vitest';
import { waitForEmailMessage } from '../../e2e/utils/wait-for-email-message';
afterEach(() => vi.useRealTimers());

it('accepts an already persisted exact message without requiring a newer timestamp', async () => {
  const readComments = vi.fn();
  await waitForEmailMessage({ messageId: '<sent@example.test>',
    readTickets: async () => [{ ticket_id: 'ticket', entered_at: '2020-01-01', email_metadata: { messageId: 'sent@example.test' } }],
    readComments });
  expect(readComments).not.toHaveBeenCalled();
});

it('waits for the matching reply instead of accepting the original ticket', async () => {
  vi.useFakeTimers();
  const readComments = vi.fn().mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ metadata: { email: { messageId: '<reply@example.test>' } } }]);
  const result = waitForEmailMessage({ messageId: 'reply@example.test',
    readTickets: async () => [{ ticket_id: 'ticket', email_metadata: { messageId: 'original@example.test' } }], readComments });
  await vi.advanceTimersByTimeAsync(250);
  await result;
  expect(readComments).toHaveBeenCalledTimes(2);
  expect(readComments).toHaveBeenCalledWith('ticket');
});

it('rejects unrelated activity and missing sends', async () => {
  vi.useFakeTimers();
  const readers = { readTickets: async () => [{ ticket_id: 'other', email_metadata: { messageId: 'other@example.test' } }],
    readComments: async () => [{ metadata: { email: { messageId: 'also-other@example.test' } } }] };
  await expect(waitForEmailMessage({ ...readers, messageId: undefined })).rejects.toThrow('Send and capture');
  const result = expect(waitForEmailMessage({ ...readers, messageId: 'sent@example.test', timeout: 500 }))
    .rejects.toThrow('no matching persisted ticket or reply');
  await vi.advanceTimersByTimeAsync(500);
  await result;
});

it('surfaces read failures rather than treating them as completion', async () => {
  await expect(waitForEmailMessage({ messageId: 'sent@example.test', readTickets: async () => { throw new Error('database unavailable'); },
    readComments: async () => [] })).rejects.toThrow('database unavailable');
});
