# Focus-view roast — consensus synthesis (2026-07-02)

Method: adversarial-design-iteration skill. Eight critics — four tab-group generalists
(records / money / service / install) + four cross-tab lenses (Intent, LowEffort, Voice,
Gap) — reviewed the 12 rail views from live screenshots + component source. Findings below
are ranked by independent agreement; ✓ = claim re-verified in code by the lead session.
Full critic reports: session scratchpad `roast/`.

## S-tier: systemic (3–5 critics each, independently)

S1. **Drawer column-fit drops the load-bearing columns** (5 critics ✓). computeColumnFit
admits columns in declaration order, so at drawer width: Tickets hides 6 incl. Assigned To
+ Due Date (dispatcher's columns) with a live h-scrollbar; Assets hides Status/Location/
Purchase/Warranty End while a dead "Details: No details available" column keeps slot 4;
Equipment hides the Asset deep-link (the tab's point) while an all-"—" MAC column stays;
Billing Dashboard hides Status. Meanwhile Interactions caps itself at max-w-2xl and
Notes/Tax/Additional-Info float in half the 92vw canvas — starving tables AND wasting
width. Fix: curated per-drawer column sets (or explicit widths/priorities — width-bearing
columns are prioritized, dataTableColumnFit.ts:173-175) + kill the max-w caps + wrap the
toolbars.

S2. **FocusViewHost supplies no visual contract** (4 critics). The `bg-white p-6 rounded-lg
shadow-sm` wrapper is hand-pasted on 9 registry entries, lives inside the leaf on
Equipment, is absent on Details/Assets, and double-frames Billing Dashboard/Tax Settings.
Three tabs re-print the drawer title inside themselves at three different type tokens.
Fix: host owns surface + title; tabs render content, never chrome.

S3. **Save-model chaos with silent data loss** (3 critics ✓). Details mixes instant-save
(domains/aliases) with batched save; `hasUnsavedChanges` exists (ClientDetails.tsx:225)
but drawer close never checks it ✓ — edit account manager, add a domain, close: the domain
sticks, the edit vanishes. Tax Settings has three persistence models in one small form:
Tax Exempt auto-saves (TaxSettingsForm.tsx:131), Reverse Charge is local-until-Save
(:184) ✓, certificate has its own Save. Billing's "Save Billing Configuration" saves only
the top form while sibling sections self-save. Notes' ghost Save is always-enabled with no
dirty state. Fix: close-guard on dirty state + one save model per view + one Save variant.

S4. **Drawer views restate the pulse cards instead of going deeper** (3 critics). Details
is ~70% Record+Locations card content; Contacts adds no column beyond the People card
(missing role/primary/portal — the fields that would justify opening it); Interactions
shows *less* per row than the timeline (its query already selects ticket_id, contact name,
agent, duration — all dropped); Billing Dashboard leads by re-listing invoices the Money
card already shows. Principle: the focus view earns its slot by depth the card can't hold.

S5. **In-context actions that throw away the client context** (3 critics). Contacts "Edit"
router.pushes to /msp/contacts/{id} while ContactDetailsEdit sits imported-but-unused;
Tickets "Add Ticket" routes to /msp/create-ticket while the card's quick-add stays in
place; Asset Tag hard-links away while row-click opens in-context; Equipment SO numbers
all link to the global list (styled as deep links); Tax Settings help-link hard-navigates.
Fix: in-context drawers/dialogs everywhere; plain text where no in-context target exists.

## Broken/misleading — individual, all verified ✓

B1. **Billing Dashboard totals are 100× inflated** — ClientContractLineDashboard.tsx:83
`formatCurrency(cents)`; `formatCurrencyFromMinorUnits` exists (formatters.ts:25). Found
independently by lead + money critic. Also currency_code commented out of the query.
B2. **Notes "Last updated:" renders no date** — locale string clients.json:1041 lacks
`{{value}}`; i18next drops the interpolation. 30-second fix; 5 critics saw the symptom.
B3. **Errors relabeled as empty** — Billing Dashboard 4× catch{console.error}+TODO;
Equipment 3× `.catch(() => [])`; Assets loadData swallow → stat cards show 0 on failure.
B4. **Parent Client free-text** writes properties.parent_client_name while
parent_client_id is a real schema field ✓; ClientPicker exists in the kit.
B5. **Last Contact Date** is a hand-typed text input contradicting the interactions the
system records; DatePicker exists — but the honest fix is derive-read-only (or drop).
B6. **Payment Terms has two disagreeing editors** — Billing General (select, "Net 30") vs
Additional Info (blank text input).
B7. **The shared client note leaks into Documents** (clientNoteActions.ts:214 creates a
document_association) — appears as a deletable card + inflates the Documents pulse count;
deleting it would nuke Notes.
B8. **SLA column can never be shown in the client Tickets tab** — preset defaults sla:false
(ticketDisplaySettings.ts:53,77 ✓) and "Show all" only reveals space-hidden columns, not
never-built ones — while the attention strip flags overdue. calculateSlaStatus already
exists.
B9. **Billing Dashboard "Last 30 Days" is hardcoded** — 3 TODO comments for a
DateRangePicker the kit already ships; heading and empty-state disagree ("selected period").
B10. **Assets "Maintenance Rate 50%" hardcoded success-green** regardless of value —
asserts a judgment the data doesn't support.

## Grounded gaps (GapCritic; each cites existing capability)

Tier 1 (breaks the tab's job):
- Billing Dashboard: no AR balance/aging strip (FinancialService.getAccountBalanceReport +
  getAgingReport already compute it); Recent Invoices has no balance-due/status column
  (fetchInvoicesByClient returns credit_applied; getInvoicePaymentStatus exists).
- Equipment: warranty_expires_at exists per unit + expiringWarrantyReport, but
  listClientEquipment doesn't select it → **this is ops-depth W4, pre-scouted**.
- Contacts: portal-access status per contact already computable (getPortalInvitations,
  getUserByContactId) — absent from the list.

Tier 2: Tickets header has no open-count/SLA-health (totalCount returned then dropped,
MspClientTickets.tsx:154; slaReportingActions are clientId-filterable → **positive signal
for ops-depth W1's feasibility gate**); Details SLA is a picker with no live performance;
Equipment RMA dead-unit-owed liability invisible (deadUnitsOwedReport exists); Assets
overdue-maintenance stat is a dead-end number (no filter/link); Billing Contracts sub-tab
shows names only (getContractDetails returns type/rate/qty).

Tier 3: Contacts search + Role column; Interactions row enrichment (ticket chip, contact,
agent, duration — already selected); bucket overage + period window; loaner units filtered
out (status='delivered' hard-filter); Documents search/type-filter supported by the
component but not wired (ClientDetails.tsx:1369-1378); Billing credit_limit held in state,
never rendered.

GapCritic scope notes honored: Assets *does* define warranty columns (S1 clipping, not
absence); asset→unit provenance exists on the asset detail page. Tax Settings and Notes:
no grounded gaps.

## Voice sweep (one batch)

Install-base concept has 4 names (rail group / Assets / "Asset Inventory" retitle /
Equipment-inside-Equipment); sentence-vs-Title case drifts within single screens; create
verbs drift (Add Ticket / Add New Contact / New Document → "Add [noun]"); Save has 3
labels; "Reverse Charge Applicable" vs "Apply Reverse Charge" for the same toggle;
ID-column label drift (6 spellings); Pagination hardcodes "N items total" → "1 items";
engine vocab in UI ("Precedence: Contact override -> …", "Bucket Usage", "Create Next
Cycle", "drives invoice windows"); "6 columns hidden due to limited space" over-explains;
"Notes & Quick Info" (also in Contact/Asset panels); Assets subtitle "Manage and track all
client assets" is filler; Documents' three equal buttons ("New Document / Upload File /
Link Documents" → "Add document / Upload file / Link existing").

## Craft batch (LowEffort, cheap + code-cited)

Equipment tab: zero i18n; `render:(v:any)` ×15; 3 pasted bare "Loading…" `<p>`s (Assets
next door uses Spinner; kit has Skeleton). Billing Dashboard: 4 recharts `as any` casts +
dead commented state. Additional Info Save hand-rolls the primary variant minus dark-mode
classes (ClientDetails.tsx:1461). Interactions: leftover console.log (:220). Details:
literal "Add"/"Remove" skip t(). Pattern called out: older tabs are polished; effort
dropped in the two newest surfaces (Equipment tab, Billing Dashboard) and Additional Info.

## Declines & proposals (the critics advise, they don't decide)

- **Retire the Interactions tab** — declined: it's the only Add-Interaction + search
  surface; the accepted fix is depth (S4), not deletion.
- **Fold Tax Settings into Billing / flatten Billing sub-tabs into the rail / consolidate
  the four tax surfaces** — real, but structural nav redesign → proposal, not iteration.
- **Merge Additional Info into Details ("Profile")** — attractive (5 orphan fields), but
  tangled with the shared editedClient buffer → proposal alongside S3 work.
- **Rename/demote Billing Dashboard to "Usage & Utilization"** — park until the AR strip
  lands; the tab may earn its current name once it answers "what's owed".
- **Assets drawer-in-drawer** — functional via nested-dialog support; cost outweighs harm.
- **Reverse Charge demotion for USD clients** — accepted as polish, low priority.
- **CSAT collapse + record-card de-plumb** — already ops-depth W5; not duplicated here.

## Proposed iteration order (one change, verified, committed — per skill)

1. B1 cents fix → 2. B2 locale fix → 3. S3a drawer-close dirty guard → 4. S3b Tax Settings
single save model → 5. B3 error states (equipment + dashboard + assets) → 6. B4/B5
Additional Info pickers (parent → ClientPicker/FK; last-contact → derived read-only) →
7. S5a Contacts in-context edit → 8. S1 column curation (tickets dispatcher preset incl.
sla:true, equipment, assets, dashboard) → 9. S1b width reclaim (max-w caps, toolbars) →
10. S2 host-owned chrome → 11. Voice sweep → 12. Craft batch → 13. Gap fills tier 1
(sequenced with ops-depth W1/W2/W4 to avoid double-building).
