# Scratchpad — Optional Client Email Field

## Source
- Board card: "Optional email field for client" (project `60e7403c-8984-4a10-a8c0-67cc3483d176`).
- Description: customer reported via email — in Brazil WhatsApp is the primary
  contact method, so client email should be optional (not required), while still
  validating format when supplied. (Customer name kept out of this public plan.)
- Card is at the "Design Session" step; next agent step "Draft Implementation"
  expects a design plan under docs/plans on this branch — this is it.

## Key discovery (2026-08-22)
Most of the stack on this branch ALREADY treats client email as optional. This
plan is largely "verify + close the last gaps + lock with tests," not a big build.

Layer status:
- DB: `server/migrations/202410211120_add_email_to_companies.cjs` — `email`
  column is nullable. No later NOT NULL constraint. ✅ no migration needed.
- Canonical validation: `packages/validation/src/lib/schemas/clientContact.schema.ts`
  — `emailFieldSchema`, `optional(...)`, `clientCoreFieldsSchema.email =
  optional(emailFieldSchema)`. ✅ already optional.
- Server actions: `packages/clients/src/actions/clientActions.ts` — validates via
  `clientCoreFieldsSchema`. ✅
- REST schemas: `server/src/lib/api/schemas/client.ts` — `email`/`billing_email`
  use `clientEmailField` (optional). ✅
- UI: `packages/clients/src/components/clients/QuickAddClient.tsx` (email =
  `location_email`, only validated when supplied; only `client_name` required) and
  `ClientDetails.tsx` (`requiredFields` = `client_name` only). ✅ verify no `*`.

## Remaining gap to fix
- `server/src/lib/schemas/client.schema.ts:32` — `ClientSchema.email:
  z.string().email()` is still REQUIRED (read/entity representation). Relax to
  `.email().optional().nullable()` (or similar) so an email-less client parses.
  - NOTE: grep found NO `import { ClientSchema }` usages in `server/src` — it may
    be effectively dead. Relaxing is low-risk/defensive. Decide relax vs remove
    (OQ1) before touching. Prefer relax unless confirmed dead.

## Watch-outs
- Distinguish scope: client(company) entity ONLY.
  - Contacts: keep existing email rules (out of scope).
  - `packages/client-portal/.../account/ProfileSection.tsx:73` requires email —
    that's the portal user profile, NOT the client entity. Do NOT change.
- Normalize blank/whitespace/null → NULL (not empty string). Confirm actions +
  REST both do this.
- Spot-check invoice/notification templates for "undefined" if they assume a
  non-null client email (OQ2).

## Shared utils reference
- `packages/validation/src/lib/utils.ts` — `isValidEmail`, `emailSchema`
  (required), `optionalEmailSchema`.
- `packages/validation/src/lib/clientFormValidation.ts` —
  `validateEmailAddressField(email, {required?})`.

## Commands
- Plan folder: `ee/docs/plans/2026-08-22-optional-client-email-field/`
- Validate plan: `python3 ~/.claude/skills/alga-plan/scripts/validate_plan.py <folder>`
