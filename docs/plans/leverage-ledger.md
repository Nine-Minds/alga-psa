# Leverage ledger

Cross-cutting leverage candidates (no single home for an inline marker, or a
cluster of inline markers worth tracking together). See the `leverage` skill.

## hero-portal-bridge — friction

- **What:** `QboSyncHealthPanel` (billing pkg) is slot-injected *below* `PanelHero`
  (integrations pkg), but the design needs the panel's attention strip + "last
  synced" suffix to render *inside* the hero. React composition only flows down,
  so the child teleports content upward via `useLayoutEffect` + `getElementById`
  + `createPortal` into two empty mount nodes the hero leaves behind
  (`#qbo-sync-attention-mount`, `#qbo-hero-sync-suffix`). The layout wants
  child→ancestor flow; the slot model won't give it, so the wiring re-derives
  composition through the global DOM.
- **Where:** portal source `packages/billing/.../QboSyncHealthPanel.tsx`
  (`useIsoLayoutEffect` + the two `createPortal` calls, the `attnMount`/`suffixMount`
  state, the SSR `useIsoLayoutEffect` shim); sink nodes
  `packages/integrations/.../QboIntegrationSettings.tsx` (`extra` div + subtitle span).
- **Gate:** frequency 1 (single bridge, 2 mount points) · cost **high**
  (global-id coupling across packages, SSR shim, render-after-mount flicker, two
  components silently coupled by string ids) · stability: design just landed,
  may still move · leverage: real — same "feature panel owns data that belongs
  in a shared hero" shape will recur for Xero and any other accounting provider.
- **Direction:** the components are right; the *injection* is wrong. Options:
  (a) hoist the health data fetch up to the page and pass `attentionStrip` /
  `syncSuffix` into `PanelHero` as real props/slots; (b) give `PanelHero` named
  render-slots and have the page compose them. Either dissolves the portal.
- **Axis 2:** cross-package, touches the slot contract → **promote-to-plan**.
  Not an in-pass change.
- **Status:** watching (markers dropped 2026-06-18).

## section-primitives-home — friction + pattern

- **What:** `GroupHeader` in `QboSyncHealthPanel` is a verbatim re-implementation
  of `SettingsGroup`'s header (same `text-[11px] font-semibold uppercase
  tracking-[0.09em]` over a `border-b pb-[9px]` hairline). It exists only because
  the billing panel can't import the integrations primitive
  (`no-feature-to-feature-imports`). The shared layout primitives (`StatusBanner`,
  `PanelHero`, `SettingsGroup`) currently live in the integrations *feature*
  package, so any other feature that wants the same look must copy it.
- **Where:** `packages/billing/.../QboSyncHealthPanel.tsx` (`GroupHeader`);
  `packages/integrations/.../accountingSectionPrimitives.tsx` (`SettingsGroup`).
- **Gate:** frequency 2 (will be 3+ once Xero/health panels want the same group
  header) · cost low-ish per site but **correctness-of-look** drift risk (two
  copies of the same hairline spec) · stability: spec is simple and settled ·
  leverage: real — a shared section/group/banner primitive in `@alga-psa/ui`
  serves every settings surface, not just accounting.
- **Direction:** move `StatusBanner` / `PanelHero` / `SettingsGroup` into
  `@alga-psa/ui/components` (the UI kit has no section/group/banner primitive
  today — confirmed), delete `GroupHeader`, import the shared one.
- **Axis 2:** new shared component + cross-package import change →
  **bounded-now or promote-to-plan** (small, but crosses the package line).
- **Status:** watching (markers dropped 2026-06-18).

## status-tone-classes — pattern

- **What:** repeated hand-rolled "tone → tailwind color classes" maps. At least
  four parallel ladders: `HERO_CHIP`/`HERO_DOT` (primitives), `connectionTone`
  derivation (QboIntegrationSettings), `attnSurface`/`attnText`/`attnStrong`/
  `bigColor` + `metricToneClass` (QboSyncHealthPanel). Each re-derives semantic
  status colors from literal `red/amber/emerald/sky` classes.
- **Where:** `accountingSectionPrimitives.tsx`, `QboIntegrationSettings.tsx`,
  `QboSyncHealthPanel.tsx`.
- **Gate:** frequency 3+ (saturated) · cost low per site · stability settled ·
  leverage moderate — a semantic-tone token (`tone="error|warn|ok|info"` →
  surface/text/dot classes) would centralize the palette, but the brake is low
  cost. Frequency saturates; do **not** let the count alone force extraction.
- **Direction:** a single `toneClasses(tone)` helper or token map, ideally
  alongside the shared primitives if those move to the UI kit.
- **Axis 2:** in-pass-able *once* the primitives have a shared home; otherwise
  bundle with `section-primitives-home`.
- **Status:** watching — **do not extract on frequency alone** (low cost/leverage
  brake). Fold into the primitives move if/when that happens.

## tailwind-arbitrary-scale — friction (light)

- **What:** the redesign hand-tunes off-scale pixel values to make rows line up
  — `text-[11px]`, `text-[13px]`, `text-[17px]`, `text-[22px]`, `pb-[9px]`,
  `px-[22px]`, `py-[13px]`, `mr-[26px]`, `pr-[26px]`, `mt-[18px]`,
  `tracking-[0.09em]`. Each bypasses the Tailwind type/spacing scale because the
  scale's steps don't land where the design wants.
- **Where:** the three touched files above.
- **Gate:** frequency high but **cost low / leverage low** — cosmetic. This is
  the classic "big count, low cost" case: frequency saturates and must not drive
  action.
- **Status:** rejected-for-now — note only. Revisit only if a real type/spacing
  scale gets defined in the UI kit; not worth chasing per-file.
