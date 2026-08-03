/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsTab } from '@/components/settings/SettingsTab';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock('@/context/ProductContext', () => ({
  useProduct: () => ({ productCode: 'psa' }),
}));

vi.mock('@/context/TierContext', () => ({
  useTier: () => ({ hasFeature: () => true }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('SettingsTab edition gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.replace.mockClear();
  });

  it('mounts the MCP tab in Community Edition so it can handle EE_REQUIRED', () => {
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'community');

    render(
      <SettingsTab tabId="mcp-server">
        <div>MCP edition gate content</div>
      </SettingsTab>,
    );

    expect(screen.getByText('MCP edition gate content')).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
