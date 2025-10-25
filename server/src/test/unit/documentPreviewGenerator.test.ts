import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('sharp', () => {
  const metadataMock = vi.fn();
  let resizeCallIndex = 0;

  const sharpFactory = vi.fn(() => ({
    metadata: metadataMock,
    resize: vi.fn((width: number, height: number, options: any) => {
      resizeArgs.push({ width, height, options });

      return {
        jpeg: vi.fn(() => ({
          toBuffer: vi.fn(async () => {
            resizeCallIndex += 1;
            return Buffer.from(resizeCallIndex === 1 ? 'thumb-bytes' : 'preview-bytes');
          }),
        })),
      };
    }),
  }));

  const resizeArgs: Array<{ width: number; height: number; options: any }> = [];

  const helpers = {
    metadataMock,
    resizeArgs,
    reset() {
      metadataMock.mockReset();
      sharpFactory.mockClear();
      resizeArgs.length = 0;
      resizeCallIndex = 0;
    },
  };

  (sharpFactory as any)._test = helpers;

  return {
    __esModule: true,
    default: sharpFactory,
  };
});

vi.mock('server/src/lib/storage/StorageService', () => ({
  StorageService: {
    uploadFile: vi.fn(),
  },
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(),
}));

import sharpModule from 'sharp';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { createTenantKnex } from 'server/src/lib/db';
import { generateDocumentPreviews } from '@/lib/utils/documentPreviewGenerator';

const { metadataMock, resizeArgs, reset: resetSharpMocks } = (sharpModule as any)._test;
const uploadFileMock = vi.mocked(StorageService.uploadFile);
const createTenantKnexMock = vi.mocked(createTenantKnex);

describe('generateDocumentPreviews', () => {
  beforeEach(() => {
    resetSharpMocks();
    uploadFileMock.mockReset();
    createTenantKnexMock.mockResolvedValue({ tenant: 'tenant-123' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('skips storage uploads for unsupported mime types', async () => {
    const document = {
      document_id: 'doc-1',
      mime_type: 'text/plain',
      created_by: 'user-1',
    } as any;

    const result = await generateDocumentPreviews(document, Buffer.from('file'));

    expect(result.thumbnail_file_id).toBeNull();
    expect(result.preview_file_id).toBeNull();
    expect(result.preview_generated_at).toBeInstanceOf(Date);
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it('creates thumbnail and preview uploads for large images', async () => {
    metadataMock.mockResolvedValue({ width: 1200, height: 900 });
    uploadFileMock.mockResolvedValueOnce({ file_id: 'thumb-1' } as any);
    uploadFileMock.mockResolvedValueOnce({ file_id: 'preview-2' } as any);

    const document = {
      document_id: 'doc-2',
      mime_type: 'image/png',
      created_by: 'user-7',
      file_id: 'file-original',
    } as any;

    const result = await generateDocumentPreviews(document, Buffer.from('image-data'));

    expect(result).toMatchObject({
      thumbnail_file_id: 'thumb-1',
      preview_file_id: 'preview-2',
    });

    expect(createTenantKnexMock).toHaveBeenCalled();
    expect(uploadFileMock).toHaveBeenCalledTimes(2);

    const [thumbnailCall, previewCall] = uploadFileMock.mock.calls;
    expect(thumbnailCall[1]).toBeInstanceOf(Buffer);
    expect(thumbnailCall[2]).toBe('doc-2_thumbnail.jpg');
    expect(thumbnailCall[3]).toMatchObject({
      mime_type: 'image/jpeg',
      metadata: expect.objectContaining({ context: 'document_thumbnail' }),
    });

    expect(previewCall[2]).toBe('doc-2_preview.jpg');
    expect(previewCall[3]).toMatchObject({
      mime_type: 'image/jpeg',
      metadata: expect.objectContaining({ context: 'document_preview' }),
    });

    expect(resizeArgs).toHaveLength(2);
    expect(resizeArgs[0]).toMatchObject({ width: 200, height: 200, options: expect.objectContaining({ fit: 'cover' }) });
    expect(resizeArgs[1]).toMatchObject({ width: 800, height: 600, options: expect.objectContaining({ fit: 'inside' }) });
  });
});
