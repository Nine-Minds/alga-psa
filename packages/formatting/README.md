# Rich-text exports

Use `convertBlockContentToHTML` for document HTML and `formatBlockNoteContent`
for notification HTML plus its text alternative. Both accept BlockNote arrays,
ProseMirror documents, and their serialized JSON forms. Keep structured content
until rendering; flattening it first loses tables, headings, lists, and styles.

- Current object-shaped and legacy array-shaped table cells retain their content.
- Headings, inline styles, nested lists, checklists, quotes, code, and dividers
  retain their structure. Toggle children are expanded for static output.
- Images retain their source and caption. PDF callers must use the shared
  isolated-rendering pipeline: only validated images are inlined; unavailable
  resources use its placeholder behavior.
- Audio, video, files, and URL-based embeds become escaped, sanitized links,
  not executable embedded players.
- Unknown textual blocks retain their text with a warning. Blocks that cannot
  be represented throw `UnsupportedRichTextBlockError`; notifications must not
  silently replace those failures with empty content or serialized JSON.

The standard customer worksheet uses `ticketDescriptionRichText`. The legacy
`ticketDescription` binding remains plain text for existing custom templates.
Neither description binding is exposed on ordinary work tags.
