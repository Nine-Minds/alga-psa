/**
 * @vitest-environment jsdom
 */
import {
  MAX_EDITOR_IMAGE_BYTES,
  extractImageFiles,
  insertUploadedImages,
  isEditorImageFile,
  uploadEditorImage,
} from './editorImageUpload';

const imageFile = (name = 'shot.png') => new File(['x'], name, { type: 'image/png' });

describe('uploadEditorImage', () => {
  it('uploads client-visible and returns the document view URL', async () => {
    const uploadDocumentAction = vi.fn(async () => ({
      success: true,
      document: { document_id: 'doc-1', file_id: 'file-1' },
    }));

    const result = await uploadEditorImage(imageFile(), {
      userId: 'user-1',
      uploadDocumentAction,
    });

    expect(result).toEqual({ url: '/api/documents/view/file-1', documentId: 'doc-1' });
    // Publishing an article never flips the visibility of images embedded in
    // it, so inline uploads have to be client-visible from the start.
    expect(uploadDocumentAction).toHaveBeenCalledWith(expect.any(FormData), {
      userId: 'user-1',
      isClientVisible: true,
    });
  });

  it('falls back to the download URL when the upload has no file id', async () => {
    const uploadDocumentAction = vi.fn(async () => ({
      success: true,
      document: { document_id: 'doc-2' },
    }));

    const result = await uploadEditorImage(imageFile(), {
      userId: 'user-1',
      uploadDocumentAction,
    });

    expect(result.url).toBe('/api/documents/download/doc-2');
  });

  it('rejects non-image files, oversized files and missing sessions', async () => {
    const uploadDocumentAction = vi.fn();

    await expect(
      uploadEditorImage(new File(['x'], 'notes.txt', { type: 'text/plain' }), {
        userId: 'user-1',
        uploadDocumentAction,
      })
    ).rejects.toThrow(/image files/i);

    const large = imageFile();
    Object.defineProperty(large, 'size', { value: MAX_EDITOR_IMAGE_BYTES + 1 });
    await expect(
      uploadEditorImage(large, { userId: 'user-1', uploadDocumentAction })
    ).rejects.toThrow(/10 MB/);

    await expect(
      uploadEditorImage(imageFile(), { userId: '', uploadDocumentAction })
    ).rejects.toThrow(/User session/);

    expect(uploadDocumentAction).not.toHaveBeenCalled();
  });

  it('surfaces permission and upload failures', async () => {
    await expect(
      uploadEditorImage(imageFile(), {
        userId: 'user-1',
        uploadDocumentAction: async () => ({ permissionError: 'Permission denied' }),
      })
    ).rejects.toThrow('Permission denied');

    await expect(
      uploadEditorImage(imageFile(), {
        userId: 'user-1',
        uploadDocumentAction: async () => ({ success: false, error: 'Storage is full' }),
      })
    ).rejects.toThrow('Storage is full');
  });
});

describe('extractImageFiles', () => {
  it('keeps only image files from a clipboard item list', () => {
    const png = imageFile();
    const items = [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'text/csv', getAsFile: () => new File(['a'], 'a.csv') },
      { kind: 'file', type: 'image/png', getAsFile: () => png },
      { kind: 'file', type: 'image/gif', getAsFile: () => null },
    ];

    expect(extractImageFiles(items)).toEqual([png]);
    expect(extractImageFiles(null)).toEqual([]);
  });

  it('detects image files by mime type', () => {
    expect(isEditorImageFile({ type: 'IMAGE/PNG' })).toBe(true);
    expect(isEditorImageFile({ type: 'application/pdf' })).toBe(false);
    expect(isEditorImageFile(null)).toBe(false);
  });
});

describe('insertUploadedImages', () => {
  const buildEditor = () => {
    const run = vi.fn();
    const setImage = vi.fn(() => ({ run }));
    const setTextSelection = vi.fn(() => chain);
    const chain: any = { setImage, setTextSelection };
    const focus = vi.fn(() => chain);
    return { editor: { chain: () => ({ focus }) }, setImage, setTextSelection, run };
  };

  it('inserts an image node per uploaded file', async () => {
    const { editor, setImage, run } = buildEditor();

    await insertUploadedImages(editor, [imageFile('one.png'), imageFile('two.png')], {
      userId: 'user-1',
      uploadDocumentAction: async () => ({
        success: true,
        document: { document_id: 'doc-1', file_id: 'file-1' },
      }),
    });

    expect(setImage).toHaveBeenCalledWith({ src: '/api/documents/view/file-1', alt: 'one.png' });
    expect(setImage).toHaveBeenCalledWith({ src: '/api/documents/view/file-1', alt: 'two.png' });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('reports a failure without aborting the remaining files', async () => {
    const { editor, setImage } = buildEditor();
    const onError = vi.fn();
    let call = 0;

    await insertUploadedImages(editor, [imageFile('bad.png'), imageFile('good.png')], {
      userId: 'user-1',
      onError,
      uploadDocumentAction: async () => {
        call += 1;
        if (call === 1) return { success: false, error: 'boom' };
        return { success: true, document: { document_id: 'doc-1', file_id: 'file-1' } };
      },
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(setImage).toHaveBeenCalledTimes(1);
    expect(setImage).toHaveBeenCalledWith({ src: '/api/documents/view/file-1', alt: 'good.png' });
  });

  it('inserts a dropped image at the drop position instead of the selection', async () => {
    const { editor, setTextSelection, run } = buildEditor();

    await insertUploadedImages(editor, [imageFile('dropped.png')], {
      userId: 'user-1',
      at: 42,
      uploadDocumentAction: async () => ({
        success: true,
        document: { document_id: 'doc-1', file_id: 'file-1' },
      }),
    });

    expect(setTextSelection).toHaveBeenCalledWith(42);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('keeps a multi-file drop in order after the first position', async () => {
    const { editor, setTextSelection } = buildEditor();

    await insertUploadedImages(editor, [imageFile('one.png'), imageFile('two.png')], {
      userId: 'user-1',
      at: 7,
      uploadDocumentAction: async () => ({
        success: true,
        document: { document_id: 'doc-1', file_id: 'file-1' },
      }),
    });

    expect(setTextSelection).toHaveBeenCalledTimes(1);
    expect(setTextSelection).toHaveBeenCalledWith(7);
  });

  it('leaves the caret alone when no drop position is given', async () => {
    const { editor, setTextSelection, run } = buildEditor();

    await insertUploadedImages(editor, [imageFile('pasted.png')], {
      userId: 'user-1',
      uploadDocumentAction: async () => ({
        success: true,
        document: { document_id: 'doc-1', file_id: 'file-1' },
      }),
    });

    expect(setTextSelection).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
