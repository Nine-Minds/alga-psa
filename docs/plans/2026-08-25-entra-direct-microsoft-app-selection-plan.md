# Entra direct connect: select the MSP's own Microsoft app registration — implementation plan

Shaped in the design session on 2026-08-25 on branch `feature/entra-sync-uses-wrong-provider`.
Scope: the Entra **direct** (GDAP/Lighthouse) connection path only. The CIPP path is untouched.

## 1. The defect

The Entra direct setup screen gives the operator no choice of Microsoft app registration, and
silently connects using the *platform* (vendor-supplied) app. That app can never work for this
integration: the GDAP/Lighthouse partner relationship being read belongs to the MSP's own partner
tenant, so the app must be registered there, consented there, and hold that tenant's admin consent
for `ManagedTenants.Read.All` and `Directory.Read.All`.

The mechanism is `resolveMicrosoftCredentialsForTenant()`
(`ee/server/src/lib/integrations/entra/auth/microsoftCredentialResolver.ts:19`), a three-tier
fallback:

1. tenant secrets `microsoft_client_id` / `microsoft_client_secret` — these are the **pre-profiles
   legacy keys**. Nothing in the product writes them any more (verified: the only readers are this
   resolver and the legacy-backfill path in `microsoftConsumerProfileResolution.ts`). This tier is
   dead in practice.
2. `process.env.MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`
3. app secrets `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`

On a hosted deployment tiers 2/3 are always populated with the vendor's app, so **every** tenant's
direct connect resolves to it. That single resolver is the sole credential source for the entire
direct path — the consent redirect (`initiateEntraDirectOAuth`), the OAuth callback token exchange,
`refreshDirectToken`, and `validate-direct` — so the wrong app is used end to end.

Meanwhile the product already has the right mechanism and Entra simply does not use it:
`microsoft_profiles` (tenant-owned app registrations: display name, client ID, Microsoft tenant ID,
secret ref, capabilities) plus `microsoft_profile_consumer_bindings` ("for purpose X, use app Y"),
managed in `MicrosoftIntegrationSettings.tsx`, today serving `msp_sso | email | calendar | teams`.

## 2. Decisions taken in the session

| # | Decision |
|---|---|
| D1 | Reuse the existing `microsoft_profiles` registry rather than build an Entra-specific credential form. |
| D2 | Selection is **mandatory in every deployment**, hosted and self-hosted alike. No env or app-secret fallback survives for the Entra path. |
| D3 | The selection is stored as a **consumer binding** (`consumer_type = 'entra'`) and nowhere else — no `microsoft_profile_id` column on the connection row. |
| D4 | Rebinding `entra` to a different profile invalidates the stored direct tokens and drives the connection to "reconnect required", rather than pretending tokens survive an app change. |
| D5 | The picker lives in the Entra setup wizard's **Connect** step, revealed once "Direct" is selected; Continue stays disabled until a profile is chosen. |
| D6 | When no Entra-capable profile exists (the normal first-run state), the wizard offers **inline creation** of a profile — not a link-out to another settings page, and not a list of every existing profile. |
| D7 | Existing direct connections are **not migrated**. The UI derives "direct connection with no `entra` binding" and shows a needs-attention state on the Connect step; the same code path a fresh tenant takes. |

Rationale worth carrying forward, since it constrains later changes:

- **D2** removes a real ambiguity rather than adding friction. The env tier means two different things
  in the two deployments (vendor app hosted / operator's own app self-hosted), and one resolver
  cannot be correct for both. An explicit, visible binding is correct for both.
- **D6** rejects the "list all profiles" variant: an email-only app registration is *selectable* but
  not *workable* — it lacks the Entra redirect URI and the two admin-consented Graph scopes — so
  offering it would move the failure from setup to first sync, which is exactly the failure mode this
  card exists to remove.

## 3. Data model

**Migration** `server/migrations/<ts>_add_entra_microsoft_consumer.cjs`:

- Rewrite the `microsoft_profile_consumer_bindings_consumer_type_check` CHECK constraint to
  `CHECK (consumer_type IN ('msp_sso', 'email', 'calendar', 'teams', 'entra'))`, following the
  drop-if-exists / add pattern already used in
  `20260307143000_create_microsoft_profile_consumer_bindings.cjs`. `exports.config = { transaction: false }`
  to match its siblings.
- **No data change.** Existing profiles keep their stored `capabilities` arrays and therefore do not
  become Entra-capable — deliberate per D6, since an existing app registration is not Azure-side
  configured for this flow.
- `exports.down` restores the four-value constraint, deleting any `entra` binding rows first so the
  constraint can be applied.

No new tables and no new columns.

## 4. Shared consumer plumbing

`packages/integrations/src/actions/integrations/microsoftShared.ts`
- Add `'entra'` to `MICROSOFT_PROFILE_CONSUMERS`.
- `DEFAULT_MICROSOFT_PROFILE_CAPABILITIES` currently spreads the full consumer list. Freeze it to the
  explicit four existing consumers so the default (used only when a stored value is unparseable)
  does not silently confer Entra capability.

`packages/integrations/src/lib/microsoftConsumerVisibility.ts`
- Add `'entra'` to `EE_VISIBLE_MICROSOFT_CONSUMERS` only. CE does not ship the Entra integration.

`packages/integrations/src/actions/integrations/microsoftActions.ts`
- `getMicrosoftConsumerLabel`: add the `entra` case (the switch is exhaustive over the union, so the
  compiler will point at it).
- `getMicrosoftIntegrationMetadata` (~line 805): add an `entra` redirect URI of
  `<baseUrl>/api/auth/microsoft/entra/callback` and a `scopes.entra` list sourced from
  `ENTRA_DIRECT_DELEGATED_SCOPES`. Widen the `MicrosoftProfileStatusResponse.redirectUris` / `scopes`
  types accordingly, and gate both behind `visibleConsumers.has('entra')` in the filtered builder
  (~line 847) exactly as `calendar` and `teams` are.
  - The scope list lives in EE (`ee/server/src/lib/integrations/entra/auth/directScopes.ts`) while this
    action is CE-resident. Do not import across that boundary: declare the display list in the CE
    metadata builder and add a contract test asserting it equals `ENTRA_DIRECT_DELEGATED_SCOPES`, so
    drift fails a test rather than misleading an operator.
- `getGuidanceBlocks` in `MicrosoftIntegrationSettings.tsx` (~line 305): add an Entra block behind the
  EE check showing the redirect URI and scopes, plus a note that both scopes require **admin consent**
  in the partner tenant and that the app must be registered as multi-tenant.

## 5. Credential resolution — the core change

`ee/server/src/lib/integrations/entra/auth/microsoftCredentialResolver.ts` is rewritten to resolve
only through the `entra` consumer binding:

```
resolveMicrosoftCredentialsForTenant(tenant) ->
  | { clientId, clientSecret, tenantId, source: 'profile', profileId, profileDisplayName }
  | null
```

- Read the `entra` binding; load the referenced profile; read the secret via its `client_secret_ref`.
- Return `null` when: no binding, profile missing, profile archived, profile lacks the `entra`
  capability, or client id/secret is blank.
- All three legacy tiers are deleted. `MicrosoftCredentialSource` collapses to the single literal
  `'profile'`.
- Prefer reusing `resolveMicrosoftBindingCandidateProfile` /
  `resolveMicrosoftConsumerProfileConfigReadOnly` from
  `packages/integrations/src/lib/microsoftConsumerProfileResolution.ts` over hand-rolling the lookup,
  so Entra inherits the same archived/capability/secret-ref handling as the other consumers. If the
  read-only resolver's legacy-backfill semantics do not suit (it is built around `email`), add a thin
  `entra`-specific path *in that file* rather than re-deriving profile loading inside the Entra tree —
  the point of D1 is one place that knows how a profile becomes credentials.

**Mirror the change in `packages/ee/src/lib/integrations/entra/auth/microsoftCredentialResolver.ts`.**
That tree is the CE stub set; `server/next.config.mjs` (lines ~357-362) aliases `@ee` / `@enterprise`
to `ee/server/src` for EE builds and `packages/ee/src` otherwise. The two files are today identical
but for whitespace, and both must stay behaviourally identical or CE and EE diverge silently.
`packages/ee/src/lib/integrations/entra/secrets.ts` carries the same key constants and needs the same
edit.

`ee/server/src/lib/integrations/entra/secrets.ts` (both copies): drop
`ENTRA_SHARED_MICROSOFT_SECRET_KEYS` and its contribution to `ENTRA_ALL_SECRET_KEYS`. Those three
legacy keys are no longer read by anything on the Entra path; leaving them in the "all Entra secrets"
list would make disconnect clear tenant secrets that belong to the legacy Microsoft config.
Update `ee/server/src/__tests__/unit/entraSecretKeys.test.ts` to match.

### Error surface

Callers today treat `null` as "not configured" and emit a generic message. Give the missing-binding
case its own message everywhere it can surface, because it now has a specific remedy:

> Select the Microsoft app registration to use for Entra, then reconnect.

Sites: `initiateEntraDirectOAuth` (`packages/integrations/src/actions/integrations/entraActions.ts:424`),
`validate-direct/route.ts:22` (which also writes a `validation_failed` snapshot — give it
`code: 'missing_profile_binding'` rather than reusing `missing_credentials`),
`refreshDirectToken.ts:23`, and the callback route (`ee/server/src/app/api/auth/microsoft/entra/callback/route.ts:109`).

## 6. Binding changes invalidate the connection (D4)

`setMicrosoftConsumerBinding` in `microsoftActions.ts` gains an `entra` post-commit step: when the
bound profile id **changes** (not on a no-op re-save of the same profile), clear the stored direct
token set and mark the active direct connection as needing reconnect.

- Token clearing: `clearEntraDirectTokenSet(tenant)`
  (`ee/server/src/lib/integrations/entra/auth/tokenStore.ts:78`).
- Connection state: `updateEntraConnectionValidation({ tenant, connectionType: 'direct', status:
  'validation_failed', snapshot: { code: 'profile_rebound', message: …, checkedAt } })`
  (`connectionRepository.ts:31`).
- Both live in EE. `microsoftActions.ts` is CE-resident, so reach them through the same dynamic
  `await import('@enterprise/…')` pattern `initiateEntraDirectOAuth` already uses, and no-op when the
  tenant has no active direct connection.
- The confirmation copy in the bindings UI must say what the change costs — changing the Entra app
  disconnects the current Entra connection and requires reconsent. Do not perform this silently.

## 7. Status API

`ee/server/src/app/api/integrations/entra/route.ts` already resolves credentials for the direct case
(line ~68) and reports `connectionDetails.directCredentialSource`. Change that payload to describe
the binding:

```ts
connectionDetails: {
  cippBaseUrl: string | null;
  directTenantId: string | null;               // the profile's Microsoft tenant id
  directCredentialSource: 'profile' | null;
  directProfileId: string | null;
  directProfileName: string | null;
  directProfileMissing: boolean;               // active direct connection with no usable entra binding
}
```

`directProfileMissing` is what drives D7: it is true for a pre-existing direct connection whose
credentials no longer resolve, and the wizard renders the needs-attention state from it. Mirror the
type change in `EntraStatusResponse` (`packages/integrations/src/actions/integrations/entraActions.ts:181`).

## 8. UI

### 8.1 Extract the profile form (prerequisite for D6)

The create/edit profile dialog is currently inlined in the 1449-line
`packages/integrations/src/components/settings/integrations/MicrosoftIntegrationSettings.tsx`
(`ProfileFormState`, `DEFAULT_FORM_STATE`, `validateForm`, the submit handler around line 602, and
the dialog markup). Extract it to
`packages/integrations/src/components/settings/integrations/MicrosoftProfileFormDialog.tsx`:

```tsx
interface MicrosoftProfileFormDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  profile?: MicrosoftProfile | null;
  /** Capabilities pre-ticked on create; the operator can still adjust. */
  initialCapabilities?: MicrosoftProfileConsumer[];
  /** Guidance rows (redirect URI, scopes) rendered inside the dialog. */
  guidance?: Array<{ label: string; value: string }>;
  onOpenChange(open: boolean): void;
  onSaved(profile: MicrosoftProfileSummary): void;
}
```

`MicrosoftIntegrationSettings` is refactored to consume it, so exactly one form exists. This is the
`LEVERAGE: pattern` case — the alternative is a second Microsoft-app form in the Entra wizard that
drifts from the first. Existing coverage
(`MicrosoftIntegrationSettings.contract.test.tsx`) must still pass unchanged; if it asserts on
internals of the inlined dialog, port those assertions onto the extracted component.

### 8.2 Entra wizard Connect step

`ee/server/src/components/settings/integrations/entra/`:

- New `MicrosoftAppRegistrationPicker.tsx`:
  - Loads profiles via `listMicrosoftProfiles()` and the current binding via
    `listMicrosoftConsumerBindings()`; filters to non-archived, `entra`-capable.
  - Renders a `CustomSelect`/`Select` from `@alga-psa/ui` (match whatever the bindings table uses so
    the two read as the same control), labelled "Microsoft app registration", with the profile's
    display name and client ID.
  - Selecting writes the binding via `setMicrosoftConsumerBinding({ consumerType: 'entra', profileId })`.
  - **Empty state (D6):** no capable profiles → an inline "Add app registration" button opening the
    extracted `MicrosoftProfileFormDialog` in `create` mode with `initialCapabilities={['entra']}` and
    the Entra redirect URI + scopes passed as `guidance`, so the operator can copy them into Azure
    without leaving the wizard. On save, the new profile is selected and bound automatically.
  - Copy states the requirement plainly: the app must be registered in the MSP's own partner tenant,
    multi-tenant, with the Entra redirect URI and admin consent for the two Graph scopes.
- `ConnectionMethodChooser.tsx`: render the picker beneath the Direct card when `value === 'direct'`.
  Continue is disabled while no profile is bound. Keep the existing
  `direct.prerequisites.appRegistration` bullet but retarget its copy — it currently reads as advice
  and is now an enforced precondition.
- `EntraSetupWizard.tsx`: hold the bound-profile state, gate `handleContinueConnect` on it, and when
  `status.connectionDetails.directProfileMissing` is true render the Connect step in its
  needs-attention form ("Select a Microsoft app registration and reconnect") even though a connection
  row exists — this is D7's entire surface.
- `EntraDirectConsentDialog.tsx`: name the app being consented to. The dialog's stated purpose is to
  say what is about to happen before an irreversible redirect; after this change *which app* is part
  of that.
- `EntraIntegrationSummaryCard.tsx` / `EntraConsole.tsx`: show the bound app's display name wherever
  the connection is described, so an operator can tell at a glance which app a working connection
  runs on.

### 8.3 i18n

New keys under `integrations.entra.setup.appRegistration.*` and
`integrations.microsoft.settings.*` (consumer label, guidance block, rebind warning) in
`server/public/locales/en/msp/integrations.json`. The repo carries `de, es, fr, it, nl, pl, pt`
plus the `xx`/`yy` pseudo-locales; follow whatever the existing convention is for new keys in those
files (check how a recent Entra key landed before deciding to add or omit translations).

## 9. Test plan

**Unit**
- `ee/server/src/__tests__/unit/microsoftCredentialResolver.precedence.test.ts` — rewritten. The
  precedence ladder it exists to protect is gone; it becomes a binding-resolution test: binding
  present → `source: 'profile'` with that profile's values; and `null` for each rejection case (no
  binding, archived profile, profile lacking `entra` capability, blank secret). Add an explicit case
  asserting env `MICROSOFT_CLIENT_ID` / app secrets are ignored even when set — that assertion *is*
  the regression test for this card.
- `entraSecretKeys.test.ts` — updated for the removed shared keys.
- New: `setMicrosoftConsumerBinding` on `entra` clears direct tokens and marks the connection
  `validation_failed` on a profile change, and does neither on a no-op re-save.
- New: consumer visibility — `entra` visible in EE, absent in CE.
- New: the redirect-URI/scope metadata contract test from §4.
- `server/src/test/unit/integrations/entraActions.directConnect.test.ts` — update the resolver mocks
  to the new shape; add a case asserting `initiateEntraDirectOAuth` fails with the
  select-an-app-registration message when no binding exists, and that the authorize URL carries the
  **bound profile's** client id.

**Component**
- Picker: renders capable profiles only; selection writes the binding; empty state opens the create
  dialog and auto-binds the created profile.
- `MicrosoftProfileFormDialog`: existing `MicrosoftIntegrationSettings.contract.test.tsx`
  expectations preserved after extraction.
- Wizard: Continue disabled until a profile is bound; `directProfileMissing` renders the
  needs-attention Connect step.

**Migration**
- Constraint accepts `entra` and still rejects an unknown consumer; `down` restores the prior
  constraint.

**Manual (EE stack)**
1. Fresh tenant → Entra → Direct → no app registrations → add one inline → it is selected and bound.
2. Continue → consent dialog names the app → authorize URL's `client_id` is the profile's, not the
   platform's.
3. Rebind `entra` to a second profile in Microsoft settings → Entra page shows reconnect required and
   the stored tokens are gone.
4. Tenant with a pre-existing direct connection → Connect step shows the needs-attention state
   (D7) with no migration having run.
5. CIPP path unaffected end to end.

## 10. Out of scope

- CIPP connection type.
- The other consumers' credential resolution (`email`, `calendar`, `teams`, `msp_sso`).
- Automating the Azure-side app registration.
- Any change to the direct provider adapter's Graph calls — those were fixed separately in
  `907702138d`.
