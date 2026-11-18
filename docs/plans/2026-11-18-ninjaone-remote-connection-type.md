# NinjaOne Remote as a built-in remote connection type

Card: `53997ad8` — "NinjaOne Remote as a built-in remote connection type for NinjaOne-synced assets"
PSA ticket: `alga-2026-0002761` (Managed Nerds)
Step: Design Session (conn, delegated desk) → next step: Link Spec to PSA Ticket
Author: XO, 2026-11-18

## 1. Problem, stated correctly

The card reports one symptom: NinjaOne Remote links are dropped, so an asset whose NinjaOne device
publishes a NinjaOne Remote link shows only Splashtop / TeamViewer / VNC / RDP / shell.

The ticket-level reading of that symptom ("add a missing enum member") is wrong, or at best
transient. The defect is structural: **the set of connection types an RMM provider may offer is
hard-coded in seven places, and every one of them is a closed union or literal array.** NinjaOne
Remote is simply the first provider type that exposed it. Any future provider type — Datto's
Web Remote variants, Tactical's newer session kinds, NinjaOne's own additions — hits the same wall.

Measured duplication today (current `main`):

| # | Site | Shape |
|---|---|---|
| 1 | `packages/integrations/src/lib/rmm/assetDeviceActions.ts:8` | canonical union `RmmRemoteConnectionType` |
| 2 | `packages/integrations/src/lib/rmm/tacticalrmm/assetDeviceActions.ts:26-49` | literal pushes + allowlist in `remoteControlUrl` |
| 3 | `ee/server/src/lib/integrations/ninjaone/assetDeviceActions.ts:6-12` | `REMOTE_CONTROL_TYPES` filter |
| 4 | `ee/server/src/lib/integrations/ninjaone/ninjaOneClient.ts:871` | `linkType` union on `getDeviceLink` |
| 5 | `ee/server/src/lib/integrations/datto/assetDeviceActions.ts:141-153` | reuses the `'splashtop'` slot |
| 6 | `packages/assets/src/context/AssetCrossFeatureContext.tsx:43` | duplicate union `AssetRemoteConnectionType` |
| 7 | `packages/assets/src/components/RemoteAccessButton.tsx:24-33` | `ninjaOneTypes` + `providerTypes` candidate arrays + label switch |
| 8 | `ee/server/src/interfaces/rmm.interfaces.ts:368` | duplicate `connection_type` union |
| 9 | `server/src/app/api/v1/assets/[id]/rmm/remote-control/route.ts:26-31` | unvalidated `as` cast of the `type` query param |
| 10 | `server/public/locales/*/msp/assets.json` | per-type label keys, no generic fallback |

Sites 1–8 are the same fact written eight times. Adding `'ninjaone_remote'` to all of them would
"work" for exactly as long as NinjaOne's link type matches the string we guessed — and the card
itself records that no teammate could confirm the string or the endpoint against a live tenant
(PR #3789 note). A design that depends on a guessed string is not shippable with confidence.

## 2. Decisions

### D1 — The provider declares the type space; core declares only presentation

New module `packages/integrations/src/lib/rmm/connectionTypes.ts` is the single source of truth:

- `RMM_KNOWN_CONNECTION_TYPES` — a const tuple of *known* ids with presentation metadata:
  `{ id, labelKey, icon, order, aliases }`. Members: `splashtop`, `teamviewer`, `vnc`, `rdp`,
  `shell`, and `ninjaone_remote`.
- `KnownRmmRemoteConnectionType` = element union; `RmmRemoteConnectionType` **widens** to
  `KnownRmmRemoteConnectionType | (string & {})` so a provider may return a type we have no
  metadata for.
- `normalizeRmmConnectionType(raw)` — lower-case, trim, collapse space/dash to `_`, then map through
  the alias table (`ninjaone`, `ninjaone_remote`, `ninjaoneremote` → `ninjaone_remote`). Unknown
  values are returned normalized, not rejected.
- `describeRmmConnectionType(id)` → `{ labelKey?, fallbackLabel, icon, order }`, so callers never
  switch on the union.
- `parseRmmConnectionType(raw)` → `string | null`, the boundary validator (D5).

This makes the acceptance criterion independent of NinjaOne's exact type string: whatever
`/v2/device/{id}/links` returns, the adapter normalizes it, the UI shows it, and opening it uses the
URL the provider supplied for that exact link.

### D2 — Adapters stop filtering; they normalize

- `ee/server/src/lib/integrations/ninjaone/assetDeviceActions.ts`: delete `REMOTE_CONTROL_TYPES`
  and `isRemoteControlType`. `remoteControlTypes` maps every returned link through
  `normalizeRmmConnectionType`, de-duplicates, and preserves provider order. `remoteControlUrl`
  matches on `normalizeRmmConnectionType(link.type) === normalizeRmmConnectionType(connectionType)`
  instead of raw lowercase equality.
- `packages/integrations/src/lib/rmm/tacticalrmm/assetDeviceActions.ts`: same treatment — its
  allowlist in `remoteControlUrl` (`:49`) becomes a lookup of the URLs it already has
  (`control`/`terminal`), keeping today's output identical.
- `ee/server/src/lib/integrations/datto/assetDeviceActions.ts`: unchanged behaviour; it legitimately
  reuses the `splashtop` slot for its Web Remote and documents why at `:135`. D3 makes that an
  explicit presentation choice rather than a hack.

### D3 — One union, re-exported

Delete the duplicates at `AssetCrossFeatureContext.tsx:43` and `rmm.interfaces.ts:368`; both
re-export the canonical type from `@alga-psa/integrations`. `AssetRemoteConnectionType` stays as an
alias export so existing imports keep compiling, but there is exactly one definition.

### D4 — The UI derives from the registry

`packages/assets/src/components/RemoteAccessButton.tsx`:
- delete `ninjaOneTypes` and the per-provider candidate arrays; candidates become
  `rmmConnectionTypesForProvider(provider)` (a thin per-provider ordering hint, defaulting to "all").
  The server action already returns only types that provider actually publishes, so the client list
  is a presentation detail, never a gate.
- label via `describeRmmConnectionType`, icon by `icon` from the registry, order by `order`.
- a type with no `labelKey` renders `fallbackLabel` (humanized id) and gets
  `remoteAccess.connectionTypes.generic` ("Remote session") when the id is unhumanizable.
- add `remoteAccess.connectionTypes.ninjaoneRemote` = "NinjaOne Remote" and
  `remoteAccess.connectionTypes.generic` to `server/public/locales/en/msp/assets.json`; other
  locales inherit the en fallback, and their missing keys are a translation task, not a blocker.

### D5 — Validate at the boundary

`server/src/app/api/v1/assets/[id]/rmm/remote-control/route.ts:26-31` currently casts an arbitrary
`?type=` to the union, so any string reaches the adapter. Parse it with
`parseRmmConnectionType`; on failure return `400 { error: 'Invalid remote control type' }`. This is
also the reason the route's docblock union must be replaced by a reference to the registry.

### D6 — Generated surfaces follow the tuple

`ee/server/src/chat/registry/apiRegistry.generated.ts:9854-9864` publishes the enum for the chat/API
registry. Regenerate from the canonical tuple (or, if the generator cannot read it, hand-edit and
leave a `// generated from connectionTypes.ts` marker). Note it in the PR body so it is not missed on
a future regeneration.

### Non-goals (deliberate)

- No live-tenant verification is a prerequisite to ship. The passthrough makes the guess unnecessary;
  a tenant is still wanted for a follow-up confirmation, and that check belongs on the PSA ticket, not
  in the loop.
- No changes to the `{asset.rmm_device_id}` / `{asset.rmm_provider}` / `{asset.rmm_organization_id}`
  template placeholders (#3789, #3791).
- No new NinjaOne endpoints, no dashboard-URL probing.
- Splashtop / TeamViewer / VNC / RDP / shell and Tactical / Datto output stays byte-identical; their
  existing tests are the guard.

## 3. Work groups

**F1 — registry (no behaviour change).** `connectionTypes.ts` + `connectionTypes.test.ts`: alias
normalization, unknown passthrough, `describe` fallbacks, `parse` rejection. Land alone.

**F2 — adapters normalize.** NinjaOne + Tactical adapters (D1/D2); extend
`ee/server/src/__tests__/unit/integrations/ninjaOneRemoteControl.test.ts` with a fixture link
`{ type: 'NINJAONE_REMOTE', url }` → type surfaces as `ninjaone_remote`, URL resolves by exact link
match; plus a dedupe/order case and an unknown-type passthrough case.

**F3 — one union.** Delete duplicates, re-export (D3); fix any exhaustive switches the compiler
finds.

**F4 — UI.** `RemoteAccessButton` (D4) + locale keys; extend
`RemoteAccessButton.test.tsx`: unknown type renders the generic label and opens its URL; NinjaOne
Remote renders "NinjaOne Remote" with the monitor icon.

**F5 — boundary + generated.** Route validation (D5) with a 400 test; chat registry (D6).

**F6 — ride-along fix.** `RemoteAccessLinksManager.tsx:164` help text: `us2 .ninjarmm.com` → a clean
region list (`app, eu, ca, oc, us2`), and confirm the example path matches the documented
`/v2/device/{id}/dashboard-url` shape from #3789.

## 4. Verification

- `vitest` for `packages/integrations`, `packages/assets`, `ee/server` unit suites named above.
- `tsc --noEmit` where the repo already runs it (integrations, assets, ee server).
- Manual: asset with a NinjaOne device still lists its existing types; an asset with no NinjaOne
  links shows no NinjaOne entry; a fixture tenant is not required to demonstrate the logic, only the
  real-world string.

## 5. Risks

1. **Unknown types surface where they used to be hidden.** Intended: the provider is authoritative.
   Mitigation: generic label + provider-returned URL only; no client-side fabrication.
2. **`rmm.interfaces.ts:368` widening.** It is an EE-internal declaration; the compiler will name any
   exhaustive switch that needs a default. Do that rather than narrowing again.
3. **i18n drift.** A missing `connectionTypes.*` key today renders a raw key; D4's fallback removes
   that class of bug permanently.
4. **Generated registry churn.** D6 keeps the enum generated from the tuple; if regeneration is not
   wired, the hand-edit must carry the marker.

## 6. Acceptance criteria mapping

- "NinjaOne Remote option appears and opens" → D1 passthrough + D2 URL match + D4 presentation,
  proven by the F2/F4 tests without needing the exact provider string.
- "Existing Splashtop/TeamViewer/VNC/RDP/shell behaviour unchanged" → D2 keeps Tactical/Datto
  outputs and the NinjaOne known types identical; existing suites must pass untouched.
