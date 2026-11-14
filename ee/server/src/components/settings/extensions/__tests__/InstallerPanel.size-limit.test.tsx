/** @vitest-environment jsdom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import InstallerPanel from '../InstallerPanel';

const mockExtUploadProxy = vi.fn();
const mockExtGetUploadLimit = vi.fn(async () => ({ maxBytes: 1024 * 1024 }));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('@ee/__tests__/utils/localeTranslationMock');
  return createLocaleTranslationMock('msp/extensions');
});

vi.mock('@ee/lib/actions/extBundleActions', () => ({
  extUploadProxy: (...args: any[]) => mockExtUploadProxy(...args),
  extGetUploadLimit: () => mockExtGetUploadLimit(),
  extFinalizeUpload: vi.fn(),
  extAbortUpload: vi.fn(async () => ({ status: 'deleted' })),
}));

vi.mock('@ee/lib/actions/extRegistryV2Actions', () => ({
  installExtensionForCurrentTenantV2: vi.fn(),
}));

describe('InstallerPanel bundle size limit', () => {
  it('names the bundle size and the limit, and uploads nothing, when the bundle is over the limit', async () => {
    render(<InstallerPanel />);

    const input = screen.getByLabelText(/extension bundle/i);
    const big = new File([new Uint8Array(3 * 1024 * 1024)], 'big.tar.zst', { type: 'application/octet-stream' });
    fireEvent.change(input, { target: { files: [big] } });
    fireEvent.click(screen.getByRole('button', { name: /^install$/i }));

    await waitFor(() => {
      expect(screen.getByText(/This bundle is 3\.0 MB\. The current limit is 1\.0 MB per bundle\./i)).toBeInTheDocument();
    });
    expect(mockExtUploadProxy).not.toHaveBeenCalled();
    expect(screen.queryByText(/Unexpected error during installation/i)).not.toBeInTheDocument();
  });
});
