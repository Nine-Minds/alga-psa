/**
 * @vitest-environment jsdom
 *
 * The fallback editor is what an author lands in whenever collaboration cannot
 * connect, so its paste/drop wiring has to route screenshots into the upload
 * path — and say something when that path rejects them — exactly like the
 * collaborative editor does.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { DocumentEditor } from './DocumentEditor';
import { EditorImageUploadError } from '../lib/editorImageUpload';

const editorOptionsRef = vi.hoisted(() => ({ current: null as any }));
const insertContentMock = vi.hoisted(() => vi.fn());
const insertUploadedImagesMock = vi.hoisted(() => vi.fn(async () => undefined));
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock('react-hot-toast', () => ({
  toast: { error: toastErrorMock, success: vi.fn() },
}));

vi.mock('../lib/editorImageUpload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/editorImageUpload')>()),
  insertUploadedImages: insertUploadedImagesMock,
}));

vi.mock('@tiptap/react', () => ({
  useEditor: vi.fn((options) => {
    editorOptionsRef.current = options;
    return {
      schema: {},
      isDestroyed: false,
      commands: { insertContent: insertContentMock },
      getJSON: () => ({}),
      destroy: vi.fn(),
      setEditable: vi.fn(),
    };
  }),
  EditorContent: () => null,
}));

vi.mock('@tiptap/extension-link', () => ({ default: { configure: vi.fn(() => ({})) } }));

vi.mock('@alga-psa/ui/editor', () => ({ Emoticon: {} }));

vi.mock('./EditorToolbar', () => ({
  EditorToolbar: () => <div data-testid="editor-toolbar" />,
}));

vi.mock('@alga-psa/ui/context', () => ({
  useRegisterUnsavedChanges: () => undefined,
}));

vi.mock('../actions/documentBlockContentActions', () => ({
  getBlockContent: vi.fn(async () => null),
  updateBlockContent: vi.fn(),
}));

describe('DocumentEditor image paste and drop', () => {
  const imageFile = () => new File(['x'], 'shot.png', { type: 'image/png' });

  const clipboard = (files: File[], data: Record<string, string> = {}) => ({
    items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    getData: (mime: string) => data[mime] ?? '',
  });

  const mount = () => {
    render(<DocumentEditor documentId="doc-1" userId="user-1" initialContent={null} />);
    return editorOptionsRef.current.editorProps;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    editorOptionsRef.current = null;
  });

  it('routes a pasted screenshot into the upload path instead of the raw bitmap', () => {
    const { handlePaste } = mount();
    const file = imageFile();
    const preventDefault = vi.fn();

    const handled = handlePaste({}, { preventDefault, clipboardData: clipboard([file]) }, null);

    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(insertUploadedImagesMock).toHaveBeenCalledWith(
      expect.anything(),
      [file],
      expect.objectContaining({ userId: 'user-1', onError: expect.any(Function) })
    );
  });

  it('reports an upload failure to the author instead of failing silently', () => {
    const { handlePaste } = mount();
    handlePaste({}, { preventDefault: vi.fn(), clipboardData: clipboard([imageFile()]) }, null);

    const { onError } = insertUploadedImagesMock.mock.calls[0][2] as {
      onError: (error: unknown) => void;
    };

    onError(new EditorImageUploadError('tooLarge', 'Image is larger than the 10 MB upload limit'));
    expect(toastErrorMock).toHaveBeenCalledWith(expect.stringContaining('10 MB'));

    onError(new Error('Permission denied'));
    expect(toastErrorMock).toHaveBeenLastCalledWith('Permission denied');
  });

  it('uploads a dropped image at the drop position', () => {
    const { handleDrop } = mount();
    const file = imageFile();
    const preventDefault = vi.fn();
    const view = { posAtCoords: vi.fn(() => ({ pos: 7 })) };

    const handled = handleDrop(view, {
      preventDefault,
      dataTransfer: { files: [file] },
      clientX: 3,
      clientY: 4,
    });

    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(view.posAtCoords).toHaveBeenCalledWith({ left: 3, top: 4 });
    expect(insertUploadedImagesMock).toHaveBeenCalledWith(
      expect.anything(),
      [file],
      expect.objectContaining({ at: 7, onError: expect.any(Function) })
    );
  });

  it('ignores a drop that carries no image files', () => {
    const { handleDrop } = mount();
    const preventDefault = vi.fn();

    const handled = handleDrop(
      { posAtCoords: vi.fn() },
      {
        preventDefault,
        dataTransfer: { files: [new File(['a'], 'notes.txt', { type: 'text/plain' })] },
      }
    );

    expect(handled).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(insertUploadedImagesMock).not.toHaveBeenCalled();
  });

  it('still converts a plain-text markdown paste', () => {
    const { handlePaste } = mount();

    const handled = handlePaste(
      {},
      { preventDefault: vi.fn(), clipboardData: clipboard([], { 'text/plain': '# Title' }) },
      null
    );

    expect(handled).toBe(true);
    expect(insertUploadedImagesMock).not.toHaveBeenCalled();
    expect(insertContentMock).toHaveBeenCalledWith(expect.stringContaining('<h1>'), expect.anything());
  });

  it('leaves a text/html paste to ProseMirror so <img> markup parses into nodes', () => {
    const { handlePaste } = mount();

    const handled = handlePaste(
      {},
      {
        preventDefault: vi.fn(),
        clipboardData: clipboard([], {
          'text/plain': 'see shot',
          'text/html': '<p><img src="/api/documents/view/abc" alt="shot" /></p>',
        }),
      },
      null
    );

    expect(handled).toBe(false);
    expect(insertUploadedImagesMock).not.toHaveBeenCalled();
    expect(insertContentMock).not.toHaveBeenCalled();
  });
});
