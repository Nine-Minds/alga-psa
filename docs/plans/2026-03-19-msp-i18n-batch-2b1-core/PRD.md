# PRD — MSP i18n Batches 2b-1 + 2b-2: Core Namespace + Dashboard

- Slug: `2026-03-19-msp-i18n-batch-2b1-core`
- Date: `2026-03-19`
- Status: Draft

## Summary

Extract all hardcoded English strings from two areas:

1. **MSP portal shell (msp/core)** — navigation sidebar, header bar, quick-create menu, job indicator, trial/payment banners, AI chat sidebar, and confirmation dialogs (~80 new keys, added to existing 72 keys)
2. **MSP dashboard (msp/dashboard)** — welcome banners, feature cards, onboarding checklist, step definitions, progress indicators (~110 keys, new namespace)

Wire up all components with `useTranslation()`, generate translations for all 7 languages + 2 pseudo-locales, and validate with visual QA.

**Total scope: ~190 new keys across 17 files.**

## Problem

The MSP portal shell (sidebar, header, breadcrumbs, banners, quick-create) and dashboard display ~190 hardcoded English strings that are not yet translatable. The shell is visible on **every** MSP page; the dashboard is the first page users see after login. Together they are the highest-impact untranslated surfaces. Users with non-English locale preferences see a mix of translated page content and English chrome.

## Goals

1. Extract all user-visible hardcoded strings from MSP shell components into `msp/core.json`
2. Create `msp/dashboard.json` namespace with all dashboard strings
3. Wire all components to consume translations via `useTranslation()`
4. Make `menuConfig.ts` translation-aware so sidebar nav items and section titles use translated labels
5. Generate accurate translations for all 7 production languages (en, fr, es, de, nl, it, pl)
6. Update pseudo-locale files (xx, yy) to cover new keys
7. Register `/msp` and `/msp/dashboard` routes in `ROUTE_NAMESPACES` to load `msp/dashboard`
8. Zero regressions — everything works identically with `msp-i18n-enabled` flag OFF (forced English)

## Non-goals

- Translating strings inside child components rendered by QuickCreateDialog (QuickAddTicket, QuickAddClient, etc.) — those belong to their respective feature namespaces
- Translating the Enterprise Edition RightSidebar chat UI — that's in `@enterprise/components`
- Adding new languages beyond the existing 7
- Changing the namespace structure or route mappings (beyond adding dashboard)
- Translating the GitHub star button (external widget, not our text)
- Refactoring menuConfig.ts to a different data structure

## Users and Primary Flows

**Primary user**: MSP portal operators who have set a non-English locale preference.

**Flow**: User logs in → sees sidebar, header, breadcrumbs, banners, quick-create menu all in their preferred language instead of hardcoded English.

## UX / UI Notes

- No visual changes — all strings appear in the same locations, just translated
- German/Dutch translations are typically 30-50% longer than English — verify no layout overflow in sidebar (collapsed tooltip), header breadcrumbs, banner badges, dropdown menus, and dashboard feature cards
- The sidebar collapsed state shows tooltips — these must also be translated
- Tab labels in settings sidebar sections are already covered by existing `settings.sections.*` and `settings.tabs.*` keys — verify they're consumed, not hardcoded
- Dashboard onboarding cards have progress rings with text like "3 of 5 Steps" — verify interpolation works in all languages
- Dashboard feature card descriptions are long sentences — verify no truncation in German/Dutch

## Requirements

### Functional Requirements

#### FR1: menuConfig.ts — Translation-aware menu data

The menu config currently exports hardcoded English `name` and `title` strings. Two approaches (choose one):

**Option A (Recommended): Add translation keys to MenuItem, translate in Sidebar**
- Add a `translationKey` field to `MenuItem` and `NavigationSection`
- Keep `name` as the English fallback / stable identifier
- In Sidebar.tsx, use `t(item.translationKey) || item.name` for display
- Avoids making menuConfig.ts depend on React hooks

**Option B: Translate at config level**
- Create a `useTranslatedMenuConfig()` hook that returns translated copies
- More encapsulated but requires all consumers to be React components

#### FR2: Sidebar.tsx — Translated labels

| String | Key |
|--------|-----|
| "Go to dashboard" (aria-label) | `sidebar.goToDashboard` |
| "AlgaPSA" (logo text) | Keep hardcoded (brand name) |
| "AlgaPSA Logo" (alt text) | `sidebar.logoAlt` |
| "Back to Main" (button + tooltip, 2 occurrences) | Already exists: `sidebar.backToMain` |
| "Expand sidebar" | `sidebar.expandSidebar` |
| "Collapse sidebar" | `sidebar.collapseSidebar` |

Sidebar already renders `item.name` from menuConfig — once FR1 is done, these will be translated.

#### FR3: Header.tsx — Quick Create menu

| String | Key |
|--------|-----|
| "Open quick create" (aria-label) | `header.quickCreate.ariaLabel` |
| "Quick Create" (button text) | `header.quickCreate.title` |
| "Create" (dropdown header) | `header.quickCreate.heading` |
| 7x option labels (Ticket, Client, Contact, Project, Asset, Service, Product) | `header.quickCreate.options.<type>.label` |
| 7x option descriptions | `header.quickCreate.options.<type>.description` |

#### FR4: Header.tsx — Job Activity Indicator

| String | Key |
|--------|-----|
| "View background job activity" (aria-label) | `header.jobs.ariaLabel` |
| "Background Jobs" | `header.jobs.title` |
| "Track imports, automation runs, and scheduled work." | `header.jobs.description` |
| "Active jobs" | `header.jobs.active` |
| "Queued jobs" | `header.jobs.queued` |
| "Failed last 24h" | `header.jobs.failedLast24h` |
| "Open Job Center" | `header.jobs.openJobCenter` |

#### FR5: Header.tsx — Breadcrumb and User Menu

| String | Key |
|--------|-----|
| "Home" (breadcrumb root) | `header.breadcrumb.home` |
| "Dashboard" (breadcrumb fallback) | `header.breadcrumb.dashboard` |
| `Active tenant ${tenant}` (aria-label) | `header.tenantBadge.ariaLabel` |
| "Open user menu" (aria-label) | Already covered by existing header keys |
| "User" (fallback name) | Already exists: `header.userFallback` |
| "Quick access to profile & account." | Already exists: `header.quickAccess` |
| "Profile" | Already exists: `header.profile` |
| "Account" | Already exists: `header.account` |
| "Sign out" | Already exists: `header.signOut` |

#### FR6: DefaultLayout.tsx — AI Chat Confirmation Dialogs

| String | Key |
|--------|-----|
| "Leave page and cancel AI response?" | `dialogs.aiInterrupt.navigate.title` |
| "An AI response or tool action is still in progress. Leaving this page now will cancel it." | `dialogs.aiInterrupt.navigate.message` |
| "Leave page" | `dialogs.aiInterrupt.navigate.confirm` |
| "Stay on page" | `dialogs.aiInterrupt.navigate.cancel` |
| "Close chat and cancel AI response?" | `dialogs.aiInterrupt.closeChat.title` |
| "An AI response or tool action is still in progress. Closing the chat now will cancel it." | `dialogs.aiInterrupt.closeChat.message` |
| "Close chat" | `dialogs.aiInterrupt.closeChat.confirm` |
| "Keep chat open" | `dialogs.aiInterrupt.closeChat.cancel` |

#### FR7: TrialBanner.tsx — Trial status messages

| String | Key |
|--------|-----|
| "Premium confirmed — starts next billing cycle" | `banners.trial.premiumConfirmed` |
| "1 day left" | `banners.trial.dayLeft` |
| "{{count}} days left" | `banners.trial.daysLeft` |
| "Premium Trial: {{daysLabel}} — confirm to keep" | `banners.trial.premiumTrial` |
| "{{tier}} Trial: {{daysLabel}}" | `banners.trial.stripeTrial` |

#### FR8: PaymentFailedBanner.tsx

| String | Key |
|--------|-----|
| "Payment failed — Update payment method" | `banners.paymentFailed.message` |
| "Failed to open billing portal" | `banners.paymentFailed.portalError` |

#### FR9: QuickCreateDialog.tsx — Success messages and dialog titles

| String | Key |
|--------|-----|
| "Asset created successfully" | `quickCreate.success.asset` |
| `Ticket #{{number}} created successfully` | `quickCreate.success.ticket` |
| `Client "{{name}}" created successfully` | `quickCreate.success.client` |
| `{{name}} added successfully` | `quickCreate.success.contact` |
| `Project "{{name}}" created successfully` | `quickCreate.success.project` |
| "Service created successfully" | `quickCreate.success.service` |
| "Product created successfully" | `quickCreate.success.product` |
| "Failed to load clients" | `quickCreate.errors.loadClients` |
| "Failed to load service types" | `quickCreate.errors.loadServiceTypes` |
| "Add New Contact" (dialog title) | `quickCreate.dialogTitles.contact` |
| "Add New Project" (dialog title) | `quickCreate.dialogTitles.project` |
| "Add New Service" (dialog title) | `quickCreate.dialogTitles.service` |

#### FR10: RightSidebar.tsx — CE fallback text

| String | Key |
|--------|-----|
| "Chat" | `rightSidebar.title` |
| "The chat feature is only available in the Enterprise Edition." | `rightSidebar.enterpriseOnly` |

#### FR11: PlatformNotificationBanner.tsx

| String | Key |
|--------|-----|
| "Learn More" | `banners.platformNotification.learnMore` |
| "Dismiss notification" (aria-label) | `banners.platformNotification.dismiss` |

#### FR12: Billing sidebar navigation

The billing navigation sections in menuConfig.ts have section titles and item names that need translation keys:

| String | Key |
|--------|-----|
| Section: "Contracts" | `nav.billing.sections.contracts` |
| Section: "Invoicing" | `nav.billing.sections.invoicing` |
| Section: "Pricing" | `nav.billing.sections.pricing` |
| Section: "Tracking & Reports" | `nav.billing.sections.trackingReports` |
| Items: "Contract Templates", "Client Contracts", "Contract Line Presets", "Invoicing", "Invoice Templates", "Billing Cycles", "Service Catalog", "Products", "Tax Rates", "Usage Tracking", "Reports", "Accounting Exports" | `nav.billing.<camelCase>` |

#### FR13: Settings/Extensions sidebar items

| String | Key |
|--------|-----|
| "Language" (settings nav, only shown when i18n flag is on) | `settings.tabs.language` |
| "SLA" (settings nav) | `settings.tabs.sla` |
| "Settings" (extensions sidebar label) | Already exists: `sidebar.settings` |

#### FR14: DashboardContainer.tsx — Welcome banners and feature cards

**Welcome banners (namespace: `msp/dashboard`):**

| String | Key |
|--------|-----|
| "Welcome to Your MSP Command Center" | `welcome.title` |
| "Track onboarding progress, configure critical services..." | `welcome.description` |
| "Welcome back" | `welcome.titleCommunity` |
| "Jump into tickets, scheduling, projects, and reporting..." | `welcome.descriptionCommunity` |

**Feature cards:**

| String | Key |
|--------|-----|
| "Platform Features" | `features.heading` |
| "Ticket Management" | `features.tickets.title` |
| "Streamline support with routing, SLA tracking..." | `features.tickets.description` |
| "System Monitoring" | `features.monitoring.title` |
| "Watch critical signals across clients..." | `features.monitoring.description` |
| "Security Management" | `features.security.title` |
| "Manage policies, approvals, and audit responses..." | `features.security.description` |
| "Project Management" | `features.projects.title` |
| "Organize delivery plans, tasks, and milestones..." | `features.projects.description` |
| "Reporting & Analytics" | `features.reports.title` |
| "Build rollups on utilization, SLA attainment..." | `features.reports.description` |
| "Schedule Management" | `features.schedule.title` |
| "Coordinate onsite visits and remote sessions..." | `features.schedule.description` |
| "Coming soon!" | `features.comingSoon` |

**Knowledge base section:**

| String | Key |
|--------|-----|
| "Need a deeper dive?" | `knowledgeBase.title` |
| "Explore deployment runbooks and best practices..." | `knowledgeBase.description` |
| "Visit resources" | `knowledgeBase.cta` |

#### FR15: DashboardOnboardingSection.tsx — Onboarding progress UI

| String | Key |
|--------|-----|
| "Onboarding complete" | `onboarding.completeTitle` |
| "Complete your setup" | `onboarding.incompleteTitle` |
| "Complete" (badge) | `onboarding.badges.complete` |
| "You're ready to use the full MSP dashboard experience." | `onboarding.completeDescription` |
| "Work through each step to unlock the full MSP dashboard experience." | `onboarding.incompleteDescription` |
| "PROGRESS" | `onboarding.progress.label` |
| "{{completed}} of {{total}} Steps" | `onboarding.progress.steps` |
| "Just getting started!" | `onboarding.progress.messageStart` |
| "All set - great job!" | `onboarding.progress.messageComplete` |
| "Keep going - you've got this!" | `onboarding.progress.messageInProgress` |
| "STEP {{index}}" | `onboarding.stepLabel` |
| "NOT STARTED" (badge) | `onboarding.badges.notStarted` |
| "IN PROGRESS" (badge) | `onboarding.badges.inProgress` |
| "BLOCKED" (badge) | `onboarding.badges.blocked` |
| "Complete your first import OR create 5 contacts" | `onboarding.substeps.dataImport` |
| "Completed" (CTA when done) | `onboarding.cta.completed` |
| "Hiding..." | `onboarding.cta.hiding` |
| "Hide" | `onboarding.cta.hide` |
| "Dismiss {{title}}" (aria-label) | `onboarding.cta.dismiss` |
| "Hidden setup cards ({{count}})" | `onboarding.hidden.title` |
| "Restore any card if you need it later." | `onboarding.hidden.subtitle` |
| "Restoring..." | `onboarding.cta.restoring` |

#### FR16: OnboardingChecklist.tsx — Alternative checklist view

| String | Key |
|--------|-----|
| "Onboarding checklist" | `onboarding.checklist.title` |
| "{{completed}} of {{total}} tasks complete" | `onboarding.checklist.progress` |
| "Configuration complete" | `onboarding.checklist.completeTitle` |
| "Invite clients to experience your branded portal." | `onboarding.checklist.completeDescription` |
| "Invite clients" | `onboarding.checklist.inviteCta` |
| "View onboarding checklist" | `onboarding.checklist.viewButton` |
| "Complete" (status) | Reuse: `onboarding.badges.complete` |
| "In Progress" (status) | Reuse: `onboarding.badges.inProgress` |
| "Not Started" (status) | Reuse: `onboarding.badges.notStarted` |
| "Blocked" (status) | Reuse: `onboarding.badges.blocked` |
| "Create your first 5 contacts" | `onboarding.substeps.createContacts` |

#### FR17: stepDefinitions.ts — Onboarding step content

| String | Key |
|--------|-----|
| "Secure Identity & SSO" | `onboarding.steps.identity.title` |
| "Connect Google Workspace or Microsoft 365 so admins sign in with managed identities." | `onboarding.steps.identity.description` |
| "Connect SSO" | `onboarding.steps.identity.cta` |
| "Set Up Customer Portal" | `onboarding.steps.portal.title` |
| "Configure your portal so customers can sign in on your domain with your branding." | `onboarding.steps.portal.description` |
| "Open Portal Settings" | `onboarding.steps.portal.cta` |
| "Import Core Data" | `onboarding.steps.dataImport.title` |
| "Add contacts so you can start working for clients and keep workflows moving." | `onboarding.steps.dataImport.description` |
| "Create Contacts" | `onboarding.steps.dataImport.cta` |
| "Calendar Sync" | `onboarding.steps.calendar.title` |
| "Connect Google or Outlook calendars to keep dispatch and client appointments aligned." | `onboarding.steps.calendar.description` |
| "Configure Calendar" | `onboarding.steps.calendar.cta` |
| "Configure Email" | `onboarding.steps.email.title` |
| "Set up inbound ticket email and verify an outbound sending domain for reliable delivery." | `onboarding.steps.email.description` |
| "Configure Email" | `onboarding.steps.email.cta` |

#### FR18: ROUTE_NAMESPACES update

Add `msp/dashboard` to the route namespace configuration so it loads on dashboard routes:

```typescript
'/msp': ['common', 'msp/core', 'msp/dashboard'],
'/msp/dashboard': ['common', 'msp/core', 'msp/dashboard'],
```

### Non-functional Requirements

- All new keys follow the established naming convention (see translation-guide.md)
- No performance regression — `msp/core` already loads on every MSP route; `msp/dashboard` loads only on dashboard route
- Feature flag `msp-i18n-enabled` OFF = forced English (no change in behavior)

## Data / API / Integrations

- No database changes
- No API changes
- Translation files: `server/public/locales/{lang}/msp/core.json` and `server/public/locales/{lang}/msp/dashboard.json` for all 9 locales

## Security / Permissions

No changes — translations are static JSON files served from `/public/locales/`.

## Rollout / Migration

- Behind existing `msp-i18n-enabled` feature flag
- Flag OFF: I18nWrapper forces English locale → `t()` returns English values → identical to current hardcoded strings
- Flag ON: User sees their preferred language
- No migration needed — purely additive change to translation files + component wiring

## Open Questions

1. **menuConfig.ts approach**: Option A (translationKey field) vs Option B (hook)? Recommendation: Option A for simplicity — menuConfig stays a plain data file.
2. **Breadcrumb translation**: `getMenuItemNameByPath()` currently returns `item.name` (English). Should it return the translation key instead, letting the breadcrumb component translate? Or should breadcrumbs show the translated nav label?
3. **GitHubStarButton**: The "Star" text and aria-label are part of the GitHub buttons widget — not our text. Skip translation? (Recommendation: yes, skip.)
4. **Onboarding components location**: Dashboard onboarding components live in `packages/onboarding/`, not `server/src/`. They'll need to import `useTranslation` from `@alga-psa/ui/lib/i18n/client` — verify this works from the package context.
5. **stepDefinitions.ts**: This file exports plain data (not a React component). Should it export translation keys (like menuConfig Option A) and let the rendering component call `t()`? (Recommendation: yes, same pattern as menuConfig.)

## Acceptance Criteria (Definition of Done)

### msp/core (shell)
- [ ] All ~80 new keys added to `en/msp/core.json`
- [ ] All 9 shell component files + menuConfig.ts wired to use `useTranslation('msp/core')`
- [ ] With `msp-i18n-enabled` ON + locale set to `xx`: sidebar, header, breadcrumbs, banners, quick-create all show `11111`

### msp/dashboard
- [ ] New `msp/dashboard.json` namespace created with ~110 keys
- [ ] All 4 dashboard component files + stepDefinitions.ts wired to use `useTranslation('msp/dashboard')`
- [ ] `ROUTE_NAMESPACES` updated for `/msp` and `/msp/dashboard` to include `msp/dashboard`
- [ ] With `msp-i18n-enabled` ON + locale set to `xx`: welcome banner, feature cards, onboarding checklist all show `11111`

### Cross-cutting
- [ ] All 7 production locale files updated with translations for both namespaces (fr, es, de, nl, it, pl)
- [ ] Both pseudo-locale files updated for both namespaces (xx, yy)
- [ ] With `msp-i18n-enabled` OFF: all text displays in English (no regressions)
- [ ] With `msp-i18n-enabled` ON + locale set to `pl`: shell and dashboard show Polish text
- [ ] German translations don't overflow sidebar tooltips, header dropdowns, banner badges, or dashboard cards
- [ ] Italian translations pass accent audit (no missing `à`, `è`, `ù`, `ò`)
- [ ] Cross-check: nav item names in `msp/core.json` match across all languages
- [ ] No TypeScript errors, build passes
