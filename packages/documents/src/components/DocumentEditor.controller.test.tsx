/**
 * @vitest-environment jsdom
 *
 * Hosts that hide DocumentEditor's own Save button (the KB article editor's
 * single Save) save through DocumentEditorController. The editor's
 * navigation-guard registration must follow what was actually persisted:
 * cleared after a successful save, still set after a failed one.
 */
import React from 'react';
import { act, render } from '@testing-library/react';
import { DocumentEditor, type DocumentEditorController } from './DocumentEditor';

const editorOptionsRef = vi.hoisted(() => ({ current: null as any }));
const registerMock = vi.hoisted(() => vi.fn());

vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// One stable editor instance, as useEditor returns in the real component.
const editor = vi.hoisted(() => ({
  schema: {},
  isDestroyed: false,
  commands: { setContent: () => true, insertContent: () => true },
  getJSON: () => ({ type: 'doc', content: [{ type: 'paragraph' }] }),
  destroy: () => undefined,
  setEditable: () => undefined,
}));

vi.mock('@tiptap/react', () => ({
  useEditor: vi.fn((options) => {
    editorOptionsRef.current = options;
    return editor;
  }),
  EditorContent: () => null,
}));

vi.mock('@tiptap/extension-link', () => ({ default: { configure: vi.fn(() => ({})) } }));
vi.mock('@alga-psa/ui/editor', () => ({ Emoticon: {} }));
vi.mock('./EditorToolbar', () => ({ EditorToolbar: () => null }));

vi.mock('@alga-psa/ui/context', () => ({
  useRegisterUnsavedChanges: registerMock,
}));

vi.mock('../actions/documentBlockContentActions', () => ({
  getBlockContent: vi.fn(async () => null),
  updateBlockContent: vi.fn(),
}));

const lastRegistered = () => registerMock.mock.calls[registerMock.mock.calls.length - 1];

describe('DocumentEditorController.save', () => {
  const mount = () => {
    const controllerRef = { current: null as DocumentEditorController | null };
    const onUnsavedChangesChange = vi.fn();
    render(
      <DocumentEditor
        documentId="doc-1"
        userId="user-1"
        initialContent={null}
        controllerRef={controllerRef}
        onUnsavedChangesChange={onUnsavedChangesChange}
        hideSaveButton
      />
    );
    return { controllerRef, onUnsavedChangesChange };
  };

  const edit = () => act(() => editorOptionsRef.current.onUpdate());

  beforeEach(() => {
    vi.clearAllMocks();
    editorOptionsRef.current = null;
  });

  it('clears the registered unsaved-changes state after a successful save', async () => {
    const { updateBlockContent } = await import('../actions/documentBlockContentActions');
    vi.mocked(updateBlockContent).mockResolvedValue({ success: true } as any);
    const { controllerRef, onUnsavedChangesChange } = mount();

    edit();
    expect(lastRegistered()).toEqual(['document-editor-doc-1', true]);

    await act(() => controllerRef.current!.save());

    expect(updateBlockContent).toHaveBeenCalledWith('doc-1', {
      block_data: JSON.stringify(editor.getJSON()),
      user_id: 'user-1',
    });
    expect(lastRegistered()).toEqual(['document-editor-doc-1', false]);
    expect(onUnsavedChangesChange).toHaveBeenLastCalledWith(false);
  });

  it('rejects and keeps the unsaved-changes state when the content save fails', async () => {
    const { updateBlockContent } = await import('../actions/documentBlockContentActions');
    vi.mocked(updateBlockContent).mockResolvedValue({ actionError: 'Permission denied' } as any);
    const { controllerRef, onUnsavedChangesChange } = mount();

    edit();
    await act(async () => {
      await expect(controllerRef.current!.save()).rejects.toThrow('Permission denied');
    });

    expect(lastRegistered()).toEqual(['document-editor-doc-1', true]);
    expect(onUnsavedChangesChange).not.toHaveBeenCalledWith(false);
  });

  it('keeps the unsaved-changes state when the user typed while the save was in flight', async () => {
    const { updateBlockContent } = await import('../actions/documentBlockContentActions');
    let resolveSave: (value: unknown) => void = () => undefined;
    vi.mocked(updateBlockContent).mockImplementation(
      () => new Promise((resolve) => { resolveSave = resolve; }) as any
    );
    const { controllerRef } = mount();

    edit();
    let saving!: Promise<void>;
    act(() => {
      saving = controllerRef.current!.save();
    });
    edit();
    await act(async () => {
      resolveSave({ success: true });
      await saving;
    });

    expect(lastRegistered()).toEqual(['document-editor-doc-1', true]);
  });
});
