# Spec — a fetch budget for remote assets, not a promise-all

Card `f9995cf6-4912-54b3-971a-1b42f2b42eba` · finding from the security review of PR #4035
(merge `f7ab5d4df016`, review card `225ea84d`) · severity **high** · category **dos**

## 1. The finding, at the mechanism

`resolveRemoteAssets` (`packages/documents/src/lib/renderHtmlToPng.ts:81`) rewrites `<img src>` and
CSS `url(...)` by collecting **every** match and resolving them with `Promise.all`
(`replaceAsync:58-72`). The resolver's cache (`makeResolver:41-56`) deduplicates identical URLs
only, so a document with *n distinct* attacker-chosen URLs starts *n* concurrent fetches. Each
fetch may buffer `DEFAULT_MAX_BYTES = 5 MiB` (`packages/core/src/lib/net/safeFetch.ts:25`) and each
successful payload is retained again as base64 (≈4/3×) in the returned HTML (`:47-50`).

There is no cap on *how many* or *how much* — the only ceilings are per-fetch. And the authoring
permission is ordinary: `createBlockDocument` needs just `document:create` (default for client
users, `server/migrations/utils/permissions/catalog.cjs:150`) and stores `block_data` with no
asset-count or size policy. So one small document is a memory and socket amplifier.

The defect is not "the wrong constant". It is that a resource that is **unbounded in the input**
(the number of URLs in HTML the caller controls) is consumed with an operation whose cost is
**unbounded in the same dimension**. Any fix that only tweaks a timeout leaves the shape intact.

## 2. Decision: an explicit asset budget, enforced in three places

### 2.1 New module `packages/documents/src/lib/remoteAssetBudget.ts`

```ts
export interface RemoteAssetLimits {
  maxAssets: number;        // distinct remote assets considered at all
  concurrency: number;      // simultaneous in-flight fetches
  maxTotalBytes: number;    // across all inlined assets, decoded bytes
  perAssetTimeoutMs: number;
}
export const DEFAULT_REMOTE_ASSET_LIMITS: RemoteAssetLimits;

export interface AssetBudget {
  /** Reserve the right to fetch asset #index. False once the count budget is spent. */
  admit(index: number): boolean;
  /** Charge decoded bytes to the budget; false when the total would be exceeded. */
  charge(bytes: number): boolean;
  readonly spentBytes: number;
  readonly skipped: number;
}
export function createAssetBudget(limits?: Partial<RemoteAssetLimits>): AssetBudget;
export function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]>;
```

**Three distinct bounds, because they fail differently:**

1. **Count** — `admit(index)` is decided by match position, not by race order, so the same
   document always drops the same assets. Beyond `maxAssets` an `<img>` becomes the existing
   neutral placeholder **without a fetch**. This is the deterministic part callers can reason about.
2. **Concurrency** — `replaceAsync` stops doing `Promise.all(matches.map(fn))` and uses
   `mapWithConcurrency(matches, limits.concurrency, fn)`. Results are written into an
   index-keyed array and reassembled in order, so output is byte-identical for a given input.
3. **Total bytes** — after a fetch, `charge(bytes)` accounts the decoded length; once the total
   budget is spent every later asset becomes a placeholder. Memory is then bounded by
   `maxTotalBytes + one asset`, regardless of how many URLs the document names. Charge the
   **decoded** bytes and reserve the base64 expansion factor in the default, because the string
   that survives is what stays resident.

Defaults (call them out in the PR body, they are the policy): `maxAssets: 64`,
`concurrency: 6`, `maxTotalBytes: 16 MiB`, `perAssetTimeoutMs` from safeFetch's own timeout.

### 2.2 The resolver honours the budget

`makeResolver` takes the budget: it admits by position, charges on success, and returns `null`
(placeholder / transparent pixel) when either bound is hit — the *same* failure mode the code
already has for a refused asset, so the preview degrades instead of failing. The cache stays, keyed
by URL, because a repeated URL costs nothing and must not consume the budget twice.

Every existing caller (`BlockNoteDocumentHandler:79`, `MarkdownDocumentHandler:67`,
`TextDocumentHandler:69`, `GenericFileDocumentHandler:59`, `OfficeDocumentHandler:81`)
inherits the bound through `renderHtmlToPng` with no changes; `RenderHtmlToPngOptions` gains an
optional `limits` so a caller that legitimately needs more can raise it deliberately.

### 2.3 Observe, do not just refuse

When the budget bites, the renderer logs once per render (asset count considered, admitted,
skipped by count, skipped by bytes) at warn. A silent cap turns "my images vanished" into a
support mystery; a one-line log makes the policy visible.

## 3. What we are deliberately NOT doing

- **Not raising or lowering safeFetch's per-fetch cap.** Per-asset limits already exist and are
  correct; this card is about the aggregate.
- **Not making `remoteAssets: 'block'` the default.** Inlining is the designed behaviour; the
  default stays and is simply bounded.
- **Not adding a document-size policy to `createBlockDocument`.** That is the *other* half of the
  finding's blast radius and belongs to the document-storage work, not the renderer. This card
  makes the renderer safe for any document, which is the stronger boundary: preview cost must not
  depend on the stored document being well-behaved.
- **Not porting to a worker/streaming pipeline.** The bound is the fix; if a future renderer
  streams, it will consume the same `AssetBudget`.
- **Not rewriting `replaceAsync`'s signature** for other users — if it has callers outside this
  file, they keep working; the concurrency-limited version is added beside it or the helper is
  swapped in with the same contract.

## 4. Tests (extend `renderHtmlToPng.test.ts`, which already has a loopback server)

1. **The finding, reproduced and bounded.** A document with 200 distinct `http://127.0.0.1/…`
   image URLs and an injected `fetchAsset` → at most `maxAssets` fetches happen, in-flight
   requests never exceed `concurrency` (track a high-water mark inside the injected fetcher), and
   the remaining tags are placeholders, not fetches.
2. **Concurrency high-water mark** with a fetcher that awaits a barrier: assert it never exceeds
   `limits.concurrency` and that all admitted assets still resolve.
3. **Byte budget.** Assets of known size: with a budget of N bytes, exactly the assets that fit
   are inlined, the rest are placeholders, and `spentBytes <= maxTotalBytes`.
4. **Deduplication does not double-charge.** The same URL 50 times → one fetch, one charge.
5. **Determinism.** The same input rendered twice → identical output string (admission is
   positional, not race-ordered).
6. **Order preservation.** Mixed inline/blocked assets keep their positions in the output HTML.
7. **Existing behaviour unchanged.** Current tests 1–N (block mode opens zero connections, inline
   mode embeds and placeholder-ises refused assets) stay green with defaults.
8. **Limits are overridable** per call (`renderHtmlToPng(html, { limits: { maxAssets: 2 } })`)
   and the override is what applies.

## 5. Risks

- **Previews of legitimate image-heavy documents lose images.** 64 assets / 16 MiB is generous
  for a block document; the warn log names the skip, and `limits` is the deliberate escape hatch.
- **A placeholder where a user expects an image looks like a bug.** Same tradeoff the renderer
  already makes for refused/failed assets — consistent, not new.
- **Concurrency limits slow large documents.** Six in flight against safeFetch's 5 s timeout is
  the intended latency ceiling; the budget bounds the tail.
- **Total-byte accounting races** under concurrency. Charging after fetch under a single-threaded
  `charge()` is monotonic; the bound is "at most one asset over budget", which is what the test
  asserts. Do not attempt exact-fit accounting that would require reserving bytes before fetching.

## 6. Order of work

1. `remoteAssetBudget.ts` (+ `mapWithConcurrency`) with its own unit tests.
2. Wire it into `makeResolver` / `replaceAsync`; defaults exported.
3. Tests 1–8; PR body quotes the `Promise.all` line, the 5 MiB × n arithmetic, and the three
   bounds with their defaults.
