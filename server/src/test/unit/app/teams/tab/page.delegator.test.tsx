import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

const CardMock = vi.fn((props: { children?: React.ReactNode }) => props.children ?? null);

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: CardMock,
}));

describe('TeamsTabPage delegator', () => {
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.EDITION;
    delete process.env.NEXT_PUBLIC_EDITION;
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalEdition === undefined) {
      delete process.env.EDITION;
    } else {
      process.env.EDITION = originalEdition;
    }

    if (originalPublicEdition === undefined) {
      delete process.env.NEXT_PUBLIC_EDITION;
    } else {
      process.env.NEXT_PUBLIC_EDITION = originalPublicEdition;
    }
  });

  it('T114/T422: renders a CE-unavailable shell instead of delegating into Teams tab runtime in CE', async () => {
    process.env.EDITION = 'ce';

    const { default: TeamsTabPage } = await import('server/src/app/teams/tab/page');
    const result = await TeamsTabPage({ searchParams: Promise.resolve({}) });
    const text = JSON.stringify(result);

    expect(text).toContain('Teams tab unavailable');
    expect(text).toContain('Microsoft Teams integration is only available in Enterprise Edition.');
  });

  it('T117/T424: delegates to the EE Teams tab page when enterprise edition is enabled', async () => {
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const eePageMock = vi.fn(async () => <div data-testid="ee-page">EE Teams tab</div>);
    vi.doMock('@enterprise/app/teams/tab/page', () => ({
      default: eePageMock,
    }));

    const { default: TeamsTabPage } = await import('server/src/app/teams/tab/page');
    const props = { searchParams: Promise.resolve({ tenantId: 'tenant-1' }) };
    const result = await TeamsTabPage(props);

    expect(eePageMock).toHaveBeenCalledWith(props);
    expect((result as any).props['data-testid']).toBe('ee-page');
  });
});
