import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  post: vi.fn(),
}));
vi.mock('node:dns/promises', () => ({ default: { lookup: mocks.lookup }, lookup: mocks.lookup }));
vi.mock('axios', () => ({ default: { post: mocks.post }, post: mocks.post }));

import { postSafeOutboundForm } from '@alga-psa/integrations/lib/outboundUrlPolicy';

describe('safe outbound form requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
    mocks.post.mockResolvedValue({ status: 200, data: { access_token: 'ok' } });
  });

  it('pins the validated DNS answers and disables redirect following', async () => {
    const form = new URLSearchParams({ client_secret: 'must-not-leak' });
    await postSafeOutboundForm('https://oauth.example.com/token', form);

    expect(mocks.lookup).toHaveBeenCalledWith('oauth.example.com', { all: true, verbatim: true });
    const [, , options] = mocks.post.mock.calls[0]!;
    expect(options.maxRedirects).toBe(0);
    expect(options.proxy).toBe(false);
    expect(options.httpsAgent.options.lookup).toBeTypeOf('function');
    const pinnedLookup = options.httpsAgent.options.lookup;
    await new Promise<void>((resolve, reject) => pinnedLookup('oauth.example.com', {}, (error: unknown, address: string) => {
      if (error) reject(error);
      else {
        expect(address).toBe('93.184.216.34');
        resolve();
      }
    }));
  });

  it('rejects mixed public/private DNS answers before sending credentials', async () => {
    mocks.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    await expect(postSafeOutboundForm('https://oauth.example.com/token', new URLSearchParams({ client_secret: 'secret' })))
      .rejects.toThrow(/non-public address/);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('fails closed on redirect responses without retrying at the redirect target', async () => {
    const redirect = Object.assign(new Error('Request failed with status code 302'), {
      response: { status: 302, headers: { location: 'https://127.0.0.1/steal' } },
    });
    mocks.post.mockRejectedValue(redirect);
    await expect(postSafeOutboundForm('https://oauth.example.com/token', new URLSearchParams({ client_secret: 'secret' })))
      .rejects.toBe(redirect);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]![2].maxRedirects).toBe(0);
    expect(mocks.post.mock.calls[0]![2].proxy).toBe(false);
  });
});
