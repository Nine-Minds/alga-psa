import { afterEach, describe, expect, it, vi } from 'vitest';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({
  default: { lookup: (...args: unknown[]) => lookup(...args) },
  lookup: (...args: unknown[]) => lookup(...args),
}));

import { assertSafeImapHost } from '../imapOutboundTarget';

describe('private custom-port IMAP compatibility', () => {
  afterEach(() => {
    vi.resetAllMocks();
    delete process.env.EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST;
  });

  it('permits an exact deployment-authorized private host on a configured custom port', async () => {
    process.env.EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST = 'imap.internal.example';
    lookup.mockResolvedValue([{ address: '10.40.8.12', family: 4 }]);

    const target = await assertSafeImapHost('imap.internal.example', 1143);

    expect(target.url.port).toBe('1143');
    expect(target.pin).toEqual({ address: '10.40.8.12', family: 4 });
  });
});
