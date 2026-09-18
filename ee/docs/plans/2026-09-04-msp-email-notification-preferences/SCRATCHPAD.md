# Scratchpad

## Scope and privacy

- Product defect only; do not copy customer/company names, domains, emails, tenant/user IDs, or production identifiers into repository artifacts.
- Broader database connection exhaustion is a separate follow-up. It does not explain state-only UI handlers and is outside this fix.

## Current-code findings

- `server/src/components/settings/profile/UserProfile.tsx` loads categories/subtypes but not `getUserPreferencesAction`; its category/subtype handlers update React state only.
- `packages/notifications/src/actions/notification-actions/notificationActions.ts` currently exposes `getUserPreferencesAction(tenant, userId)` and `updateUserPreferenceAction(tenant, userId, preference)` without an authentication wrapper.
- `packages/notifications/src/notifications/email.ts` upserts one row at a time and correctly suppresses delivery for tenant-disabled categories and disabled user preferences.
- `packages/client-portal/src/components/profile/ClientProfile.tsx` demonstrates hydration and persistence but uses per-subtype `Promise.all` for category changes; do not copy that partial-commit/connection-heavy behavior.
- `packages/notifications/src/actions/internal-notification-actions/internalNotificationActions.ts` provides the preferred `withAuth` self-only action pattern.

## Decisions

- Keep the existing preference table; add authenticated read/write orchestration rather than a schema migration.
- Category state is checked/all, unchecked/none, or mixed/some across eligible subtypes.
- Tenant-disabled category/subtype settings are authoritative and their personal controls are disabled.
- Category writes use one server action and one transaction.
- Conflicting UI writes are serialized/versioned and failures restore authoritative state.

## Verification focus

- Real database happy path plus rollback/identity guards.
- Behavioral component tests, not source-string assertions.
- Running MSP UI persistence across refresh/fresh session; Internal/client portal regression; safe delivery enforcement without external email.

## Draft implementation findings and decisions

- The validated plan was present as untracked files at handoff, alongside a partial implementation. Both plan roots' branch history were inspected, including the prescribed `git log main..HEAD --name-only -- docs/plans/` and the client-portal comparison commit.
- Original MSP UI baseline on port 3235, using a synthetic account: category clicks changed the display but created zero personal rows; refresh restored enabled. An explicitly seeded false personal subtype row still displayed enabled. The original profile component was loaded temporarily for this check and the existing draft was preserved/restored.
- Actual `sendNotification` semantics: absent personal rows inherit true. `is_default_enabled` does not veto delivery. Tenant-wide `notification_settings.is_enabled`, category enablement, and subtype enablement do veto delivery. The shared resolver preserves those semantics; reads never create tenant settings.
- Notification categories/subtypes are global reference catalogs; availability is determined by session-tenant gates. Personal actions reject unknown IDs, invalid input types, and tenant-disabled targets. Compatibility actions reject mismatched caller/payload identities.
- One bulk `ON CONFLICT (tenant,user_id,subtype_id)` upsert per category. Validation, writes, returning rows, and authoritative snapshot reads all use the transaction. Route invalidation occurs after commit.
- Both profiles now compose the same Email panel. Mixed categories use an indeterminate checkbox over eligible children; a mixed toggle enables all eligible children. Restricted children remain unavailable and their overrides remain untouched.
- Conflicting controls are disabled synchronously while a save is pending. The first accepted click completes before another can be accepted; clicks during pending are ignored, not queued user intent. Saves and re-entry reads share a serial operation queue; component generations discard stale responses. Failed saves restore the last confirmed state, reconcile with the database, and hide controls behind retry if reconciliation fails. Slow requests remain pending and visibly explain the delay; no synthetic timeout releases an unresolved writer.
- Focused behavioral suite initially passed 20 tests using the real authentication wrapper, a migrated-schema PostgreSQL test database, and a one-connection test pool. Category rollback uses a failing database trigger. Delivery exercises the real notification service against a loopback-only SMTP sink.
- Running MSP smoke confirms subtype off/on persistence and mixed state after re-entry. A synthetic-only database trigger rejected a category write: all five existing rows remained true, the error was visible, and the category returned to checked. Removing the trigger and retrying set all five rows false without duplicates. The trigger and function were removed immediately after the check.
- Full server typecheck requires a larger Node heap in this checkout. With `NODE_OPTIONS=--max-old-space-size=16384`, it passed after correcting the client profile tab-label extraction. No application pool settings were changed.
- Final focused coverage totals 22 passing tests, including a deferred constraint failure at commit (no route invalidation and no persisted category changes) and a slow unresolved save that keeps controls disabled. Successful personal writes also preserve all tenant-setting rows.
- MSP Email mixed state survived sign-out and a new authenticated session. Client-portal Email subtype off/on and category off/on persisted, with matching database rows; a tenant-restricted subtype remained unavailable and its stored true override was not touched by category off. Tenant-wide off disabled and unchecked all controls. Synthetic restrictions were restored after the checks.
- Light and dark rendering were inspected in the running UI. Shared localized messages pass translation validation. Full notifications build/typecheck, client-portal typecheck, and full server typecheck pass. The client-portal standalone build script has no tsup inputs; no unrelated build configuration was added.
- Full production server build completed with exit 0 using a 16 GB Node heap and isolated output. Static generation and tracing completed; warnings originate in unchanged workflow inference imports. The standalone client-portal tsup script remains unconfigured. Distributed Citus verification was not performed.
