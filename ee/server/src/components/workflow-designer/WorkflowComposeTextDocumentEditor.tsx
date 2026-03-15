'use client';

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
} from 'react';
import {
  BasicTextStyleButton,
  BlockNoteViewEditor,
  BlockTypeSelect,
  CreateLinkButton,
  FormattingToolbar,
  createReactInlineContentSpec,
  useCreateBlockNote,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import {
  BlockNoteSchema,
  createHeadingBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
  type PartialBlock,
} from '@blocknote/core';
import { RiCodeBoxLine, RiH1, RiH2, RiH3, RiListOrdered, RiListUnordered, RiQuoteText, RiText } from 'react-icons/ri';

import {
  hydrateComposeTextDocumentToBlocks,
  serializeComposeTextBlocksToDocument,
} from './workflowComposeTextUtils';
import type { TemplateDocument } from '@alga-psa/workflows/authoring';

export type WorkflowComposeTextDocumentEditorHandle = {
  insertReference: (reference: { path: string; label: string }) => boolean;
};

const { paragraph, bulletListItem, numberedListItem, quote, codeBlock } = defaultBlockSpecs;
const { bold, italic, code } = defaultStyleSpecs;

const workflowReferenceChip = createReactInlineContentSpec(
  {
    type: 'workflowReference',
    propSchema: {
      path: { default: '' },
      label: { default: 'Reference' },
    },
    content: 'none',
  },
  {
    render: ({ inlineContent }) => (
      <span
        className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700"
        data-compose-text-reference-chip={inlineContent.props.path}
        title={inlineContent.props.path}
      >
        {inlineContent.props.label}
      </span>
    ),
  }
);

export const composeTextBlockNoteSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph,
    heading: createHeadingBlockSpec({ levels: [1, 2, 3], allowToggleHeadings: false }),
    bulletListItem,
    numberedListItem,
    quote,
    codeBlock,
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    workflowReference: workflowReferenceChip,
  },
  styleSpecs: {
    bold,
    italic,
    code,
  },
});

const composeTextBlockTypeItems = [
  { name: 'Paragraph', type: 'paragraph', icon: RiText },
  { name: 'Heading 1', type: 'heading', props: { level: 1, isToggleable: false }, icon: RiH1 },
  { name: 'Heading 2', type: 'heading', props: { level: 2, isToggleable: false }, icon: RiH2 },
  { name: 'Heading 3', type: 'heading', props: { level: 3, isToggleable: false }, icon: RiH3 },
  { name: 'Bullet List', type: 'bulletListItem', icon: RiListUnordered },
  { name: 'Numbered List', type: 'numberedListItem', icon: RiListOrdered },
  { name: 'Quote', type: 'quote', icon: RiQuoteText },
  { name: 'Code Block', type: 'codeBlock', icon: RiCodeBoxLine },
] as const;

const ComposeTextFormattingToolbar = () => (
  <FormattingToolbar blockTypeSelectItems={composeTextBlockTypeItems as never}>
    <BlockTypeSelect items={composeTextBlockTypeItems as never} />
    <BasicTextStyleButton basicTextStyle="bold" />
    <BasicTextStyleButton basicTextStyle="italic" />
    <BasicTextStyleButton basicTextStyle="code" />
    <CreateLinkButton />
  </FormattingToolbar>
);

type WorkflowComposeTextDocumentEditorProps = {
  value: TemplateDocument;
  disabled?: boolean;
  onChange: (document: TemplateDocument) => void;
};

export const WorkflowComposeTextDocumentEditor = forwardRef<
  WorkflowComposeTextDocumentEditorHandle,
  WorkflowComposeTextDocumentEditorProps
>(({ value, disabled = false, onChange }, ref) => {
  const initialContent = useMemo(
    () => hydrateComposeTextDocumentToBlocks(value),
    [value]
  );

  const editor = useCreateBlockNote({
    schema: composeTextBlockNoteSchema,
    initialContent,
    placeholders: {
      default: 'Compose markdown text…',
    },
  });

  useImperativeHandle(ref, () => ({
    insertReference: ({ path, label }) => {
      const currentBlock = editor.getTextCursorPosition().block;
      if (currentBlock.type === 'codeBlock') {
        return false;
      }

      editor.focus();
      editor.insertInlineContent([
        {
          type: 'workflowReference',
          props: { path, label },
        },
        ' ',
      ]);
      return true;
    },
  }), [editor]);

  useEffect(() => {
    return editor.onChange(() => {
      onChange(serializeComposeTextBlocksToDocument(editor.document as PartialBlock[]));
    });
  }, [editor, onChange]);

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-gray-200 bg-white">
        <BlockNoteView
          editor={editor}
          editable={!disabled}
          slashMenu={false}
          sideMenu={false}
          tableHandles={false}
          filePanel={false}
          emojiPicker={false}
          formattingToolbar={false}
          theme="light"
          renderEditor={false}
          className="overflow-hidden [&_.bn-editor]:min-h-[240px]"
        >
          <div className="border-b border-gray-200 bg-gray-50 px-3 py-2">
            <ComposeTextFormattingToolbar />
          </div>
          <BlockNoteViewEditor />
        </BlockNoteView>
      </div>
      <p className="text-xs text-gray-500">
        References render as inline chips and persist as workflow-safe reference nodes.
      </p>
    </div>
  );
});

WorkflowComposeTextDocumentEditor.displayName = 'WorkflowComposeTextDocumentEditor';
