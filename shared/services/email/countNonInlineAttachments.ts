/**
 * Number of non-inline attachments on an inbound email. Inline (`cid:`) images are already
 * rendered inside the body, so they are not counted for the "N attachments" opener summary.
 *
 * An attachment is inline when the provider flagged it (`isInline`), or, when the flag is
 * absent (e.g. the workflow schema strips it), when it carries a Content-ID.
 * Returns undefined when the attachment list is unknown.
 */
export function countNonInlineAttachments(
  attachments: ReadonlyArray<{ isInline?: boolean; contentId?: string | null }> | null | undefined
): number | undefined {
  if (!Array.isArray(attachments)) return undefined;
  return attachments.filter((attachment) => {
    if (attachment?.isInline === true) return false;
    if (attachment?.isInline === undefined && attachment?.contentId) return false;
    return true;
  }).length;
}
