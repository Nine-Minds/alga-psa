import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => ({ post: http.post, get: http.get }) } }));
vi.mock('@alga-psa/core/logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { ResendEmailProvider } from '../providers/ResendEmailProvider';

const GENERATED = '<gen-1@alga.test>';
const WIRE = '<0100019abc-def-000000@email.amazonses.com>';
const message = {
  from: { email: 'noreply@alga.test' },
  to: [{ email: 'one@example.com' }],
  subject: 'Hello',
  text: 'hi',
  headers: { 'Message-ID': GENERATED },
} as any;
const posted = { id: 're_123', from: 'noreply@alga.test', to: ['one@example.com'], created_at: '2026-11-11T00:00:00Z' };

let providerSeq = 0;
async function provider() {
  // verifyConnection (GET /domains) is cached per providerId, so use a fresh id each time.
  http.get.mockResolvedValueOnce({ data: { data: [] } });
  const p = new ResendEmailProvider(`resend-${++providerSeq}`);
  await p.initialize({ apiKey: 're_key' });
  http.get.mockClear();
  return p;
}
const postCalls = () => http.post.mock.calls.filter(([url]) => url === '/emails').length;

describe('ResendEmailProvider on-wire Message-ID (T003, F003)', () => {
  beforeEach(() => {
    http.post.mockReset();
    http.get.mockReset();
  });

  it('uses message_id from the POST response without a GET', async () => {
    http.post.mockResolvedValue({ data: { ...posted, message_id: WIRE } });
    const result = await (await provider()).sendEmail(message);
    expect(result.rfcMessageId).toBe(WIRE);
    expect(result.metadata).toMatchObject({ generatedRfcMessageId: GENERATED, onWireMessageId: WIRE });
    expect(http.get).not.toHaveBeenCalled();
    expect(postCalls()).toBe(1);
  });

  it('falls back to one GET /emails/:id when the POST response has no message_id', async () => {
    http.post.mockResolvedValue({ data: posted });
    http.get.mockResolvedValue({ data: { id: 're_123', message_id: WIRE } });
    const result = await (await provider()).sendEmail(message);
    expect(result.success).toBe(true);
    expect(result.rfcMessageId).toBe(WIRE);
    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get).toHaveBeenCalledWith('/emails/re_123');
    expect(postCalls()).toBe(1);
  });

  it('succeeds without rfcMessageId when Resend returns a null message_id', async () => {
    http.post.mockResolvedValue({ data: posted });
    http.get.mockResolvedValue({ data: { id: 're_123', message_id: null } });
    const result = await (await provider()).sendEmail(message);
    expect(result.success).toBe(true);
    expect(result.rfcMessageId).toBeUndefined();
    expect(result.providerMessageId).toBe('re_123');
    expect(postCalls()).toBe(1);
  });

  it.each([
    ['a 429', { response: { status: 429 } }],
    ['a 500', { response: { status: 500 } }],
    ['a network error', new Error('ECONNRESET')],
  ])('swallows %s from the GET: the send succeeds and POST is not retried', async (_label, failure) => {
    http.post.mockResolvedValue({ data: posted });
    http.get.mockRejectedValue(failure);
    const result = await (await provider()).sendEmail(message);
    expect(result.success).toBe(true);
    expect(result.rfcMessageId).toBeUndefined();
    expect(postCalls()).toBe(1);
  });
});
