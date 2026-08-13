import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirectMock = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

const { default: ClientPortalPage } = await import('server/src/app/client-portal/page');

describe('client-portal root page', () => {
  beforeEach(() => {
    redirectMock.mockReset();
  });

  it('redirects to the client portal dashboard', async () => {
    await ClientPortalPage();

    expect(redirectMock).toHaveBeenCalledWith('/client-portal/dashboard');
  });
});
