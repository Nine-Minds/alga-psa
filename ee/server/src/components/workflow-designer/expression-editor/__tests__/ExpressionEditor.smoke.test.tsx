// @vitest-environment jsdom

import React, { createRef } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type * as monaco from 'monaco-editor';
import type { ExpressionEditorHandle } from '../ExpressionEditor';

const insertTextIntoMonacoEditorMock = vi.fn();

const fakeModel = {
  uri: { toString: () => 'inmemory:/workflow-expression-smoke' },
  getValue: () => '',
};

const fakeEditor = {
  getModel: () => fakeModel,
  onDidChangeModelContent: () => ({ dispose: () => undefined }),
  onDidFocusEditorWidget: () => ({ dispose: () => undefined }),
  onDidBlurEditorWidget: () => ({ dispose: () => undefined }),
  addCommand: () => 1,
  trigger: () => undefined,
  getDomNode: () => document.createElement('div'),
  getTargetAtClientPoint: () => null,
  setSelection: () => undefined,
  onDidDispose: () => ({ dispose: () => undefined }),
  createDecorationsCollection: () => ({ set: () => undefined, clear: () => undefined }),
  focus: () => undefined,
} as unknown as monaco.editor.IStandaloneCodeEditor;

const fakeMonaco = {
  KeyCode: { Enter: 13, Space: 10 },
  KeyMod: { CtrlCmd: 1024 },
  Selection: class {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) { }
  },
  Range: class {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) { }
  },
} as unknown as typeof monaco;

vi.mock('@alga-psa/workflows/expression-authoring', () => ({
  insertTextIntoMonacoEditor: (...args: unknown[]) => insertTextIntoMonacoEditorMock(...args),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));

vi.mock('../jsonataLanguage', () => ({
  LANGUAGE_ID: 'jsonata',
  registerJsonataLanguage: vi.fn(),
}));

vi.mock('../jsonataTheme', () => ({
  LIGHT_THEME_NAME: 'jsonata-light',
  DARK_THEME_NAME: 'jsonata-dark',
  registerJsonataThemes: vi.fn(),
}));

vi.mock('../completionProvider', () => ({
  registerCompletionProvider: vi.fn(),
}));

vi.mock('../hoverProvider', () => ({
  registerHoverProvider: vi.fn(),
}));

vi.mock('../signatureHelpProvider', () => ({
  registerSignatureHelpProvider: vi.fn(),
}));

vi.mock('../diagnosticsProvider', () => ({
  createDiagnosticsProvider: () => ({
    updateDiagnostics: vi.fn(),
    clearDiagnostics: vi.fn(),
  }),
  validateExpression: () => [],
}));

vi.mock('@monaco-editor/react', () => {
  const Editor = ({ onMount }: { onMount?: (editor: monaco.editor.IStandaloneCodeEditor, instance: typeof monaco) => void }) => {
    React.useEffect(() => {
      onMount?.(fakeEditor, fakeMonaco);
    }, [onMount]);
    return <div data-automation-id="workflow-expression-editor-mock" />;
  };

  return {
    default: Editor,
    loader: {},
    useMonaco: () => fakeMonaco,
  };
});

import { ExpressionEditor } from '../ExpressionEditor';

describe('ExpressionEditor smoke', () => {
  it('renders and accepts an inserted workflow binding path', async () => {
    const ref = createRef<ExpressionEditorHandle>();

    render(
      <ExpressionEditor
        ref={ref}
        value=""
        onChange={() => undefined}
        ariaLabel="Workflow expression editor"
      />
    );

    await waitFor(() => {
      expect(document.querySelector('[data-automation-id="workflow-expression-editor-mock"]')).not.toBeNull();
      expect(ref.current).not.toBeNull();
    });

    act(() => {
      ref.current?.insertAtCursor('payload.customer.name');
    });

    expect(insertTextIntoMonacoEditorMock).toHaveBeenCalledWith(
      fakeEditor,
      'payload.customer.name',
      expect.objectContaining({ source: 'expression-editor', requireFocus: false }),
    );
  });
});
