import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

const redirectMock = vi.fn();
const getSessionMock = vi.fn();
const getSessionWithRevocationCheckMock = vi.fn();

const CardMock = vi.fn((props: { children?: React.ReactNode }) => null);
const CollabTestPageClientMock = vi.fn(() => null);

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('@alga-psa/auth', () => ({
  getSession: getSessionMock,
  getSessionWithRevocationCheck: getSessionWithRevocationCheckMock,
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: CardMock,
}));

vi.mock('server/src/app/msp/test/collab/CollabTestPageClient', () => ({
  default: CollabTestPageClientMock,
}));

const { default: CollabTestPage } = await import('server/src/app/msp/test/collab/page');

describe('CollabTestPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockReset();
    getSessionWithRevocationCheckMock.mockReset();
  });

  it('renders a missing tenant message when the session has no tenant context', async () => {
    getSessionWithRevocationCheckMock.mockResolvedValue({
      user: {
        id: 'user-1',
        tenant: null,
        user_type: 'internal',
        name: 'Editor One',
      },
    });

    const result = await CollabTestPage();

    expect(redirectMock).not.toHaveBeenCalled();
    expect(CardMock).not.toHaveBeenCalled();
    expect((result as any)?.type).toBe(CardMock);
    expect((result as any)?.props?.children).toBe(
      'Missing tenant context for collaborative editing.'
    );
  });

  it('renders the collab test client when a tenant-scoped session is present', async () => {
    getSessionWithRevocationCheckMock.mockResolvedValue({
      user: {
        id: 'user-2',
        tenant: 'tenant-2',
        user_type: 'internal',
        name: 'Editor Two',
      },
    });

    const result = await CollabTestPage();

    expect(redirectMock).not.toHaveBeenCalled();
    expect((result as any)?.type).toBe(CollabTestPageClientMock);
    expect((result as any)?.props).toMatchObject({
      userId: 'user-2',
      userName: 'Editor Two',
      tenantId: 'tenant-2',
    });
  });
});
