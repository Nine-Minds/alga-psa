/**
 * True only for an unmodified primary-button click — the one case where a link
 * may swallow the browser's own navigation and do something in-app instead.
 *
 * Entity names in lists are anchors so Ctrl/Cmd+Click, middle-click and "Open
 * link in new tab" work. Where a plain click opens a drawer rather than the
 * full page, the handler must preventDefault for that click only and leave
 * every modified or non-primary click to the browser.
 */
export interface PlainLeftClickCandidate {
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export function isPlainLeftClick(event: PlainLeftClickCandidate): boolean {
  return (
    (event.button ?? 0) === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey
  );
}
