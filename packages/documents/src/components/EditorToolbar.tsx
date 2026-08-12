'use client';

import { useCallback } from 'react';
import { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Link as LinkIcon,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Quote,
} from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface EditorToolbarProps {
  editor: Editor;
}

function ToolbarButton({
  id,
  onClick,
  isActive,
  icon,
  title,
}: {
  id: string;
  onClick: () => void;
  isActive: boolean;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      className={`p-1.5 rounded transition-colors ${
        isActive
          ? 'bg-[rgb(var(--color-border-200))] text-[rgb(var(--color-text-900))]'
          : 'text-[rgb(var(--color-text-500))] hover:bg-[rgb(var(--color-border-100))]'
      }`}
      title={title}
    >
      {icon}
    </button>
  );
}

export function EditorToolbar({ editor }: EditorToolbarProps) {
  const { t } = useTranslation('features/documents');

  const setLink = useCallback(() => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt(t('editor.toolbar.linkPrompt', { defaultValue: 'URL' }), previousUrl);

    if (url === null) return;

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor, t]);

  if (!editor) return null;

  return (
    <BubbleMenu
      editor={editor}
      className="flex items-center gap-0.5 p-1 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] shadow-md"
    >
      {/* Inline style buttons */}
      <ToolbarButton
        id="editor-toolbar-bold"
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        icon={<Bold className="w-4 h-4" />}
        title={t('editor.toolbar.bold', { defaultValue: 'Bold (Ctrl+B)' })}
      />
      <ToolbarButton
        id="editor-toolbar-italic"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        icon={<Italic className="w-4 h-4" />}
        title={t('editor.toolbar.italic', { defaultValue: 'Italic (Ctrl+I)' })}
      />
      <ToolbarButton
        id="editor-toolbar-underline"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor.isActive('underline')}
        icon={<UnderlineIcon className="w-4 h-4" />}
        title={t('editor.toolbar.underline', { defaultValue: 'Underline (Ctrl+U)' })}
      />
      <ToolbarButton
        id="editor-toolbar-strikethrough"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive('strike')}
        icon={<Strikethrough className="w-4 h-4" />}
        title={t('editor.toolbar.strikethrough', { defaultValue: 'Strikethrough' })}
      />
      <ToolbarButton
        id="editor-toolbar-code"
        onClick={() => editor.chain().focus().toggleCode().run()}
        isActive={editor.isActive('code')}
        icon={<Code className="w-4 h-4" />}
        title={t('editor.toolbar.code', { defaultValue: 'Code' })}
      />

      {/* Separator */}
      <div className="w-px h-5 bg-[rgb(var(--color-border-200))] mx-0.5" />

      {/* Block type buttons */}
      <ToolbarButton
        id="editor-toolbar-heading-1"
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={editor.isActive('heading', { level: 1 })}
        icon={<Heading1 className="w-4 h-4" />}
        title={t('editor.toolbar.heading1', { defaultValue: 'Heading 1' })}
      />
      <ToolbarButton
        id="editor-toolbar-heading-2"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive('heading', { level: 2 })}
        icon={<Heading2 className="w-4 h-4" />}
        title={t('editor.toolbar.heading2', { defaultValue: 'Heading 2' })}
      />
      <ToolbarButton
        id="editor-toolbar-bullet-list"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive('bulletList')}
        icon={<List className="w-4 h-4" />}
        title={t('editor.toolbar.bulletList', { defaultValue: 'Bullet List' })}
      />
      <ToolbarButton
        id="editor-toolbar-ordered-list"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive('orderedList')}
        icon={<ListOrdered className="w-4 h-4" />}
        title={t('editor.toolbar.orderedList', { defaultValue: 'Ordered List' })}
      />
      <ToolbarButton
        id="editor-toolbar-quote"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive('blockquote')}
        icon={<Quote className="w-4 h-4" />}
        title={t('editor.toolbar.quote', { defaultValue: 'Quote' })}
      />

      {/* Separator */}
      <div className="w-px h-5 bg-[rgb(var(--color-border-200))] mx-0.5" />

      {/* Link button */}
      <ToolbarButton
        id="editor-toolbar-link"
        onClick={setLink}
        isActive={editor.isActive('link')}
        icon={<LinkIcon className="w-4 h-4" />}
        title={t('editor.toolbar.link', { defaultValue: 'Link' })}
      />
    </BubbleMenu>
  );
}
