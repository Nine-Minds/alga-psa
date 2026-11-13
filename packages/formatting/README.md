# Rich-text exports

Use `convertBlockContentToHTML` for document HTML and `formatBlockNoteContent`
for notification HTML plus its text alternative. Both accept BlockNote arrays,
ProseMirror documents, and their serialized JSON forms. Keep structured content
until rendering; flattening it first loses tables, headings, lists, and styles.

- Current object-shaped and legacy array-shaped table cells retain their content.
- Headings, inline styles, nested lists, checklists, quotes, code, and dividers
  retain their structure. Toggle children are expanded for static output.
- Images retain their source and caption. Server-side PDF and preview callers
  must prepare HTML with
  [`prepareHtmlForIsolatedRendering`](../core/src/lib/rendering/isolatedRendering.ts)
  and apply `configureIsolatedPage` before rendering.
  [`PdfGenerationService`](../billing/src/services/pdfGenerationService.ts)
  and document previews via
  [`renderHtmlToPng`](../documents/src/lib/renderHtmlToPng.ts) apply both
  protections: only validated images are inlined, and Chromium cannot fetch
  arbitrary resources. Images without a safe source are rendered
  as a visible marker; callers can localize it with `missingImagePlaceholder`.
- Audio, video, files, and URL-based embeds become escaped, sanitized links,
  not executable embedded players.
- Unknown textual blocks retain their text with a warning. Blocks that cannot
  be represented (unknown non-text blocks, malformed tables, media without a
  safe URL) are logged and rendered as a visible
  `UNSUPPORTED_RICH_TEXT_PLACEHOLDER` ("[Unsupported content]") so one bad
  block never fails an email send or worksheet render, and content is never
  silently dropped or serialized as JSON. Callers can pass a localized
  `unsupportedContentPlaceholder` through `RichTextRenderOptions`; it is
  escaped in HTML and does not replace matching user-authored text. Callers
  can also supply `onUnsupportedContent` for source-specific logging; ticket
  email logs include the tenant, ticket, comment, and unsupported block type.

## Images in ticket notifications

Ticket comment and resolution emails, and rich-text descriptions in
ticket-created and board-status emails, reconstruct persisted content at
delivery and retry. Images in that content are included only when every To,
Cc, and Bcc recipient is verified active internal staff with ticket access.
Alga-hosted images additionally require current document access for every
recipient. External, mixed, inactive, or unverified audiences receive a
localized unavailable-image marker instead. This restriction also applies to
externally hosted and data-URL images in rich content; it does not change
template-owned branding. Protected image URLs that cannot be verified against
an authorized ticket document are replaced by the marker rather than treated
as externally hosted images.

The sender does not split a shared message. Mixed or unverified audiences also
receive markers in place of protected document links and media embeds, and
unverified supplied attachments are omitted. Verified external-only messages
also discard supplied attachments whose current authorization cannot be checked,
but continue to use the existing authorization and delivery rules for
reconstructed non-image attachments with a known non-image MIME type. Unknown
binary types are not trusted as non-images. Precomputed inline attachments,
including custom CID attachments, are omitted even for internal messages
because their document access cannot be rechecked. The email service
independently resolves standard template logos.

Older queued messages without a persisted source identity retain their
existing text and ordinary links, but their original visibility cannot be
rechecked. Images, protected embeds, and unverified attachments are removed
from those messages. Images exceeding provider limits receive a marker; a
managed-file download failure fails delivery instead of silently omitting the
file. A single authorized internal recipient may additionally receive a
time-limited, recipient-bound download link for a managed image that exceeds
attachment limits.
