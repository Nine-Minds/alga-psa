# PRD — MSP i18n Batches 2b-10/11/12/16: Clients, Contacts, Assets, Onboarding

- Slug: `2026-03-20-msp-i18n-clients-assets-onboarding`
- Date: `2026-03-20`
- Status: Draft

## Summary

Translate four high-priority MSP feature areas that were missing from the original translation plan:

| Batch | Namespace | Est. Strings | Files | Package |
|-------|-----------|-------------|-------|---------|
| 2b-10 | `msp/clients` | ~1,000-2,100 | 31 | `packages/clients/src/components/clients/` (+panels/) |
| 2b-11 | `msp/contacts` | ~550-1,150 | 12 | `packages/clients/src/components/contacts/` |
| 2b-12 | `msp/assets` | ~1,200-2,400 | 41 | `packages/assets/src/components/` |
| 2b-16 | `msp/onboarding` | ~600-1,200 | 8 | `packages/onboarding/src/components/steps/` + OnboardingWizard.tsx |
| **Total** | | **~3,350-6,850** | **92** | |

> **Note on estimates:** String counts are from automated scan using ~0.2 strings/LOC ratio. Previous batches showed this overestimates by ~1.5-2x. The lower bound is the more realistic target. Exact counts will be determined during implementation by reading each file.

> **Onboarding scope:** Only the wizard steps (TicketingConfigStep, BillingSetupStep, TeamMembersStep, ClientInfoStep, AddClientStep, ClientContactStep) and OnboardingWizard.tsx. The dashboard onboarding section (DashboardOnboardingSection, OnboardingChecklist) was already translated in batch 2b-2.

## Problem

Clients, contacts, and assets are the three most-used MSP features — operators interact with them daily. The onboarding wizard is the first experience for new tenants. All four areas display entirely English UI regardless of user locale preference.

## Goals

1. Create 4 new namespaces: `msp/clients.json`, `msp/contacts.json`, `msp/assets.json`, `msp/onboarding.json`
2. Wire all ~92 component files with `useTranslation()`
3. Generate translations for 7 languages + 2 pseudo-locales (36 new locale files)
4. Register namespaces in `ROUTE_NAMESPACES`
5. Zero regressions with `msp-i18n-enabled` flag OFF

## Non-goals

- Translating client-portal views of clients/contacts/assets (those are in `features/*.json`)
- Translating the already-done dashboard onboarding section
- Translating server-side actions or API responses
- Refactoring component architecture

## Users and Primary Flows

**Primary user**: MSP operators managing their client base and assets.

**Flows**:
- Clients: list clients, create/edit, manage locations, billing configuration, tax settings, contract assignment
- Contacts: list contacts, create/edit, phone numbers, portal access, import
- Assets: asset dashboard, create/edit, detail view, maintenance schedules, RMM integration, software inventory
- Onboarding: multi-step wizard for new tenant setup (client info → contacts → team members → ticketing → billing)

## UX / UI Notes

- Client and contact forms have many fields — German translations may overflow in side-by-side label/input layouts
- Asset dashboard has metric cards and status badges — verify badge text doesn't truncate
- Onboarding wizard TicketingConfigStep (3,040 LOC) is the single largest file — ~600 estimated strings, likely 300-400 after reading carefully. Now includes board-scoped status configuration.
- Import dialogs (ClientsImportDialog, ContactsImportDialog) have CSV column mapping labels — these should be translated

## Requirements

### Batch 2b-10: msp/clients (~1,000-2,100 strings, 31 files)

**Largest components:**

| Component | LOC | Est. Strings | Key content |
|-----------|-----|-------------|-------------|
| ClientDetails.tsx | 1,805 | ~150-320 | Detail view, all sections, action menus |
| Clients.tsx | 1,503 | ~140-280 | Client listing, filters, grid/list views |
| QuickAddClient.tsx | 1,140 | ~100-210 | Quick-add form, all fields |
| ClientLocations.tsx | 1,038 | ~100-195 | Location management, address fields |
| BillingConfiguration.tsx | 701 | ~70-135 | Billing setup, payment terms (updated: assignment-explicit semantics) |
| ClientsImportDialog.tsx | 697 | ~75-150 | CSV import, column mapping |
| ClientBillingSchedule.tsx | 504 | ~50-100 | Billing schedule (updated: grew from ~387 LOC, billing mode decoupling) |
| ClientContractAssignment.tsx | 423 | ~45-85 | Contract assignment UI (updated: refactored for explicit assignments) |
| ClientContractLineDashboard.tsx | 426 | ~40-80 | Contract line overview |
| ContractLines.tsx | 203 | ~20-40 | Contract lines display (updated: +55 LOC) |
| Remaining 21 files | ~4,200 | ~250-505 | Tax settings, service overlap, credit settings, grid cards, notes panel, etc. |

### Batch 2b-11: msp/contacts (~550-1,150 strings, 12 files)

| Component | LOC | Est. Strings | Key content |
|-----------|-----|-------------|-------------|
| ContactDetails.tsx | 985 | ~120-245 | Contact detail view, tabs |
| Contacts.tsx | 917 | ~110-220 | Contact listing, filters |
| ContactsImportDialog.tsx | 824 | ~90-185 | CSV import, column mapping |
| ContactPhoneNumbersEditor.tsx | 755 | ~75-155 | Phone number CRUD |
| ContactPortalTab.tsx | 652 | ~80-160 | Portal access configuration |
| QuickAddContact.tsx | 621 | ~75-155 | Quick-add form |
| Remaining 6 files | ~1,400 | ~90-210 | ContactDetailsEdit, ContactDetailsView, ClientContactsList, ContactsLayout, ContactAvatarUpload, ContactsSkeleton |

### Batch 2b-12: msp/assets (~1,200-2,400 strings, 41 files)

| Component | LOC | Est. Strings | Key content |
|-----------|-----|-------------|-------------|
| AssetForm.tsx | 1,247 | ~170-340 | Full asset form, all fields |
| AssetDashboardClient.tsx | 1,170 | ~140-280 | Asset dashboard, grid view |
| AssetDetailDrawerClient.tsx | 685 | ~90-175 | Drawer detail view |
| AssetDetails.tsx | 653 | ~160-320 | Full detail page |
| AssociatedAssets.tsx | 647 | ~70-140 | Related assets management |
| QuickAddAsset.tsx | 587 | ~80-165 | Quick-add form |
| CreateTicketFromAssetButton.tsx | 285 | ~30-60 | Create ticket from asset (updated: board-scoped statuses) |
| Remaining 34 files | ~4,378 | ~360-720 | Tabs (maintenance, software, service history, audit log, documents), panels (info, RMM, hardware, security, notes), status badges, metric banners, command palette |

### Batch 2b-16: msp/onboarding (~600-1,200 strings, 8 files)

> Excludes already-translated dashboard components (DashboardOnboardingSection, OnboardingChecklist).

| Component | LOC | Est. Strings | Key content |
|-----------|-----|-------------|-------------|
| steps/TicketingConfigStep.tsx | 3,040 | ~300-600 | Ticketing setup: boards, statuses, priorities, categories, SLA (updated: +120 LOC for board-scoped status configuration) |
| steps/BillingSetupStep.tsx | 610 | ~80-165 | Billing configuration step (updated: +28 LOC, billing mode decoupled from service type) |
| OnboardingWizard.tsx | 508 | ~45-85 | Wizard shell, step navigation |
| steps/TeamMembersStep.tsx | 429 | ~55-110 | Team member invitation |
| steps/ClientInfoStep.tsx | 286 | ~45-85 | Client information form |
| steps/AddClientStep.tsx | 213 | ~30-60 | Add client step |
| steps/ClientContactStep.tsx | 123 | ~20-40 | Contact creation step |
| OnboardingProvider.tsx | 75 | ~8-15 | Provider context strings |

### ROUTE_NAMESPACES updates

```typescript
'/msp/clients': ['common', 'msp/core', 'msp/clients'],
'/msp/contacts': ['common', 'msp/core', 'msp/contacts'],
'/msp/assets': ['common', 'msp/core', 'msp/assets'],
'/msp/onboarding': ['common', 'msp/core', 'msp/onboarding'],
```

### Non-functional Requirements

- Follow naming convention from translation-guide.md
- All `t()` calls use `{ defaultValue: '...' }` for English fallback
- Feature flag `msp-i18n-enabled` OFF = forced English
- Import dialog column labels should be translated (CSV headers stay in English, but the mapping UI labels are translated)

## Rollout / Migration

- Behind `msp-i18n-enabled` feature flag
- No database changes
- Sub-batches can be merged independently

## Open Questions

1. **Client vs shared namespace**: Some client/contact components may be rendered in the client portal too. Need to check if any strings should go in `features/contacts.json` (shared) rather than `msp/contacts.json`.
2. **Asset EE components**: Are there EE-only asset components that need separate handling?
3. **TicketingConfigStep size**: At 2,920 LOC, this is larger than most entire batches. May need to be its own sub-feature within the onboarding namespace.

## Acceptance Criteria

### Per batch
- [ ] English namespace JSON created with all keys
- [ ] All component files wired with `useTranslation('<namespace>')`
- [ ] All 7 production locale files created
- [ ] Pseudo-locale files created (xx, yy)
- [ ] Italian accent audit passes
- [ ] `validate-translations.cjs` passes

### Cross-cutting
- [ ] `ROUTE_NAMESPACES` updated for all 4 routes
- [ ] `msp-i18n-enabled` OFF: English text, no regressions
- [ ] `msp-i18n-enabled` ON + locale `xx`: clients, contacts, assets, onboarding all show `11111`
- [ ] German translations don't overflow in client/contact forms, asset dashboard metrics, onboarding wizard
- [ ] Billing terminology consistent with `msp/contracts` and `msp/invoicing` namespaces (post contract-simplification refactor)
- [ ] `npm run build` succeeds
