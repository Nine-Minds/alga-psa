# White-label round 2 — rectangular logo, collapsed rail, attribution, favicon

Enterprise-only follow-up to the MSP white-label work. Open `mockups.html` in a browser
(no build step, no server) to review the design; `mockups.png` is a rendered copy of the
same file for anyone reading this in a diff.

## What the feedback asked for

1. The logo upload effectively demanded a square image. MSPs want a **rectangular logo with
   their name in it**, the way their own website header looks.
2. That breaks the 4rem collapsed rail, so we probably need **both** a square and a wide asset.
3. When a tenant white-labels the app, put **“Powered by AlgaPSA”** at the bottom of the menu,
   next to the version number — a tiny Alga mark plus `AlgaPSA v1.x.x`.
4. Allow replacing the **favicon** too.

## What the design commits to

| # | Decision | Why |
|---|---|---|
| a | **Wide logo is optional**, square mark stays the single required asset | The collapsed rail, the browser tab and every circular frame need a square image. Requiring both would block tenants who only have a wordmark; making wide optional means the worst case is today's behavior. |
| b | **“Powered by AlgaPSA” only while white-labeled** | An un-branded tenant already reads “AlgaPSA” at the top of the rail; a second line is noise. Once the tenant's own mark is up there, the attribution is the only place our name appears. |
| c | **GitHub star button hides while white-labeled** | It links to `Nine-Minds/alga-psa` with our star count. On an MSP-branded rail shown to their staff that is the one control that gives the game away, and it sits in exactly the row the attribution now occupies. It comes straight back when white-labeling is switched off. |
| d | **Favicon covers the MSP app and the client portal; the portal sidebar wide logo is out of scope** | The favicon is per-tenant metadata, so both surfaces should follow it for free. The portal sidebar has its own 32×32 circle and its own branding contract — worth a separate round rather than a drive-by. |

### Rail behavior

* **Expanded (16rem)** — a wide logo, when present, renders at `h-8` with natural width,
  `object-contain`, no circular frame **and no duplicate name span** (the name is inside the image).
  Without a wide logo the rail keeps today's square mark + name text.
* **Collapsed (4rem)** — always the square mark in its circle. The wide logo is never rendered here.
* **Dark-first per slot** — the rail is dark in both themes, so it prefers `wide-dark` → `wide`, and
  `dark` → `default` for the square mark, exactly like the existing logic.
* **Fallback chain** — a broken wide-logo URL falls back to the square mark, which falls back to the
  stock Alga avatar. Each `<img>` keeps its own `onError` latch.

### Footer attribution

Sits under the existing release-notes version link inside the same bordered block: the tiny Alga
mark plus “Powered by AlgaPSA”, linking to the release notes. The version stays in the link above
rather than being printed twice; the tooltip carries `Powered by AlgaPSA v1.5.0`. The collapsed rail
shows the mark alone with that same tooltip. “Powered by AlgaPSA” stays untranslated brand text; the
surrounding label/help copy gets i18n keys.

### Settings card

* The two existing slots are renamed **Square mark** / **Square mark for dark backgrounds**.
* Two new optional **Wide logo** slots (light + dark) and one **Favicon** slot.
* No logo slot previews through the cover-cropping avatar any more. The square marks keep a round
  frame — that is what the rail renders — but *contain* the image instead of cropping it; the wide
  and favicon slots preview in a **rectangular frame**, so a wordmark is no longer shown squeezed
  into a circle it will never actually be squeezed into.
* A client-side dimension read warns when a near-square image lands in a wide slot (and a wide image
  in a square slot). Warning only — it never blocks the upload.

### Storage

* New logo variants ride the existing `entity_logo_variant` column: `wide`, `wide-dark`, `favicon`.
  Branding JSON is schemaless, so no migration — `logoWideUrl`, `logoWideDarkUrl`, `faviconUrl`
  join `logoUrl` / `logoDarkUrl` under `tenant_settings.settings.branding`.
* Favicon uploads take a separate processing branch: raster input is resized to 32×32 PNG (browsers
  accept PNG favicons), SVG is stored as-is, ICO is passed through untouched.
* CE strips the Enterprise-only fields in `scopeBrandingToEdition`, so an edition downgrade cannot
  keep a wide logo or a custom favicon alive.

## Open questions for review

* Should the attribution also appear in the **client portal** sidebar of a white-labeled tenant?
  The card only mentions the menu section of the MSP app, so this round leaves the portal alone.
* Is hiding the GitHub star button acceptable, or should white-labeled tenants still see it?
* Do we want a size ceiling on the wide logo's rendered width (currently `max-w-full` inside the
  16rem rail, which lets a very wide wordmark shrink itself to fit)?
