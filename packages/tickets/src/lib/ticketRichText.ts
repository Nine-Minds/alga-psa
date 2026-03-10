import { PartialBlock } from '@blocknote/core';
import { DEFAULT_BLOCK } from '@alga-psa/ui/editor';

function cloneDefaultBlock(): PartialBlock[] {
  return JSON.parse(JSON.stringify(DEFAULT_BLOCK));
}

export function createTicketRichTextParagraph(text: string): PartialBlock[] {
  return [
    {
      type: 'paragraph',
      props: {
        textAlignment: 'left',
        backgroundColor: 'default',
        textColor: 'default',
      },
      content: [
        {
          type: 'text',
          text,
          styles: {},
        },
      ],
    },
  ];
}

export function parseTicketRichTextContent(
  content: string | null | undefined,
  options?: {
    onParseError?: (error: unknown) => void;
  }
): PartialBlock[] {
  if (!content) {
    return cloneDefaultBlock();
  }

  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return cloneDefaultBlock();
  }

  if (trimmedContent.startsWith('[')) {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as PartialBlock[];
      }
    } catch (error) {
      options?.onParseError?.(error);
    }
  }

  return createTicketRichTextParagraph(content);
}

export function serializeTicketRichTextContent(content: PartialBlock[]): string {
  return JSON.stringify(content);
}
