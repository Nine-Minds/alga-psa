// @vitest-environment jsdom

import React, { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const {
  blockNoteViewPropsSpy,
  insertInlineContentMock,
  focusMock,
  getTextCursorPositionMock,
} = vi.hoisted(() => ({
  blockNoteViewPropsSpy: vi.fn(),
  insertInlineContentMock: vi.fn(),
  focusMock: vi.fn(),
  getTextCursorPositionMock: vi.fn(() => ({ block: { type: 'paragraph' } })),
}));

vi.mock('@blocknote/react', async () => {
  const React = await import('react');
  return {
    createReactInlineContentSpec: vi.fn((config) => ({ config })),
    useCreateBlockNote: vi.fn(() => ({
      document: [],
      schema: {},
      getTextCursorPosition: getTextCursorPositionMock,
      focus: focusMock,
      insertInlineContent: insertInlineContentMock,
      onChange: () => () => undefined,
    })),
    BlockNoteViewEditor: () => <div data-testid="blocknote-view-editor" />,
    FormattingToolbar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    BlockTypeSelect: () => <button type="button">Block type</button>,
    BasicTextStyleButton: ({ basicTextStyle }: { basicTextStyle: string }) => <button type="button">{basicTextStyle}</button>,
    CreateLinkButton: () => <button type="button">link</button>,
  };
});

vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: ({ children, ...props }: any) => {
    blockNoteViewPropsSpy(props);
    return <div data-testid="blocknote-view-props">{children}</div>;
  },
}));

import {
  WorkflowComposeTextDocumentEditor,
  type WorkflowComposeTextDocumentEditorHandle,
} from '../WorkflowComposeTextDocumentEditor';

describe('WorkflowComposeTextDocumentEditor', () => {
  it('T031/T033: inserts workflow reference chips through the editor ref and disables unsupported BlockNote affordances', () => {
    const ref = createRef<WorkflowComposeTextDocumentEditorHandle>();

    render(
      <WorkflowComposeTextDocumentEditor
        ref={ref}
        value={{ version: 1, blocks: [] }}
        onChange={() => undefined}
      />
    );

    expect(blockNoteViewPropsSpy).toHaveBeenCalledWith(expect.objectContaining({
      slashMenu: false,
      sideMenu: false,
      filePanel: false,
      tableHandles: false,
      formattingToolbar: false,
      renderEditor: false,
    }));

    expect(screen.getByRole('button', { name: 'Block type' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'bold' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'italic' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'link' })).toBeInTheDocument();
    expect(screen.getByTestId('blocknote-view-editor')).toBeInTheDocument();

    expect(ref.current?.insertReference({
      path: 'payload.ticket.id',
      label: 'id',
    })).toBe(true);

    expect(focusMock).toHaveBeenCalled();
    expect(insertInlineContentMock).toHaveBeenCalledWith([
      {
        type: 'workflowReference',
        props: {
          path: 'payload.ticket.id',
          label: 'id',
        },
      },
      ' ',
    ]);
    expect(screen.getByTestId('blocknote-view-props')).toBeInTheDocument();
  });
});
