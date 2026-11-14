'use client';

import { useMemo } from 'react';
import { en, de, es, fr, it, nl, pl, pt } from '@blocknote/core/locales';
import { useOptionalI18n } from '@alga-psa/ui/lib/i18n/client';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { useAppTheme } from '@alga-psa/ui/hooks/useAppTheme';
import type { CoManagedRichTextDocument } from '@alga-psa/co-managed/conversationRichText';
import '@blocknote/core/fonts/inter.css';
import '@alga-psa/ui/editor/blocknote-styles.css';

// Resource-bearing blocks need an owner-qualified upload/read path. Keeping them
// out of the editor schema also excludes their slash commands and paste nodes.
const { audio, file, image, video, ...textBlocks } = defaultBlockSpecs;
const dictionaries = { en, de, es, fr, it, nl, pl, pt };
function pseudoDictionary<T>(value: T, digit: string): T {
  if (typeof value === 'string') return value.replace(/[A-Za-z]/g, digit) as T;
  if (typeof value === 'function') return ((...args: unknown[]) => pseudoDictionary(value(...args), digit)) as T;
  if (Array.isArray(value)) return value.map(item => pseudoDictionary(item, digit)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, pseudoDictionary(item, digit)])) as T;
  return value;
}
const schema = BlockNoteSchema.create({ blockSpecs: textBlocks });
export default function CoManagedConversationDocument({ id, label, document, editable = false, onChange }: {
  id: string; label?: string; document: CoManagedRichTextDocument; editable?: boolean;
  onChange?: (document: CoManagedRichTextDocument) => void;
}) {
  const { resolvedTheme } = useAppTheme();
  const locale = useOptionalI18n()?.locale ?? 'en';
  const dictionary = useMemo(() => {
    if (locale === 'xx' || locale === 'yy') return pseudoDictionary(en, locale === 'xx' ? '1' : '2');
    return dictionaries[locale as keyof typeof dictionaries] ?? en;
  }, [locale]);
  const editor = useCreateBlockNote({ schema, dictionary, initialContent: document.length ? document as any : undefined,
    domAttributes: { editor: { id: `${id}-input`, ...(label ? { 'aria-labelledby': `${id}-label` } : {}) } },
  }, [dictionary]);
  return <div className="min-w-0" data-keyboard-shortcuts-editor-root={editable || undefined}>
    {label && <p id={`${id}-label`} className="mb-2 text-sm font-medium">{label}</p>}
    <BlockNoteView editor={editor} editable={editable} theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      id={id} aria-labelledby={label ? `${id}-label` : undefined} emojiPicker={false}
      onChange={() => onChange?.(editor.document)}
      className="min-w-0 break-words [&_.ProseMirror]:min-w-0 [&_.ProseMirror_a]:text-[rgb(var(--badge-info-text))] [&_.ProseMirror_a]:underline" />
  </div>;
}
