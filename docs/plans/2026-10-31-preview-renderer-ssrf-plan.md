# Preview rendering must not be a network client

Card: `dad7e755-770e-5135-92e7-7eb1f8013edd` — Security: ssrf in `BaseDocumentHandler.renderHtmlToPng`
Finding source: security review of PR #3993 (merge `dbf5978b864f`), review card `cfebdd89-cc5d-5695-8257-62dabbe7007e`
Fingerprint: `packages/documents/src/handlers/BaseDocumentHandler.ts#renderHtmlToPng`

## The defect

Preview generation renders **caller-controlled HTML** in server-side Chromium with no network policy:

1. `createBlockDocument` stores `block_data` verbatim for anyone with `document:create`
   (`packages/documents/src/actions/documentBlockContentActions.ts:76-121`).
2. `convertBlockContentToHTML` re-emits image-block URLs into `<img src>` after a **scheme** check only
   (`packages/formatting/src/blocknoteUtils.ts:19-35,868-886`) — `http:` and `https:` are explicitly allowed.
3. `BlockNoteDocumentHandler.generatePreview` converts that content to HTML and calls
   `this.renderHtmlToPng(...)` (`packages/documents/src/handlers/BlockNoteDocumentHandler.ts:60-79`).
4. `BaseDocumentHandler.renderHtmlToPng` calls `page.setContent(styledHtml)` with **no request interception**
   (`packages/documents/src/handlers/BaseDocumentHandler.ts:90-130`). Chromium therefore issues the requests:
   `<img src>`, CSS `url(...)`, `@import`, `<iframe>`, and anything a script opens (JS is enabled today).

So a user who can create a block document can make the **application server** GET any URL it can reach —
`127.0.0.1`, RFC1918, `169.254.169.254` cloud metadata, internal admin ports — and, where the response is a
renderable image, read it back inside the returned preview PNG (`getDocumentPreview`,
`packages/documents/src/actions/documentActions.ts:1296+`). That is SSRF with an exfiltration channel, plus a
port-scan oracle through response timing.

Two more facts that shape the fix:

- There are **two copies** of the renderer: the handler base class (`BaseDocumentHandler.ts:90`) and a second,
  **unused** copy in `documentActions.ts:1230`. Five handlers inherit the base one
  (`BlockNote`, `Text`, `Markdown`, `Office`, `GenericFile`). A per-call-site fix would leave the other copy and
  the next handler exposed.
- No shared SSRF guard exists in the repo today (checked: no private-address classification, no safe fetch
  helper). The sibling finding on webhook delivery (`910e2223`) needs the same primitive.

## The fix — one renderer, deny-by-default network

### 1. Extract the renderer into one shared module

New `packages/documents/src/lib/renderHtmlToPng.ts`, used by `BaseDocumentHandler` (which the five handlers
inherit) and replacing the dead copy in `documentActions.ts`. Signature keeps back-compat:

```ts
export interface RenderHtmlToPngOptions {
  width?: number;
  height?: number;
  /** 'inline' (default): fetch allowed remote images through safeFetch and embed bytes.
   *  'block': render without any remote asset at all. */
  remoteAssets?: 'inline' | 'block';
}
export async function renderHtmlToPng(html: string, opts?: RenderHtmlToPngOptions): Promise<Buffer>
```

Delete `documentActions.ts:1230-1258` (dead code) and drop the unused `puppeteer` import if it becomes unused.

### 2. Chromium renders with the network closed

Inside the shared module:

```ts
await page.setJavaScriptEnabled(false);            // no script-initiated requests at all
await page.setRequestInterception(true);
page.on('request', (req) => {
  const url = req.url();
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return req.continue();
  return req.abort();
});
```

- The initial `page.setContent` document is not a network request, so this blocks **every** outbound request
  while leaving data-URI/inlined assets working.
- `--no-sandbox` and the other launch flags stay (container constraint, unrelated to this finding — note it in
  the diff so a reviewer does not read it as scope creep).
- Keep `waitUntil: 'domcontentloaded'`; with JS disabled and remote requests aborted, render time drops.

### 3. Remote images are fetched by us, through a hardened fetch, then inlined

Under `remoteAssets: 'inline'` the module scans the HTML for `src="…"` and CSS `url(…)` values that are
`http:`/`https:`, fetches each through the new safe fetch, and replaces the reference with a `data:` URI.
Anything refused (or non-image, or over the size cap) is replaced with a neutral placeholder (grey box plus the
original `alt` text) — a blocked asset must never break the preview.

New shared primitive `packages/core/src/lib/net/safeFetch.ts` (core already exports to documents; `undici` is a
root dependency):

```ts
export class UnsafeUrlError extends Error {}
export function isPublicAddress(ip: string): boolean
export async function assertPublicUrl(url: string, deps?: { lookup? }): Promise<{ url: URL; address: string }>
export async function fetchPublicBytes(url: string, opts?: {
  maxBytes?: number; timeoutMs?: number; allowedContentTypes?: string[];
  lookup?; request?;            // injection points for tests
}): Promise<{ bytes: Buffer; contentType: string; finalUrl: string }>
```

Policy, in this order:

1. Parse; require `http:`/`https:`; reject embedded credentials.
2. Reject a **literal** IP host that is not public (no DNS needed).
3. Resolve the hostname (`dns.lookup(host, { all: true })`) and reject if **any** returned address is
   non-public: loopback, RFC1918, CGNAT `100.64/10`, link-local `169.254/16` (metadata), ULA `fc00::/7`,
   `::1`, `fe80::/10`, unspecified `0.0.0.0`/`::`, multicast/broadcast, and IPv4-mapped IPv6 forms.
4. **Pin** the connection to the validated address (`lookup` override on the undici dispatcher) so a second DNS
   answer cannot swing the request to a private address (rebinding).
5. Follow at most 3 redirects, validating **every** hop with the same policy before connecting.
6. Cap the body (5 MB) and the whole exchange (5 s); abort on overflow.
7. Only `image/*` content types are inlined; anything else is treated as a blocked asset.

Both `lookup` and the request function are injectable so the tests never touch the real network.

### 4. What stays as-is

- `sanitizeUrl` / `sanitizeImageSrc` keep blocking non-web schemes at the formatting layer. They are a
  correctness and XSS control, **not** the security boundary here — the server-side deny is.
- Document creation stays permissive: a user may keep an `https://` image URL in their block data, and the
  editor still renders it client-side. Rejecting remote URLs at ingestion would break a legitimate feature and
  would still leave the renderer unsafe for the next writer.
- The preview cache keeps its current per-document keys.

## Tests

New `packages/documents/src/lib/renderHtmlToPng.test.ts`:

1. **No network, ever.** Bind a local HTTP listener that counts connections; render HTML containing
   `<img src="http://127.0.0.1:<port>/x.png">`, an `<iframe src=…>`, and CSS `url(http://127.0.0.1:<port>/y)`;
   assert the listener saw **zero** connections and a PNG came back. This is the test that fails on today's
   code.
2. `remoteAssets: 'block'` renders the same HTML with a placeholder and no network.
3. `remoteAssets: 'inline'` with an injected safe fetch that returns a small PNG → the `<img>` source is a
   `data:image/png` URI in the page the renderer builds (assert via the module's own asset-resolution hook, not
   by scraping pixels).
4. Text/markdown/office/generic previews still return a PNG buffer (the extraction did not change them).

New `packages/core/src/lib/net/safeFetch.test.ts`:

5. Address table: `127.0.0.1`, `10.0.0.1`, `172.16.0.1`, `192.168.1.1`, `169.254.169.254`, `100.64.0.1`,
   `::1`, `fc00::1`, `fe80::1`, `0.0.0.0`, `::ffff:127.0.0.1` → refused before any connect.
6. A hostname resolving to a public address (injected lookup + injected request) → fetched.
7. A hostname resolving to **mixed** public + private answers → refused.
8. Redirect chain `public → 127.0.0.1` → refused at the hop, before connecting to loopback.
9. Body over `maxBytes` → aborted; `text/html` content type → refused for inlining.
10. Rebinding: the injected `lookup` returns public on the first call and private on the second; assert the
    request still goes to the pinned address (no second resolution).

Action-level regression: `getDocumentPreview` on a stored block document whose `block_data` contains a loopback
image URL returns a preview while the loopback listener sees no connection.

## Deliberately not doing

- **Not stripping remote URLs from stored block data** — that would break the editor's legitimate remote-image
  support and is not where the defect lives.
- **Not** changing client CSPs, the client editor, or the download route.
- **Not rolling `safeFetch` into webhook delivery here** — that is card `910e2223`'s finding. It is built as a
  general core primitive precisely so that card adopts it rather than growing a second copy, and so the next
  server-side fetcher has an obvious tool.
- **Not** removing Chromium's `--no-sandbox` flags (container requirement, separate concern).

## Risks

- **Fidelity loss for remote images in previews.** Today an `<img src="https://…">` renders if the host serves
  it in time; after the fix it renders only when the safe fetch succeeds. The inline path keeps public images
  working; blocked ones become placeholders. This is the intended trade — the preview is server-rendered on
  attacker-controlled input.
- **DNS pinning is the subtle part.** `assertPublicUrl` returning an address that the transport does not
  actually use is a false sense of safety; the test in item 10 exists to keep the pin honest.
- **Puppeteer/Chromium behaviour drift** — interception plus `setJavaScriptEnabled(false)` is the documented
  path, but the launch-flags/env (`PUPPETEER_EXECUTABLE_PATH`) vary between dev and Docker. Test 1 runs against
  both configurations where the environment allows.
- **Cache poisoning of the port-scan oracle is moot after the fix**, but existing cached previews are not
  re-rendered. No migration needed: a cached preview is the requester's own document image.

## Order of work

1. `safeFetch` in core (+ tests 5-10). No callers yet.
2. Shared `renderHtmlToPng` with interception + JS off; point `BaseDocumentHandler` at it; delete the dead copy
   (+ tests 1, 2, 4).
3. Remote-asset inlining through `safeFetch` (+ test 3) and the action-level regression.
4. Run the documents package tests plus the preview/download suites; no evidence-only commits.
