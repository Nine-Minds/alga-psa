# Takeover validation — 2026-09-16

The approved four-file plan is the implementation spec. This completes the four previously missing feature deliverables and the mandatory delivery gates. All 87 features are implemented. The test checklist remains conservative: 29 of its 40 broad acceptance groups are fully evidenced; false entries are additional matrix coverage, not claims that those behaviors are absent.

## Automated results

| Lane | Result |
| --- | --- |
| EE diagnostics, dialog, Temporal and OAuth callback | 80 tests passed (75 focused + 5 CIPP report tests) |
| Migrated PostgreSQL + HTTP Microsoft Graph emulator | 24 tests passed |
| Shared engine + unchanged email regression | 14 passed, including all 4 unchanged email tests |
| Microsoft Graph emulator regressions | 92 passed |
| Guard/delegator, guide contract, translation resolution | 17 passed |
| Diagnostics key parity | All locale key sets match |
| TypeScript | Full server, EE server, integrations and nm-store pass |
| Website page | Frontmatter, unique slug/order, four image paths and MDX compilation pass |
| Emulator scenarios | All six YAML files parse with the host scenario loader |

The full server check succeeds with `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit`. EE/integrations checks used an 8192 MB heap. No new dependency installation or lockfile changes were needed.

### Reproduce the database lane

Use a disposable, **already migrated** PostgreSQL database named `test_*` or `entra_diagnostics_*`. This lane does not run the general destructive integration bootstrap. It creates two random workspace fixtures in a transaction and rolls them back after every test. Do not point it at a production database.

```sh
npm run build --workspace=@alga-psa/emulator-msgraph
cd ee/server
ENTRA_DIAGNOSTICS_TEST_DB=entra_diagnostics_takeover npx vitest run --config vitest.entra-diagnostics.config.ts
```

Optional connection overrides: `DB_HOST`, `ENTRA_DIAGNOSTICS_DB_PORT`, `ENTRA_DIAGNOSTICS_DB_USER`, `ENTRA_DIAGNOSTICS_DB_PASSWORD`. Local defaults use port 5472 and the existing local PostgreSQL secret file. No credentials are committed.

The lane runs real repositories, SQL, OAuth refresh, adapters, filters and report assembly. It replaces request-context plumbing, the secret backend, and Temporal transport. Domain snapshots cover eleven tables in both workspaces; only the four permitted OAuth secret keys may be written. CIPP DNS/TLS/timeout cases inject Axios transport failures; its HTTP cases use a real local HTTP server. SDK-shaped Temporal unit tests and the live smoke cover Temporal separately.

The integration tests cover paged discovery; partner consent; customer consent; customer users 403; empty discovery; expired secret; foreign selection and cross-user/workspace continuation rejection; missing setup with no default writes; stored custom filters; nested history errors; 25 dry runs ahead of two real failures; run-level failure fallback; aged reconciliation work; CIPP fallback, empty, malformed, HTTP and transport outcomes. A 50-client run finishes in 17 requests, with at most three finalized clients per request. A 10,001-user preview crosses the ten-page request boundary, resumes fully, and preserves counts without serializing credentials. A separate fake-time test exercises cancellation during a page and retries that page without double-counting.

### Focused commands

```sh
# From ee/server
npx vitest run --config vitest.unit.config.ts src/__tests__/unit/entraDiagnostics*.test.* src/__tests__/unit/entraClientDiagnostics.test.ts src/__tests__/unit/entraConnectionDiagnostics.test.ts src/__tests__/unit/entraCippConnectionDiagnostics.test.ts src/__tests__/unit/entraTemporalReadiness.test.ts src/__tests__/unit/entraOAuthCallback.validation.test.ts
# From shared
npx vitest run --config vitest.config.ts services/diagnostics/__tests__/diagnostics.test.ts services/email/providers/__tests__/MicrosoftGraphAdapter.diagnostics.test.ts
# From repository root
npm test --workspace=@alga-psa/emulator-msgraph
# From server
npx vitest run --config vitest.config.ts src/test/unit/integrations/entraAddOnGuard.test.ts src/test/unit/api/entraRoutes.delegator.test.ts src/test/unit/docs/entraIntegrationGuide.contract.test.ts src/test/unit/app/translationKeyResolution.test.ts
```

## Authenticated console evidence

Smoke used the actual dev server on port 3793 with a disposable migrated clone (`entra_diagnostics_takeover`), an isolated filesystem secret root, the Graph emulator (4010, control 9500), and a dedicated Temporal dev frontend (7247). Its namespace/task queue was `entra-diagnostics-fixture`; the synthetic schedule was set to fire after the smoke window. No real Microsoft endpoint or customer directory was used.

Signed in as a synthetic Northwind IT operator and navigated Settings → Integrations → Identity → Microsoft Entra → Open → Connection → Run diagnostics. Ran both scopes and the optional yield preview. Injected partner consent, customer consent and customer directory-role faults through the emulator control API. Customer failures remained isolated from the second healthy client.

| Screenshot | Evidence |
| --- | --- |
| `screenshots/entra-diagnostics-connection-green.png` | Passing connection, including real Temporal worker/schedule checks |
| `screenshots/entra-diagnostics-clients-green.png` | Two clients completed, both accessible |
| `screenshots/entra-diagnostics-partner-consent.png` | Partner consent remedy and discovery skips |
| `screenshots/entra-diagnostics-client-consent.png` | One customer needs consent; copy/open actions and healthy neighbor |
| `screenshots/entra-diagnostics-client-role.png` | One customer needs a GDAP role; healthy neighbor |

These are real browser screenshots, cropped to the dialog; only the development overlay was hidden. Both export identifier modes were exercised through the real Copy action. Exports retain timestamps, completion state and fingerprints; no full JWT was present. Eight live domain-table snapshots matched before and after a fresh connection-plus-client run. The default export redacts identifiers; the explicit mode includes client IDs without exposing secrets.

Live smoke caught and fixed a Turbopack-only failure: a type-only export in a `use server` action module was registered as a runtime action and broke the integrations action surface. The type and barrel re-exports were removed. It also caught Temporal's required workflow task-queue type and missing visible consent action buttons.

## Website deliverable

Separate local repository: `/home/robert/nm-store`; local docs commit `1a7435ef`.

- Page: `packages/nm-store/src/site/content/docs/microsoft-entra-diagnostics.md`
- Served images: `packages/nm-store/public/docs-images/entra-diagnostics-*.png` (four images)
- Source images: `docs/public/settings/images/entra-diagnostics-*.png`

The page follows the business-documentation workflow and uses the actual smoke screenshots and click path. The nm-store TypeScript check and MDX compilation pass. No website deployment, push, or PR was performed.

## Review first and coverage limits

Review the unconditional sanitizer (including nested serialized errors), continuation signing and resumable page boundaries, new real-DB isolation tests, and server-action runtime fix first. Existing email behavior is protected by its unchanged regression suite. Non-English diagnostics values remain English fallbacks with complete key parity. The remaining false acceptance checklist groups document combinations not yet fully covered; they should not be represented as executed. No production Microsoft/Graph or production deployment validation is claimed.
