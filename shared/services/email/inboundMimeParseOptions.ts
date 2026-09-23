/**
 * Options every inbound raw-MIME parse must use.
 *
 * mailparser's default rewrites `<img src="cid:...">` in `parsed.html` to a
 * base64 `data:` URI while still listing the inline part under
 * `parsed.attachments`. Downstream embedded-image extraction would then store
 * the data URL as a synthetic `embedded-image-N` document AND persist the
 * original CID part, because no `cid:` reference survives for it to be marked
 * as consumed. Keeping CID links lets the CID pathway persist one image and
 * rewrite the comment body to it.
 */
export const INBOUND_MIME_PARSE_OPTIONS = { keepCidLinks: true } as const;
