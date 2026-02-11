/** @vitest-environment jsdom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import InstallerPanel from '../InstallerPanel';

const mockExtUploadProxy = vi.fn(async () => ({
  filename: 'bundle.tar.zst',
  size: 12,
  upload: { key: 'sha256/staging/test', strategy: 'staging' as const },
}));

const mockExtFinalizeUpload = vi.fn(async () => ({
  success: false,
  error: {
    code: 'EXTENSION_VERSION_ALREADY_EXISTS',
    message: 'Version "1.2.3" already exists for this extension. Publish a new version and try again.',
  },
}));

const mockInstall = vi.fn(async () => ({ success: true }));

vi.mock('@ee/lib/actions/extBundleActions', () => ({
  extUploadProxy: (...args: any[]) => mockExtUploadProxy(...args),
  extFinalizeUpload: (...args: any[]) => mockExtFinalizeUpload(...args),
  extAbortUpload: vi.fn(async () => ({ status: 'deleted' })),
}));

vi.mock('@ee/lib/actions/extRegistryV2Actions', () => ({
  installExtensionForCurrentTenantV2: (...args: any[]) => mockInstall(...args),
}));

describe('InstallerPanel duplicate-version UX', () => {
  it('T009: displays duplicate-version friendly message without generic fallback text', async () => {
    render(<InstallerPanel />);

    const input = screen.getByLabelText(/extension bundle/i);
    const file = new File([new Uint8Array([1, 2, 3])], 'bundle.tar.zst', { type: 'application/octet-stream' });
    fireEvent.change(input, { target: { files: [file] } });

    fireEvent.click(screen.getByRole('button', { name: /^install$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Version "1\.2\.3" already exists/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/Unexpected error finalizing installation/i)).not.toBeInTheDocument();
    expect(mockInstall).not.toHaveBeenCalled();
  });
});
