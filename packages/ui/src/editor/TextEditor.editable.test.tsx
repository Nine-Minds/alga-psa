/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const viewProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
const createOptions = vi.hoisted(() => ({ last: null as any }));

vi.mock('@blocknote/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCreateBlockNote: (options: unknown) => {
    createOptions.last = options;
    return { document: [], isEditable: true, onChange: () => () => undefined, _tiptapEditor: { view: null } };
  },
  SuggestionMenuController: () => <div data-testid="suggestion" />,
  GridSuggestionMenuController: () => <div data-testid="grid-suggestion" />,
}));
vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: (props: Record<string, unknown>) => {
    viewProps.last = props;
    return <div data-testid="blocknote-view">{props.children as React.ReactNode}</div>;
  },
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));
vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, fallback?: string) => fallback ?? _k }),
}));

import TextEditor from './TextEditor';

afterEach(() => cleanup());

describe('TextEditor editable', () => {
  it('is editable by default', () => {
    const { queryByText, queryAllByTestId } = render(<TextEditor allowFileAttachments uploadFile={async () => 'x'} />);
    expect(viewProps.last!.editable).toBe(true);
    expect(createOptions.last.domAttributes.editor.contenteditable).toBe('true');
    expect(createOptions.last.domAttributes.editor['aria-readonly']).toBeUndefined();
    expect(queryByText('Attach files')).not.toBeNull();
    expect(queryAllByTestId('suggestion')).toHaveLength(1);
  });

  it('is non-editable with editable={false} and drops editing affordances', () => {
    const { queryByText, queryAllByTestId } = render(<TextEditor editable={false} allowFileAttachments uploadFile={async () => 'x'} />);
    expect(viewProps.last!.editable).toBe(false);
    expect(viewProps.last!.formattingToolbar).toBe(false);
    expect(createOptions.last.domAttributes.editor.contenteditable).toBe('false');
    expect(createOptions.last.domAttributes.editor['aria-readonly']).toBe('true');
    expect(queryByText('Attach files')).toBeNull();
    expect(queryAllByTestId('suggestion')).toHaveLength(0);
    expect(queryAllByTestId('grid-suggestion')).toHaveLength(0);
  });
});
