# Design — Path to Maintenance View

Card: `dc597814-5c7a-4b02-bd18-ce3be8abe8d6` · Branch: `feature/path-to-maintenance-view`

Two changes ship together:

1. **Menu wiring** — surface the maintenance command center by turning the single "Assets" nav leaf into a dropdown with **All Assets** and **Maintenance** children.
2. **Bug fix** — the "New maintenance plan" control on the maintenance screen hard-navigates to `/msp/assets` instead of opening a create-plan dialog.

Both screens already exist and render. This work is navigation + one interaction fix; no new data model, server action, or route is introduced.

---

## Part 1 — Assets dropdown in the left nav

### Current state
`server/src/config/menuConfig.ts:178-183` — Assets is a plain link:

```ts
{ name: 'Assets', translationKey: 'nav.assets', icon: Monitor, href: '/msp/assets' },
```

The renderer (`server/src/components/layout/SidebarMenuItem.tsx`) already treats any `MenuItem` carrying `subItems` as an expandable dropdown and renders each child via `SidebarSubMenuItem.tsx`. The `MenuItem` type is recursive (`server/src/config/menuConfig.ts:70-86`), so no renderer or type change is needed — the existing "Documents" entry (`:169-177`) is the exact pattern to mirror.

### Change
Replace the leaf with a dropdown parent (drop the top-level `href`, add `subItems`):

```ts
{
  name: 'Assets',
  translationKey: 'nav.assets',
  icon: Monitor,
  subItems: [
    { name: 'All Assets',   translationKey: 'nav.assetsAll',         icon: Monitor, href: '/msp/assets' },
    { name: 'Maintenance',  translationKey: 'nav.assetsMaintenance', icon: Wrench,  href: '/msp/assets/maintenance' },
  ],
},
```

### Hierarchy delivered
- **Assets** — dropdown (no direct route; expands to reveal children)
  - **All Assets** → `/msp/assets` (existing dashboard, unchanged)
  - **Maintenance** → `/msp/assets/maintenance` (existing `MaintenanceCommandCenter`, already live)

### Supporting edits
- **Icon import** — add `Wrench` to the `lucide-react` import block in `menuConfig.ts` (top block, lines ~5-62). `Monitor` is already imported and is reused for "All Assets".
- **i18n keys** — add `nav.assetsAll` and `nav.assetsMaintenance` alongside the existing `nav.assets`/`nav.documentsAll` keys in the locale files (nav falls back to `name`, but keys are added for consistency with every other nav entry).
- **i18n route namespaces** — `packages/core/src/lib/i18n/config.ts:200` registers namespaces for `/msp/assets` (`['common', 'msp/core', 'msp/assets']`). Add a matching `'/msp/assets/maintenance'` entry with the same namespaces so the maintenance page's translations (`useTranslation('msp/assets')`) resolve on direct load/refresh.

### Out of scope / non-goals
- No change to feature-gating or editions — Assets carries no `requiredFeature`; children inherit the same visibility.
- No reordering of other nav sections.

---

## Part 2 — Fix "New maintenance plan" (opens dialog, not a redirect)

### The bug
`packages/assets/src/components/MaintenanceCommandCenter.tsx:144` — the affordance is a `<Link href="/msp/assets">`, not a button:

```tsx
<Link id="maintenance-new-plan-link" href="/msp/assets" title="Plans are created from an asset's Maintenance tab" …><Plus …/>New maintenance plan</Link>
```

Clicking it leaves the maintenance screen and lands on the assets list. There is no dialog wired to it. The `title` attribute documents the current workaround ("Plans are created from an asset's Maintenance tab").

### Root cause
`CreateMaintenanceScheduleDialog` (`packages/assets/src/components/tabs/CreateMaintenanceScheduleDialog.tsx:23-29`) **requires an `assetId`** — schedules are asset-scoped:

```ts
interface CreateMaintenanceScheduleDialogProps {
  isOpen: boolean; onClose: () => void;
  assetId: string;                        // required
  schedule?: AssetMaintenanceSchedule;    // undefined = create
  onSuccess: () => void;
}
```

The command center header spans **all** clients/assets and has no single asset in context, so the original author punted to the assets list rather than pass a bogus `assetId`. The correct, working reference for the dialog is `MaintenanceSchedulesTab.tsx` (button → `setShowDialog(true)` → dialog with a concrete `assetId`).

### Chosen approach — asset-select step, then the existing dialog
Reuse the existing `CreateMaintenanceScheduleDialog` unchanged; supply the missing `assetId` with a lightweight asset picker in the command center. This keeps the create-plan logic in one place and satisfies the dialog's contract honestly.

Flow:
1. Replace the `<Link>` with a real `<Button id="maintenance-new-plan-btn" onClick={() => setNewPlanOpen(true)}>` (same `Plus` icon + "New maintenance plan" label; drop the misleading `title`).
2. Add state: `const [newPlanOpen, setNewPlanOpen] = useState(false)` and `const [newPlanAssetId, setNewPlanAssetId] = useState<string | null>(null)`.
3. On open, show an **asset selector** (backed by the existing `listAssets` action, `packages/assets/src/actions/assetActions.ts:1887`; the same picker pattern used by `AssociatedAssets.tsx`). Selecting an asset sets `newPlanAssetId`.
4. Render `<CreateMaintenanceScheduleDialog isOpen={Boolean(newPlanAssetId)} assetId={newPlanAssetId} schedule={undefined} onClose={…reset…} onSuccess={refresh} />`.
5. On success call the existing `refresh()` (`MaintenanceCommandCenter.tsx:116`) so the new plan's occurrences flow into the queue.

Selection + create can be one dialog (picker at top, disabled submit until an asset is chosen) or a two-step picker → form. Exact UX is a build-time detail; the contract above is fixed.

### Why not the alternatives
- **Change the dialog to make `assetId` optional** — rejected: every other caller (`MaintenanceSchedulesTab`) legitimately has an asset; loosening the contract pushes "which asset?" validation into the shared dialog and its server action. The command center is the odd caller, so it owns supplying the asset.
- **Keep the redirect but deep-link into an asset's Maintenance tab** — rejected: still leaves the command center; the card explicitly asks for a dialog on this screen.

### Acceptance
- Clicking "New maintenance plan" on `/msp/assets/maintenance` opens a dialog and the URL does **not** change to `/msp/assets`.
- Choosing an asset and saving creates a schedule via the existing `createMaintenanceSchedule` action and the queue refreshes to show its occurrences.
- The per-asset flow in `MaintenanceSchedulesTab` is unaffected.

---

## Files touched (summary)
| File | Change |
|---|---|
| `server/src/config/menuConfig.ts` | Assets leaf → dropdown w/ subItems; add `Wrench` import |
| locale nav files | add `nav.assetsAll`, `nav.assetsMaintenance` |
| `packages/core/src/lib/i18n/config.ts` | register `/msp/assets/maintenance` namespaces |
| `packages/assets/src/components/MaintenanceCommandCenter.tsx` | `<Link>` → `<Button>` + asset-select + `CreateMaintenanceScheduleDialog` wiring |

No new routes, server actions, DB migrations, or edition gates.
