# Fix Plan — Quote/Invoice Logo Rendering & Conversion Reachability

Covers three production tickets (demo tenant, board "Quote to Cash"):

- **alga0002161** — Quote/invoice document templates squash any non-wide logo (missing `object-fit` on `issuer-logo`)
- **alga0002162** — Client-image uploader crops wide raster logos to ~256px wide (truncates wordmarks); SVG path does not
- **alga0002163** — "Convert to Both" is unreachable on any accepted quote

2161 and 2162 compound: today there is **no logo shape that renders correctly** — a square logo gets squashed by the template (2161), a wide raster logo gets cropped on upload (2162). The only shape that works is an SVG authored at a wide aspect ratio. Fixing both makes any reasonable logo render correctly.

---

## Ticket 1 — alga0002161: logo squash in document templates

### Root cause
The `issuer-logo` image node sets `style.inline = { width: '180px', maxHeight: '72px', margin: '0 0 6px 0' }` with **no `objectFit`**. On an `<img>`, `object-fit` defaults to `fill`, so the image stretches to the box, ignoring aspect ratio:

1. `width: 180px` pins width.
2. `height: auto` derives from intrinsic ratio → a 256×256 logo wants height 180.
3. `max-height: 72px` clamps height to 72 but does **not** shrink width.
4. The image paints into 180×72 with `object-fit: fill` → squashed to ~40% of correct height.

Verified live on a quote preview: natural 256×256 → rendered 180×72. Wide logos (e.g. 1200×253) escape only by accident (auto height 38 < 72 cap).

### Renderer supports the fix
- `react-renderer.tsx:512` renders `<img style={style} … />`, and `styleDeclarationToReactStyle` passes the entire inline declaration through as `React.CSSProperties` (`react-renderer.tsx:111-118`). So any inline key is honored.
- `objectFit` **and** `objectPosition` are already declared keys on `TemplateStyleDeclaration` (`packages/types/src/lib/invoice-template-ast.ts:207-208`). No type change needed.

### Architecture finding (decisive for scope)
Standard templates are stored and rendered differently per document type (traced via `packages/billing/src/services/pdfGenerationService.ts`):

| Doc type | Standard AST render source | Code-only TS edit enough? |
|---|---|---|
| **Quote** | DB row `standard_quote_document_templates.templateAst` (global). TS constant is a fallback only when the **row is absent** (`templateSelection.ts:49-58`); for seeded rows the DB value wins. | **No — needs data migration** |
| **Invoice** | DB row `standard_invoice_templates.templateAst` (`invoice.ts:821-843` throws if the row's `templateAst` is missing). **But** multi-location invoices on a standard template swap in the TS constant at render time (`pdfGenerationService.ts:341-352`), so the TS edit is a *live* render source for that path too. | **No — needs data migration** (+ TS edit is live for multi-location) |
| **Sales order / packing slip / pick list** | TS constant directly (`getStandardSalesOrderTemplateAstByCode` / `otherDocuments.ts`); no standard SO DB table exists | **Yes — code-only** |

The seed migrations are hand-copied literal snapshots of the AST (no `require` of the TS builders) and their `.onConflict().merge()` runs **only once** when the migration first executes. There is **no recurring reseed** (`initializeApp.ts:272` confirms templates ship as data). Therefore editing the TS files does **not** change what existing tenants render for the primary quote/invoice standard paths — a new migration that UPDATEs the DB rows is required.

### Blast radius (all `issuer-logo` nodes)
**TS source** (render source for SO standard; authoring/fallback source + clone shape for quote/invoice):
- `packages/billing/src/lib/quote-template-ast/standardTemplates.ts:39, 241, 439, 669`
- `packages/billing/src/lib/invoice-template-ast/standardTemplates.ts:188, 518, 692`
- `packages/billing/src/lib/sales-order-template-ast/standardTemplates.ts:39`
- `packages/billing/src/lib/sales-order-template-ast/otherDocuments.ts:34`

**DB rows** (render-authoritative for quote/invoice standards):
- `standard_quote_document_templates` — seeded by `20260320103000` (default `:47`, detailed `:135`), `20260416120000` (by-location `:84`), `20260402100000` (grouped `:55`)
- `standard_invoice_templates` — seeded by `20260217133000` (detailed `:187`), `20260416120100` (by-location `:85`), `20260402100000` (grouped `:170`)

**Seed migration files that inline the node** (edit is **optional** — see below): **five** files —
- `20260320103000` (default `:47`, detailed `:135` → quote table)
- `20260416120000` (by-location `:84` → quote table)
- `20260402100000` (grouped `:55` → quote table; `:170` → invoice table)
- `20260217133000` (detailed `:187` → invoice table)
- `20260416120100` (by-location `:85` → invoice table)

On a **fresh install** these seeds run first, then the new 2026-07-23 patch migration runs *after* them and patches the rows anyway — so editing the seed files is not required for correctness, only for source-of-truth hygiene. **Decision:** either edit all five seeds for hygiene, or skip them and rely on migration ordering. (Recommend skipping them to keep the change small; the patch migration is the single source of the fix for both fresh and existing installs.)

### Fix
Add to the `issuer-logo` node's `style.inline`:
```js
objectFit: 'contain',
objectPosition: 'left',   // left-align the letterboxed logo under the left-aligned brand text
```
`contain` letterboxes the logo inside the 180×72 box preserving aspect ratio (square 256×256 → 72×72). `objectPosition: 'left'` keeps it flush-left instead of centered in the 180px slot (matches the left-aligned `issuer-name`/`issuer-address` below it). *(objectPosition is a judgment call — flag for review; `contain` alone is the ticket-requested minimum.)*

Steps:
1. **Edit all 9 TS `issuer-logo` nodes** (above) to add the two keys. Fixes SO standard renders immediately and corrects the clone/fallback source for quote+invoice.
2. **New data migration** `server/migrations/<ts>_add_object_fit_to_issuer_logo_templates.cjs`:
   - **Standard tables** (`standard_quote_document_templates`, `standard_invoice_templates`) — these are **global** (not tenant-scoped), so a plain `select` then per-row `update` by `template_id` is fine.
   - Recursive JS walker: for each node with `id === 'issuer-logo'` that has a `style.inline`, set `objectFit: 'contain'` and `objectPosition: 'left'` **only if `objectFit` is not already present** (idempotent, additive — never overwrites an author's existing `objectFit`). Variant-agnostic: handles default/detailed/grouped/by-location without re-inlining full ASTs.
   - **JSONB discipline** (per CLAUDE.md): `templateAst` comes back **already parsed** — do **not** `JSON.parse` it. Write back with `.update({ templateAst: JSON.stringify(patched) })` (the column is quoted camelCase `"templateAst"`; knex jsonb handling also works).
   - **`down()` = no-op** (data patch; safe and preferred). Rationale: an additive patch cannot reliably distinguish keys it added from keys an author already had, so reverting risks stripping legitimate values. (If a reversible down is required, restrict it to the two standard tables and delete only values exactly equal to `'contain'`/`'left'`.)
3. **Seed `.cjs` files:** skip (recommended) — the patch migration covers fresh installs via ordering. Optionally edit all five for hygiene (see blast-radius list).
4. **SO/other TS:** the TS edit in step 1 is the render source; no migration needed (no standard SO DB table).

### Decision point — tenant-customized templates
`quote_document_templates`, `invoice_templates`, `document_templates` may also carry the squashing node (cloned from the same shape; invoice customs normalized by `20260217134000`). The same additive walker can patch them, but these are **tenant-scoped, CitusDB-distributed** tables:
- ⚠️ **Every WHERE clause must include `tenant`**; update **row-by-row** with params (`UPDATE … WHERE tenant = ? AND <pk> = ?`) — never a tenant-less bulk update, never column-reference updates (CitusDB rule).
- Same additive/idempotent guard and no-op `down()`.

**Recommendation:** ship the standard-table patch as the core fix; treat custom-table patching as an **opt-in** extension in the same migration (guarded, tenant-scoped). Low risk since additive, but it touches customer-modified data, so call it out at review time.

### Notes / limitations
- No user-visible data loss; purely a rendering style addition.
- `contain` centers vertically within 72px by default — fine for a top-aligned brand block. If tall logos should top-align, add `objectPosition: 'left top'` instead of `'left'`.

---

## Ticket 2 — alga0002162: uploader crops wide raster logos

### Root cause
All entity images (avatars **and** logos) are resized server-side in `StorageService.uploadFile` with a fixed **square cover crop**:

```js
// packages/storage/src/StorageService.ts:148-154  (and server/src/lib/storage/StorageService.ts:142-148)
processedBuffer = await sharp(fileBuffer)
  .resize(256, 256, { fit: 'cover', withoutEnlargement: true })
  .webp({ quality: 85 })
  .toBuffer();
```

For a 1200×253 PNG: `cover` would need to **enlarge** to reach 256px height, but `withoutEnlargement: true` clamps scale to 1, so `cover` center-crops each axis to `min(target, actual)` → width `min(256,1200)=256`, height `min(256,253)=253`. Result: a **256×253 center-crop**, chopping the wordmark to the first 256px. Matches the QA-observed `naturalWidth/naturalHeight = 256×253`.

SVGs bypass this entirely (`isSvg` branch stores bytes as-is, `StorageService.ts:127-134`), which is why an SVG wordmark passes through intact — hence the inconsistency.

### Why the flag isn't available today
- The UI (`packages/ui/src/components/EntityImageUpload.tsx`) ships the raw file — no client processing.
- `uploadEntityImage(entityType, entityId, file, userId, tenant, contextName?, isLogoUpload?)` **knows** whether it's a logo (`isLogoUpload`), but only uses it for the `is_entity_logo` document flag — it is **not** forwarded to `StorageService.uploadFile` (`packages/storage/src/entityImageService.ts:200-210` passes only `isImageAvatar: true`).
- `metadata.context` is unreliable as a logo signal: client-logo passes `contextName = undefined` → context `client_image`; tenant-logo passes `tenant_logo`. Neither matches the `client_logo` string in StorageService's context list. `isImageAvatar: true` is what actually triggers the resize for both.

### Fix
Differentiate logos (aspect-preserving) from avatars (square crop is desirable for circular avatar frames):

1. **Forward the logo signal** — add an option to `StorageService.uploadFile`'s options type, e.g. `isEntityLogo?: boolean`. In `uploadEntityImage` (`packages/storage/src/entityImageService.ts:200-210`), pass `isEntityLogo: isLogoUpload || false` alongside `isImageAvatar: true`.
2. **Branch the resize** in `StorageService.uploadFile`. Introduce a named constant `LOGO_MAX_DIMENSION = 1024` (crisper wide wordmarks at negligible size cost) and keep webp quality consistent with the avatar path (85) unless we deliberately want higher for logos:
   ```js
   if (isSvg) {
     // unchanged — pass through
   } else if (options.isEntityLogo) {
     processedBuffer = await sharp(fileBuffer)
       .resize(LOGO_MAX_DIMENSION, LOGO_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })  // preserve aspect ratio, never crop, never enlarge
       .webp({ quality: 85 })
       .toBuffer();
   } else {
     processedBuffer = await sharp(fileBuffer)
       .resize(256, 256, { fit: 'cover', withoutEnlargement: true })   // avatars stay square
       .webp({ quality: 85 })
       .toBuffer();
   }
   ```
   `fit: 'inside'` scales the whole image to fit within the box preserving aspect ratio: 1200×253 → 1024×216, wordmark intact. (Precedent: document preview generator already uses `fit: 'inside'`.)
3. **Update copies** — the entity-image path runs through `packages/storage/src/StorageService.ts` (via `@alga-psa/storage`), so that is the **live** file to fix. Apply the **same image-processing block** to `server/src/lib/storage/StorageService.ts` for defense-in-depth (the two files already diverge outside the processing block — e.g. the server copy's `getCurrentUser()` — so "keep the processing block identical", not the whole file). The server copy is realistically dead for the entity-image path (no server-side caller passes a matching `isImageAvatar`/context), but keep them aligned to prevent drift.
4. **Third `uploadEntityImage` copy** — `packages/documents/src/lib/entityImageService.ts` has a parallel `uploadEntityImage` that also drops `isLogoUpload` and only passes `isImageAvatar: true` (`:107-115`). It is exported via `@alga-psa/documents/runtime` but has **no live logo caller** today (all live callers use `@alga-psa/storage`). Patch it identically **or** deprecate/remove it so it can't regress later. (Low priority.)
5. **Rebuild** the affected packages after editing `src` (consumers import from `dist/`): `npx nx build storage` (and `nx build documents` if patched), or `npm run build:shared`.

### Box-size note
`1024×1024 inside` gives crisp wide wordmarks (a 180px template box → ~5.7× density) at small file cost; `512` is also acceptable if size matters more. Captured as the `LOGO_MAX_DIMENSION` constant so it's a one-line tune.

### Limitation
Existing logos were already cropped on upload — those pixels are gone. No data migration can recover them; affected tenants must **re-upload**. This fix corrects all future uploads. Call this out in the ticket resolution.

---

## Ticket 3 — alga0002163: "Convert to Both" unreachable on accepted quotes

### Root cause
In `packages/billing/src/components/billing-dashboard/quotes/QuoteForm.tsx`:

- `isReadOnly = isEditMode && !isTemplate && quoteStatus !== 'draft'` (`:941`) → **any accepted quote is read-only**.
- `resolvePrimaryAction()` for `accepted` returns the richest applicable conversion as the **primary** action: `quote-form-convert-both` when `canConvertToBoth` (`:1042-1049`), else contract, else invoice.
- The primary button renders only when `primaryAction && !isReadOnly` (`:1270`) → **hidden** for accepted quotes.
- `resolveOverflowItems()` for `accepted` pushes all applicable conversions, then **de-duplicates against the primary**: `return items.filter((i) => i.id !== primaryAction?.id)` (`:1128`) — removing "Convert to Both" as a "duplicate" of a button that was never drawn.

Net: for an accepted quote with both recurring and one-time lines, "Convert to Both" appears in **neither** the primary slot (hidden by `isReadOnly`) **nor** the overflow (filtered out). Verified live (Q-0009, 2 recurring + 1 one-time): overflow offered only "Convert to Contract" and "Convert to Invoice".

**This is broader than "Both":** the dedup removes whichever conversion is chosen as primary. An accepted quote with **only recurring** lines → primary = convert-contract → overflow becomes empty → *no* conversion is reachable at all. The bug is a general accepted-quote conversion-reachability defect; "Both" is just the headline case.

### Fix (recommended — Option A, minimal & correct)
Only strip the primary from the overflow when the primary button is actually rendered.

```js
// after `const primaryAction = resolvePrimaryAction();`  (~:1081)
const isPrimaryActionVisible = Boolean(primaryAction) && !isReadOnly;

// :1128
return items.filter((i) => !isPrimaryActionVisible || i.id !== primaryAction?.id);
```

Result: for accepted (read-only) quotes the primary isn't drawn, so nothing is filtered — every applicable conversion (both/contract/invoice/sales-order) shows in the "More actions" (⋮) menu and is reachable. When the primary *is* drawn (draft, etc.), dedup still prevents duplicates. Both `primaryAction` and `isReadOnly` are already in scope at the overflow site. Low blast radius, no behavior change for non-read-only states.

Note: within the `accepted` branch specifically, `isPrimaryActionVisible` is always false (accepted ⇒ `isReadOnly`), so the filter is effectively a no-op there — the change is safe defensive code that also correctly covers any future status that populates both a primary and overflow items. The primary button gate is duplicated at the footer (`QuoteForm.tsx:1601`); it shares the same `!isReadOnly` condition and needs no change (awareness only).

### Optional (Option B — UX enhancement, flag for evaluator)
Conversion is arguably the *primary* thing you do to an accepted quote, so burying it in the overflow is suboptimal. Optionally render the conversion primary as a visible button even when read-only (the read-only notice is about *editing content*, not converting). This is a more visible change; recommend shipping Option A first, consider B as a follow-up.

### Out of scope — related dead paths noted on the ticket (candidate sibling tickets)
- **Same-class hidden-primary defect on other statuses:** the `!isReadOnly` gate (`:1270`/`:1601`) hides the primary for *every* non-draft status. `sent` → "Revise" and `rejected`/`expired` → "Create new revision" also have no overflow fallback in the form. Lower severity than conversions (send/resend/revise are reachable from the quotes list, `QuotesTab.tsx:159-184`), but worth a sibling ticket. The Option A fix does not resurrect these (they have no overflow item to un-filter); Option B or a "if primary hidden by read-only, append to overflow" approach would.
- `prepareOpportunityWinConversions` supports `convert_quote_id`, but `OpportunityDetailHost.tsx:427` never sends it → "Mark won" on an opportunity does not convert its linked quote.
- Three conversion UIs; only `QuoteForm.tsx` overflow is reachable from the quotes list. `QuoteDetail.tsx` convert actions are only imported by `QuoteApprovalDashboard.tsx`; `QuoteConversionDialog.tsx` is orphaned (nothing imports it).

These are not required to fix the reported bug; list them for triage rather than fixing here.

---

## Testing
- **2161:** Unit — extend `standardTemplates.test.ts` / `react-renderer.test.tsx` to assert `issuer-logo` inline style includes `objectFit: 'contain'`. Migration — assert seeded standard rows' `templateAst` contains the key after up(). Manual — preview a quote/invoice with a square (256×256) logo → letterboxed, not squashed.
- **2162:** Unit — a StorageService test uploading a 1200×253 raster with `isEntityLogo: true` asserts output preserves aspect ratio (width > height, no 256×253 crop); avatar path still yields 256×256. SVG path unchanged. Manual — re-upload a wide PNG client/tenant logo → full wordmark retained.
- **2163:** Unit/RTL on `QuoteForm` — accepted quote with both line types renders a reachable "Convert to Both" in the overflow; accepted quote with only recurring renders a reachable "Convert to Contract". Manual — repro Q-0009.

## Rollout / sequencing
1. Ship **2163** independently (pure UI, zero data/infra risk).
2. Ship **2161** TS edits + data migration together (migration is additive/idempotent).
3. Ship **2162** StorageService branch + package rebuild; note existing logos need re-upload.

## Implementation status (2026-07-23)

Shipped (uncommitted, on `main` working tree):

- **2161** — Added `objectFit: 'contain'` + `objectPosition: 'left'` to all **9** `issuer-logo` TS nodes (quote ×4, invoice ×3, sales-order standard ×1, packing-slip/pick-list ×1). Added data migration `server/migrations/20260723180000_add_object_fit_to_issuer_logo_templates.cjs` (surgical/additive/idempotent walker over `standard_quote_document_templates` + `standard_invoice_templates`; no-op `down()`). **Sales orders need no migration** — they render straight from the TS constants, so the code edit fully fixes them. Regression tests added to all three template `standardTemplates.test.ts` suites asserting every `issuer-logo` node carries the fix (15/15 pass).
- **2162** — Added `isEntityLogo` to `StorageService.uploadFile` options and forwarded `isLogoUpload` from `uploadEntityImage`. Logos now resize with `fit: 'inside'` at `LOGO_MAX_DIMENSION = 1024` (aspect-preserving, never crops); avatars keep the `256×256 cover` crop. Applied to **both** StorageService copies (`packages/storage/src` + `server/src/lib/storage`). Existing logos must be re-uploaded (cropped pixels are unrecoverable). The third `packages/documents` `uploadEntityImage` copy was left as-is (no live logo caller) — flagged as follow-up.
- **2163** — `QuoteForm.tsx`: added `isPrimaryActionVisible = Boolean(primaryAction) && !isReadOnly` and changed the overflow dedup to `(i) => !isPrimaryActionVisible || i.id !== primaryAction?.id`. Accepted-quote conversions (Both/Contract/Invoice) are now reachable via the ⋮ menu.

Verified: `@alga-psa/storage` and `@alga-psa/billing` build clean; storage suite 6/6; template suites 15/15. Not committed (per repo convention). No automated tests added for 2162 (needs sharp/provider mocking) or 2163 (needs full-component RTL harness) — both covered by manual verification steps above.

### Related dead paths (2163 notes) — also handled

- **Opportunity "Mark won" → quote conversion:** the backend (`prepareOpportunityWinConversions`, tested + API-exposed via `OpportunityService`) supported `convert_quote_id`, but `OpportunityDetailHost.tsx` never sent it. Wired an **opt-in** selector into the Win dialog: when the opportunity has accepted linked quotes, the user may pick one to convert to a draft agreement on win (defaults to "Do not convert"). `tsc` clean; opportunities suite 28/28.
- **Three conversion UIs:** confirmed only `QuoteConversionDialog.tsx` was truly orphaned (git shows it as the oldest/superseded impl); `QuoteDetail`'s inline convert is reachable via Quote Approvals. **Deleted** `QuoteConversionDialog.tsx` (406 LOC) and removed the i18n test block that read it. Its `quoteConversion.*` locale keys are **kept** — `QuoteDetail.tsx` still uses them. billing i18n + quoteDetail suites 25/25.

## Build/deploy reminders
- `packages/billing` and `packages/storage` edits require a package rebuild (`npm run build:shared` / `npx nx build <pkg>`) because consumers import from `dist/`.
- New migration runs via `npm run migrate` (CE). It targets **global** standard tables (`standard_quote_document_templates`, `standard_invoice_templates`), plus optionally tenant-custom tables per the decision point.
