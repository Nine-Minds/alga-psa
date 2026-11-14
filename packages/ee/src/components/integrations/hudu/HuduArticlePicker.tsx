'use client';

/**
 * CE stub for the "Pick from Hudu" article picker used by the ticket template editor
 * (ee/server/src/components/integrations/hudu/HuduArticlePicker.tsx, resolved via the
 * edition-swapped `@enterprise` alias). Hudu is an EE integration: render nothing in CE.
 */

export interface HuduPickedArticle {
  /** Hudu article id, as a string (the link's external_id). */
  external_id: string;
  /** Absolute Hudu URL of the article. */
  url: string;
  title: string;
}

export interface HuduArticlePickerProps {
  id: string;
  disabled?: boolean;
  onPick: (article: HuduPickedArticle) => void;
}

export function HuduArticlePicker(_props: HuduArticlePickerProps) {
  return null;
}

export default HuduArticlePicker;
