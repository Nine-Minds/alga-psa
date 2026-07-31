# SCRATCHPAD — /msp/settings import narrowing

## Context links
- Method precedent: Phase A+B barrel narrowing (commit `991e3ada8a`) + workspace scoping (Option A loop commits).
- ESLint guard: `eslint.config.js` → `ALGA_BARREL_RESTRICTED_PATHS` (block at ~line 301; settings globs NOT yet included).
- Doc: `docs/architecture/package-build-system.md` → "Server-action barrels & the RSC manifest".
- **Next patch context:** `patches/next+16.2.6.patch` (interns duplicated manifest moduleIds; 40-route manifest 6.5MB vs ~500MB projected) removed the OOM itself. This plan is per-route weight/hygiene, not crash-critical. If the patch is ever lost (Next upgrade), this narrowing is the insurance layer.

## Baseline (2026-07-09, post workspace-scoping)
- `/msp/settings`: **31.85 MB / 237 actions**; package breakdown (path occurrences at earlier baseline): clients 31704, tickets 30383, projects 15852, scheduling 14531, user-activities 1321.
- Tabs are `?tab=` params on ONE page — all share this single manifest. `settings/sla` + `settings/notifications` are separate segments (precedent for OQ1).
- **`dynamic(() => import(...), {ssr:false})` does NOT remove a module from the RSC manifest** — still a static edge. TicketingSettings/TeamManagement/ExperimentalFeatures are dynamic and still count.

## Tree roots (scope)
- Route: `server/src/app/msp/settings/page.tsx` → hub `server/src/components/settings/SettingsPage.tsx` (client tab registry, all tabs statically imported).
- Local subtree: `server/src/components/settings/{general,secrets,import-export,extensions,mcp}/**`.
- EXCLUDED: `settings/profile/**` (= /msp/profile), `settings/security/**` (= /msp/security-settings), `general/TicketNumberingSettings.tsx` (orphan, zero importers — skip).
- Good granular models already present (leave alone): `SettingsPage.tsx:63` assets AssetTypesManager, `:78` integrations email entry, ClientPortalSettings → client-portal domain-settings entry.

## OFFENDER INVENTORY (verified 2026-07-09; re-verify each symbol→file at edit time)

### Tier 1 — feature /components barrels
| file:line | specifier | symbols | granular target |
|---|---|---|---|
| general/UserManagement.tsx:61 | clients/components | QuickAddContact | clients/components/contacts/QuickAddContact |
| general/TicketingSettings.tsx:8 | tickets/components | BoardsSettings, CategoriesSettings, DisplaySettings | tickets/components/settings/{each}.tsx |
| SettingsPage.tsx:81 | projects/components | ProjectSettings | projects/components/settings/ProjectSettings |
| SettingsPage.tsx:68 | scheduling/components | TimeEntrySettings | scheduling settings/time-entry path (barrel `export * from './settings/time-entry'` — find concrete file) |
| SettingsPage.tsx:69 | billing/components | BillingSettings, TaxDelegationNudge, QboSyncHealthPanel, QboOnboardingWizardEntry | billing/components/settings/billing/BillingSettings, .../tax/TaxDelegationNudge, .../accounting/{QboSyncHealthPanel,QboOnboardingWizard} |
| SettingsPage.tsx:72 | integrations/components | IntegrationsSettingsPage | integrations/components/settings (find concrete file) |
| SettingsPage.tsx:79 | integrations/components | EmailProviderConfiguration | integrations/components/email/EmailProviderConfiguration |
| general/NotificationsTab.tsx:9 | notifications/components | NotificationSettings, EmailTemplates, NotificationCategories, InternalNotificationCategories | notifications settings entries (find files) |
| general/TicketingSettings.tsx:9 | reference-data/components | NumberingSettings, PrioritySettings | reference-data/components/settings/* |
| general/InteractionStatusSettings.tsx:23,25 | reference-data/components | StatusDialog, ConflictResolutionDialog | reference-data/components/* |
| general/ClientPortalSettings.tsx:26 | tenancy/components | useBranding | tenancy/components/* (hook file) |

### Tier 2 — bare /actions barrels
**clients** (5): GeneralSettings:14 getAllClients→queryActions; UserManagement:10 getAllClients→queryActions; UserManagement:11 addContact,getContactsEligibleForInvitation→contact-actions/contactActions + getContactsByClient,getAllContacts→queryActions; InteractionTypeSettings:8-12 + QuickAddInteractionType:11 → interactionTypeActions.
**user-composition** (9 sites): UserManagement:7, UserList:9, UserDetails:5, TeamList:6, TeamDetails:13, ClientPortalSettings:25, InteractionStatusSettings:11, OrgChart:8 → userQueryActions (user/role queries, getCurrentUser, getAllUsers[Basic]) + avatarActions (all avatar fns).
**users** (4): UserManagement:8 addUser→user-actions/userActions; UserList:10 deleteUser→userActions + getUsersClientInfo→user-actions/userClientActions; UserDetails:6 updateUser,adminChangeUserPassword→userActions + getRoles/assignRoleToUser/removeRoleFromUser→**VERIFY file (OQ2)**; CollapsiblePasswordChangeForm:10 changeOwnPassword→userActions.
**teams** (3): TeamManagement:6 getTeams→team-actions/teamActions; TeamList:4,5 createTeam,deleteTeam→teamActions + getTeamAvatarUrlsBatchAction→team-actions/avatarActions; TeamDetails:9-12 avatar fns→avatarActions.
**tenancy** (8): GeneralSettings:13 getTenantDetails,updateTenantName→coreTenantActions + getTenantTimezoneAuth,setTenantTimezone→tenant-settings-actions/tenantSettingsActions + addClientToTenant/removeClientFromTenant/setDefaultClient→**verify**; MspLanguageSettings:15→tenant-actions/tenantLocaleActions; ClientPortalSettings:12-16→tenantBrandingActions+tenantLocaleActions+tenantClientPortalLocaleActions, :24 logo fns→**verify (likely tenantBrandingActions)**, :29→portalDomainActions; ExperimentalFeaturesSettings:11→tenantSettingsActions; SecretsManagement:9-12 + SecretDialog:10-13→tenant-secret-actions.
**reference-data** (4): ChecklistTemplatesSettings:30 getAllPriorities→priorityActions; InteractionStatusSettings:8→status-actions/statusActions, :9→referenceDataActions; InteractionTypeSettings:13→referenceDataActions.
**client-portal** (2): UserManagement:12 sendPortalInvitation,createClientPortalUser→portal-actions/portalInvitationActions; :14 getTenantPortalLoginLink→portal-actions/clientPortalLinkActions.
**licensing** (2): UserManagement:54 + UserDetails:17 getLicenseUsageAction→license-actions.
**sla** (1): TicketingSettings:10 getSlaPolicies→slaActions.

### Tier 3 — package-side re-pulls (Tier 1 is hollow without these)
- tickets/components/settings/BoardsSettings.tsx:25 imports `@alga-psa/tickets/actions` + reference-data/user-composition/teams barrels.
- billing/components/settings/billing/BillingSettings.tsx:10 imports `@alga-psa/reference-data/components`.
- projects/components/settings/ProjectSettings.tsx:6 imports `@alga-psa/reference-data/components`.
- Package-wide action-barrel counts (components trees): billing 44 files, integrations 29, clients 20, scheduling 12, notifications 5, tickets 1 — scope to settings-reachable subtrees first, extend only if canary shows a package still dominating.

### Sub-routes
- settings/sla/page.tsx:18 sla/components; :25 sla/actions; :35 reference-data/actions getAllBoards→boardActions; :36 clients/actions getAllClients→queryActions.
- settings/notifications/page.tsx:5 notifications/components.

## ESLint globs to add (each only when its scope is clean)
```
"server/src/app/msp/settings/**/*.{ts,tsx}",
"server/src/components/settings/**/*.{ts,tsx}",
"packages/*/src/components/settings/**/*.{ts,tsx}",
```
Note: QuickAddContact leaf is already individually guarded (line ~313) — the offense is the barrel edge in UserManagement, not the leaf.

## RUNBOOK — canary
```bash
cd /Users/natalliabukhtsik/Desktop/projects/alga-psa
pkill -f "nx next:dev server"; rm -rf server/.next/dev
NX_LOAD_DOT_ENV_FILES=false NODE_ENV=development NX_TUI=false NX_DAEMON=false E2E_AUTH_BYPASS=true PORT=3000 \
  nohup npx nx next:dev server > /tmp/settings.log 2>&1 &   # wait for "Ready in"; if log empty, run foreground
for r in /msp/settings /msp/settings/sla /msp/settings/notifications; do
  curl -s -o /dev/null -w "%{http_code} $r\n" --max-time 150 "http://localhost:3000$r"; done   # re-hit cold 000s
ls -lh server/.next/dev/server/app/msp/settings/page/server-reference-manifest.json
grep -o 'ACTIONS_MODULE[0-9]*' server/.next/dev/server/app/msp/settings/page/server-reference-manifest.json | sort -u | wc -l
python3 -c "
import json,re,collections,sys
d=json.load(open(sys.argv[1])); k=next(iter(d['node']))
mid=next(iter(d['node'][k]['workers'].values()))['moduleId']
c=collections.Counter(re.findall(r'\[project\]/(packages/[a-z-]+|server/src)/',mid))
[print(f'{n:4d}  {p}') for p,n in c.most_common()]
" server/.next/dev/server/app/msp/settings/page/server-reference-manifest.json
```
NOTE with the Next patch applied, the MERGED manifest stays small, but the per-route PARTIALS still reflect real reachable-module weight — partials are the metric here (the patch does not shrink partials).

## RUNBOOK — gates
```bash
cd server && NODE_OPTIONS="--max-old-space-size=16384" npm run typecheck    # exit 0
cd /Users/natalliabukhtsik/Desktop/projects/alga-psa
npx eslint "server/src/app/msp/settings/**/*.{ts,tsx}" "server/src/components/settings/**/*.{ts,tsx}" \
  "packages/*/src/components/settings/**/*.{ts,tsx}" --quiet 2>&1 | grep -c "no-restricted-imports"   # 0
```

## GOTCHAS
- zsh: no word-splitting of unquoted vars in for-loops; use explicit lists.
- `tsc` needs `--max-old-space-size=16384`.
- Preserve `as` aliases and `import type` exactly; duplicate-export symbols → use the barrel-canonical file (check the package's actions/index.ts re-export when in doubt).
- Do NOT force non-productive narrowings — if the canary doesn't move for a group, note it and move on (Phase-1 discipline: revert what doesn't pay).
- Do NOT touch profile/**, security/**, TicketNumberingSettings.tsx (out of scope; see PRD N2/N3).

## RESULTS (measured 2026-07-09, all tiers landed together; authenticated glinda session, normal auth mode)
| Group | /msp/settings partial | modules | notes |
|---|---|---|---|
| baseline | 31.85 MB | 237 | clients+tickets+projects+scheduling dominate |
| final (T1+T2+T3+subroutes) | **18 MB** | **185** | −43% size, −52 modules |

- Post-narrowing package breakdown: clients 24, integrations 23, tickets 22, tenancy 13, auth 11, billing 10, user-composition 6 — remaining weight is the tabs' OWN legitimate feature trees (users tab quick-add chain, integrations settings page, ticketing settings components), no barrels left.
- Other routes improved: profile 4.9MB/112, security-settings 5.3MB/114, settings/sla 4.9MB/109, settings/notifications 4.5MB/105.
- **AC1 residual (honest):** target was <~15MB/<150; landed 18MB/185. The remaining delta is not import hygiene — it's tab content. Next lever is OQ1 (promote ticketing/integrations/users tabs to route segments, precedent settings/sla) — flagged, NOT implemented (F063).
- **Browser verification:** authenticated as glinda (password scraped from startup log per initializeApp), 23/23 surfaces clean — all 19 settings tabs + sla/notifications/profile/security-settings render with content, zero console errors/pageerrors/5xx. CRUD-level smokes (T021/T031, F062) NOT performed — render-level only; left unflipped.
- F042 (documentBlockContentActions secondary) not needed: documents contribution is 5 modules post-narrowing.
- Offload note: executed via codex/GPT-5.5 (3 lanes; cursor-agent unavailable on this machine), reviewed + gated (typecheck exit 0 ×2, guard 0 violations — the 14 pre-cleanup violations in profile/security doubled as the guard's negative test).
- Patch synergy: merged manifest in this normal-auth session = 1.0MB with __moduleIdTable active.
