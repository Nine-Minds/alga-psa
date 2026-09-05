# White-label round 2 — rectangular logo, collapsed rail, attribution, favicon

Enterprise-only follow-up to the MSP white-label work. The static `mockups.html` /
`mockups.png` pair that carried this design through review was a local artifact and is not
committed: it had already drifted twice from the shipped UI inside one round, and a
hand-maintained copy of a screen that exists for real is a second source of truth nobody
updates. The rules it illustrated are written out below, and the app itself is the picture.

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
| c | **GitHub star button stays, white-labeled or not** | The first cut hid it, on the theory that a link to `Nine-Minds/alga-psa` gives the game away on an MSP-branded rail. Review overruled that: the attribution row already says “Powered by AlgaPSA” one line below, so hiding the star buys no discretion and only costs us stars. It sits beside the version link exactly as before. |
| d | **The wide logo covers the client portal side panel too, and the favicon covers both shells** | The favicon is per-tenant metadata, so both surfaces follow it for free. The portal panel was going to be a later round, but the same wordmark, the same slots and the same “name is already in the image” rule apply there, so it ships together. |

### Rail behavior

* **Expanded (16rem)** — a wide logo, when present, renders at `h-8` with natural width,
  `object-contain`, no circular frame **and no duplicate name span** (the name is inside the image).
  Without a wide logo the rail keeps today's square mark + name text.
* **Collapsed (4rem)** — always the square mark in its circle. The wide logo is never rendered here.
* **Variant follows the rail's own background** — every shipped theme paints a dark rail, so the
  usual order is `wide-dark` → `wide` and `dark` → `default`. But a custom theme can set a light
  `sidebarBg` (the editor exposes “Side panel background” per mode), and on a light rail that order
  is exactly backwards. The rail therefore measures the colour it actually painted
  (`getComputedStyle` → WCAG relative luminance) and flips to `wide` → `wide-dark` /
  `default` → `dark` when it comes out light. An unreadable colour keeps the dark-first order.
  Muted rail chrome — the mark's frame, section headings, the version and attribution rows — uses
  the `sidebar-text` token for the same reason.
* **Fallback chain** — a broken wide-logo URL falls back to the square mark, which falls back to the
  stock Alga avatar. Each `<img>` keeps its own `onError` latch.

### Client portal side panel

The same three rules, on the surface a client actually sees. The expanded panel wears the wordmark
at `h-8` and then prints the company name **nowhere** — neither in the brand row beside the mark nor
in the “Organization” row underneath, both of which were saying the same thing the image now says.
Collapsed, it is the square mark again. The panel measures its own colour through the same hook the
MSP rail uses, which matters more here: a portal admin can hand-pick the side-panel colour outright,
and a pale pick makes the dark-background artwork the wrong one. Its section headings and dividers
moved onto `sidebar-text` for the same reason. The wide slots appear in **Settings → Client Portal →
Branding** only in Enterprise, next to the square ones — the storage is shared with the MSP card, so
uploading in one place fills both.

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

* Should “Powered by AlgaPSA” also appear in the **client portal** side panel? The portal now wears
  the wide logo, but the attribution stays MSP-only: the portal is the tenant's shop window to their
  own clients, and the card only asked for the menu section of the MSP app.
* Do we want a size ceiling on the wide logo's rendered width (currently `max-w-full` inside the
  16rem rail, which lets a very wide wordmark shrink itself to fit)?
