import { describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: fetchMock };
});

import { sendWithValidatedRedirects } from '../transport';

const request = (url: string) => ({
  url,
  method: 'POST',
  headers: {},
  body: '{}',
  verifySsl: true,
  signal: new AbortController().signal,
});

describe('webhook transport address policy', () => {
  it.each(['fec0::1', '100::1', '2001::1', '2002:7f00:1::1'])(
    'refuses non-global IPv6 literal %s before transport fetch',
    async (address) => {
      fetchMock.mockClear();

      await expect(sendWithValidatedRedirects(request(`http://[${address}]/hook`))).rejects.toMatchObject({
        name: 'UnsafeWebhookTargetError',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
