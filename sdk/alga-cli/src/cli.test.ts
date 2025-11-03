import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { runCLI } from './cli.js';

const mockInstallExtension = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/client-sdk', () => ({
  createComponentProject: vi.fn(),
  createNewProject: vi.fn(),
  installExtension: mockInstallExtension,
  packProject: vi.fn(),
  sign: vi.fn().mockResolvedValue({ signaturePath: '/tmp/signature' }),
}));

describe('alga CLI – extension install', () => {
  beforeEach(() => {
    mockInstallExtension.mockReset();
    mockInstallExtension.mockResolvedValue({
      success: true,
      status: 202,
      installId: 'install-id-123',
      message: 'Extension installation enqueued',
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('invokes installExtension with derived options', async () => {
    await runCLI([
      'node',
      'alga',
      'extension',
      'install',
      'registry-123',
      '--version',
      '1.0.0',
      '--api-key',
      'api-key-xyz',
      '--tenant',
      'tenant-abc',
      '--base-url',
      'http://localhost:3100',
    ]);

    expect(mockInstallExtension).toHaveBeenCalledWith({
      registryId: 'registry-123',
      version: '1.0.0',
      apiKey: 'api-key-xyz',
      tenantId: 'tenant-abc',
      baseUrl: 'http://localhost:3100',
      timeoutMs: undefined,
    });
    expect(process.exitCode).toBeUndefined();
  });

  it('fails when required arguments are missing', async () => {
    await runCLI(['node', 'alga', 'extension', 'install', 'registry-123']);

    expect(mockInstallExtension).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
