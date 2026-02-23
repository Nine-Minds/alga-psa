import { marked } from 'marked';

const MARKDOWN_PATTERN = /^#{1,6}\s|^\*\s|^-\s|^\d+\.\s|\*\*[^*]+\*\*|\[.+\]\(.+\)|^```/m;

export const handleMarkdownPaste = (
  plainText: string | null | undefined,
  htmlText: string | null | undefined,
  insertContent: (html: string) => void
): boolean => {
  if (!plainText || htmlText) return false;

  if (!MARKDOWN_PATTERN.test(plainText)) return false;

  try {
    const html = marked.parse(plainText, { async: false }) as string;
    if (html && html !== `<p>${plainText}</p>\n`) {
      insertContent(html);
      return true;
    }
  } catch (error) {
    console.error('Markdown paste conversion failed:', error);
  }

  return false;
};
