import { describe, expect, it, vi, beforeEach } from 'vitest';

const sharpMocks = vi.hoisted(() => {
  const toBuffer = vi.fn(async () => Buffer.from('processed-image'));
  const png = vi.fn(() => ({ toBuffer }));
  const webp = vi.fn(() => ({ toBuffer }));
  const resize = vi.fn(() => ({ png, webp }));
  const sharp = vi.fn(() => ({ resize }));
  return { toBuffer, png, webp, resize, sharp };
});

vi.mock('sharp', () => ({ default: sharpMocks.sharp }));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('../src/config/storage', () => ({
  getProviderConfig: vi.fn(),
  getStorageConfig: vi.fn(),
  validateFileUpload: vi.fn(async () => {}),
}));

vi.mock('../src/StorageProviderFactory', () => ({
  StorageProviderFactory: { createProvider: vi.fn() },
  generateStoragePath: vi.fn((_tenant: string, _folder: string, name: string) => `tenant-1/files/${name}`),
}));

vi.mock('../src/models/storage', () => ({
  FileStoreModel: { create: vi.fn(), findById: vi.fn(), softDelete: vi.fn() },
}));

vi.mock('@alga-psa/validation', () => ({ isValidUUID: vi.fn(() => true) }));

vi.mock('file-type', () => ({ fileTypeFromBuffer: vi.fn(async () => undefined) }));

import { fileTypeFromBuffer } from 'file-type';
import { StorageProviderFactory } from '../src/StorageProviderFactory';
import { FileStoreModel } from '../src/models/storage';
import { StorageService } from '../src/StorageService';

const UPLOADER = 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0';

describe('StorageService.uploadFile favicon processing', () => {
  const createProviderMock = vi.mocked(StorageProviderFactory.createProvider);
  const fileCreateMock = vi.mocked(FileStoreModel.create);
  const fileTypeMock = vi.mocked(fileTypeFromBuffer);
  const uploadMock = vi.fn(async () => ({ path: 'tenant-1/files/icon' }));

  beforeEach(() => {
    vi.clearAllMocks();
    createProviderMock.mockResolvedValue({ upload: uploadMock } as any);
    fileCreateMock.mockResolvedValue({
      file_id: '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a',
      original_name: 'icon.png',
      mime_type: 'image/png',
      file_size: 15,
      storage_path: 'tenant-1/files/icon',
      uploaded_by_id: UPLOADER,
      created_at: '2026-09-04T12:00:00.000Z',
    } as any);
  });

  const upload = (name: string, options: Record<string, unknown>) =>
    StorageService.uploadFile('tenant-1', Buffer.from('raw-image-bytes'), name, {
      uploaded_by_id: UPLOADER,
      isImageAvatar: true,
      ...options,
    });

  it('renders a raster favicon onto a 32x32 PNG canvas', async () => {
    fileTypeMock.mockResolvedValue({ ext: 'jpg', mime: 'image/jpeg' } as any);

    await upload('logo.jpg', { mime_type: 'image/jpeg', isFavicon: true });

    expect(sharpMocks.resize).toHaveBeenCalledWith(
      32,
      32,
      expect.objectContaining({ fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }),
    );
    // Browsers accept PNG favicons, so no ICO encoder is needed.
    expect(sharpMocks.png).toHaveBeenCalled();
    expect(sharpMocks.webp).not.toHaveBeenCalled();
    expect(uploadMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.any(String),
      { mime_type: 'image/png' },
    );
    expect(fileCreateMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mime_type: 'image/png', original_name: 'logo.png' }),
    );
  });

  it('stores an .ico untouched — it is already an icon container', async () => {
    fileTypeMock.mockResolvedValue({ ext: 'ico', mime: 'image/x-icon' } as any);

    await upload('favicon.ico', { mime_type: 'image/x-icon', isFavicon: true });

    expect(sharpMocks.sharp).not.toHaveBeenCalled();
    expect(uploadMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.any(String),
      { mime_type: 'image/x-icon' },
    );
    expect(fileCreateMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mime_type: 'image/x-icon', original_name: 'favicon.ico' }),
    );
  });

  it('keeps an SVG favicon as vector', async () => {
    await upload('mark.svg', { mime_type: 'image/svg+xml', isFavicon: true });

    expect(sharpMocks.sharp).not.toHaveBeenCalled();
    expect(uploadMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.any(String),
      { mime_type: 'image/svg+xml' },
    );
  });

  it('rejects a format no browser would render as an icon', async () => {
    fileTypeMock.mockResolvedValue({ ext: 'pdf', mime: 'application/pdf' } as any);

    await expect(upload('brochure.pdf', { mime_type: 'application/pdf', isFavicon: true }))
      .rejects.toThrow(/favicons/);
  });

  it('leaves the logo branch alone: aspect preserved, webp, 1024 ceiling', async () => {
    fileTypeMock.mockResolvedValue({ ext: 'png', mime: 'image/png' } as any);

    await upload('wordmark.png', { mime_type: 'image/png', isEntityLogo: true });

    expect(sharpMocks.resize).toHaveBeenCalledWith(
      1024,
      1024,
      expect.objectContaining({ fit: 'inside', withoutEnlargement: true }),
    );
    expect(sharpMocks.webp).toHaveBeenCalled();
    expect(sharpMocks.png).not.toHaveBeenCalled();
  });
});
